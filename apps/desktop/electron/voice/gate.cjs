/**
 * Audio checks that run before the recognizer sees a clip. Pure functions on 16 kHz mono
 * Float32Array samples.
 *
 * Adapted from Hex (https://github.com/anomalyco/hex, MIT, Copyright (c) 2026 Christopher
 * Langton), src/dictation.rs at commit 64234cc: the level gate (`LevelGate`, `noise_floor_dbfs`,
 * `longest_run_windows`, `window_levels_dbfs`) and `pad_for_parakeet`, including their constants.
 * Reimplemented in JavaScript; see CREDITS.md.
 */

const SAMPLE_RATE = 16000;

/** A clip whose loudest 30 ms window reaches this is loud enough to transcribe outright. */
const SILENCE_THRESHOLD_DBFS = -50;
/** Below that, a window must rise this far above the clip's own noise floor to count. */
const SILENCE_RELATIVE_MARGIN_DB = 12;
/** ...and never counts below this, however quiet the floor. */
const SILENCE_RELATIVE_FLOOR_DBFS = -66;
/** The relative path needs one contiguous run of at least 180 ms (six 30 ms windows). */
const SILENCE_SUSTAINED_MS = 180;
const WINDOW_SAMPLES = 480;
const LEVEL_FLOOR_DBFS = -120;
/** Parakeet does poorly on very short input; shorter clips are padded with silence. */
const MINIMUM_PARAKEET_MS = 1500;

/** DC-removed RMS level of each 30 ms window, in dBFS. */
function windowLevels(samples) {
  const levels = [];
  for (let start = 0; start < samples.length; start += WINDOW_SAMPLES) {
    const end = Math.min(samples.length, start + WINDOW_SAMPLES);
    const count = end - start;
    let mean = 0;
    for (let i = start; i < end; i++) mean += samples[i];
    mean /= count;
    let variance = 0;
    for (let i = start; i < end; i++) variance += (samples[i] - mean) ** 2;
    variance /= count;
    levels.push(Math.max(LEVEL_FLOOR_DBFS, 20 * Math.log10(Math.max(Math.sqrt(variance), 1e-6))));
  }
  return levels;
}

/** The 10th-percentile window level, ignoring windows of digital silence. */
function noiseFloor(levels) {
  const audible = levels.filter((level) => level > LEVEL_FLOOR_DBFS).sort((a, b) => a - b);
  if (audible.length === 0) return null;
  return audible[Math.floor((audible.length - 1) / 10)];
}

/** Longest run of windows at or above `threshold`; one quiet window is bridged, two end the run. */
function longestRun(levels, threshold) {
  let run = 0;
  let longest = 0;
  let bridged = false;
  for (const level of levels) {
    if (level >= threshold) {
      run += 1;
      longest = Math.max(longest, run);
      bridged = false;
    } else if (run === 0) {
      bridged = false;
    } else if (bridged) {
      run = 0;
      bridged = false;
    } else {
      bridged = true;
    }
  }
  return longest;
}

/**
 * Measures a clip. `passes` is false for a clip with nothing worth transcribing (a click, a
 * silent room, a muted mic). `loud` is true when it clears the fixed threshold, so it needs no
 * speech detector to back it up.
 */
function measure(samples) {
  const levels = windowLevels(samples);
  const loudestDbfs = levels.reduce((max, level) => Math.max(max, level), LEVEL_FLOOR_DBFS);
  const floor = noiseFloor(levels);
  const relativeThreshold = floor === null ? null : Math.max(floor + SILENCE_RELATIVE_MARGIN_DB, SILENCE_RELATIVE_FLOOR_DBFS);
  const sustainedWindows = relativeThreshold === null ? 0 : longestRun(levels, relativeThreshold);
  const needed = Math.ceil(SILENCE_SUSTAINED_MS / ((WINDOW_SAMPLES * 1000) / SAMPLE_RATE));
  const loud = loudestDbfs >= SILENCE_THRESHOLD_DBFS;
  return {
    loudestDbfs,
    noiseFloorDbfs: floor,
    sustainedMs: (sustainedWindows * WINDOW_SAMPLES * 1000) / SAMPLE_RATE,
    loud,
    passes: loud || sustainedWindows >= needed,
  };
}

/** `samples` padded with trailing silence to Parakeet's minimum length. */
function padForParakeet(samples) {
  const minimum = (MINIMUM_PARAKEET_MS * SAMPLE_RATE) / 1000;
  if (samples.length >= minimum) return samples;
  const padded = new Float32Array(minimum);
  padded.set(samples);
  return padded;
}

/**
 * Resamples mono audio to 16 kHz: a box filter over each output step (enough to keep speech
 * bands from aliasing when the mic runs at 44.1 or 48 kHz), then linear interpolation.
 */
function resampleTo16k(samples, sampleRate) {
  if (sampleRate === SAMPLE_RATE) return samples;
  const ratio = sampleRate / SAMPLE_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  const half = ratio > 1 ? ratio / 2 : 0;
  for (let i = 0; i < length; i++) {
    const center = i * ratio;
    if (half > 0) {
      const from = Math.max(0, Math.floor(center - half));
      const to = Math.min(samples.length - 1, Math.ceil(center + half));
      let sum = 0;
      for (let j = from; j <= to; j++) sum += samples[j];
      out[i] = sum / (to - from + 1);
    } else {
      const left = Math.floor(center);
      const right = Math.min(samples.length - 1, left + 1);
      const t = center - left;
      out[i] = samples[left] * (1 - t) + samples[right] * t;
    }
  }
  return out;
}

module.exports = { SAMPLE_RATE, measure, padForParakeet, resampleTo16k };
