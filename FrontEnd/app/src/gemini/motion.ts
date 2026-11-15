/**
 * The motion half of the engine: turns the incident spec (spec.ts) into a trajectory for every
 * vehicle, in the plan frame.
 *
 * Principle: playback replays the observed trajectories. Every vehicle follows its own keyframes
 * exactly (positions and headings linearly interpolated between samples, so per-frame 0.08 s
 * measurements, lane changes and wiggles come through unsmoothed). Nothing is simulated on top:
 * no car-following queue, no relocation or removal of inconvenient vehicles, no manufactured
 * contact, no pile-up. Contacts, forces and the divider are data in the spec, not something the
 * planner invents.
 *
 * Keyframe provenance (Keyframe.src: measured, interpolated, edge-/out-of-view-extrapolated,
 * occluded-rest) never changes how a sample is drawn: a vehicle is on the road from its first
 * keyframe to its last, whatever produced them, so extrapolated run-ins don't pop in mid-road and
 * an occluded wreck stays put. The provenance is counted in the plan notes for the report.
 *
 * One fallback, for crash vehicles only: a participant whose keyframes stop after the crash while
 * it is at rest (its annotation was lost, e.g. occluded) is held at that pose to the end of the
 * clip with an explicit `occluded-rest` keyframe, rather than vanishing.
 *
 * Pure TypeScript with no app imports, so it can be tested on its own.
 */
import type { IncidentSpec, Keyframe, SampleSource, SpecObject } from "./spec";
import { wrapDeg, type V2 } from "./physics";

/** Sampling rate of the stored tracks: a multiple of the demo footage's 12.5 fps. */
export const SIM_HZ = 50;
/** Coefficient of restitution for car-to-car impacts (same as the pipeline's collision model). */
export const RESTITUTION = 0.15;

/** Below this speed (m/s) and movement over the last second (m) a crash vehicle counts as at rest. */
const REST_SPEED_MPS = 0.5;
const REST_DRIFT_M = 0.5;
/** Uncertainty given to an occluded-rest hold the planner adds (m). */
const REST_SIGMA_M = 0.5;

export type Track = {
  x: Float64Array;
  y: Float64Array;
  h: Float64Array;
  /** Exact pose from the keyframes at any time (trackAt uses it; the arrays are SIM_HZ samples of it). */
  at?: (t: number) => { p: V2; h: number };
};

export type PlannedVehicle = {
  object: SpecObject;
  track: Track;
  /** Seconds the vehicle is on the road: its first and last keyframe. Outside it is hidden. */
  visible: [number, number];
  /** What the planner changed (only the occluded-rest hold, for crash vehicles). */
  adjustments: string[];
};

export type Friction = { mu: number; range: [number, number] };

export type LaneModel = {
  /** Plan-y of each lane centre for traffic moving +x, and for traffic moving -x. */
  forward: number[];
  backward: number[];
};

export type PlanOptions = {
  seed: number;
  friction: Friction;
  /** Lane centres of the main road (unused by replay; kept for the engine's call signature). */
  lanes?: LaneModel;
};

export type MotionPlan = {
  duration: number;
  samples: number;
  vehicles: PlannedVehicle[];
  crash: { start_s: number; end_s: number; participants: string[] } | null;
  /** Objects not placed in the scene, with the reason. */
  removed: { id: string; label: string; reason: string }[];
  notes: string[];
};

// ---------------------------------------------------------------------------

const finite = (k: Keyframe) => [k.t_s, k.x_m, k.y_m].every(Number.isFinite);

/** Finite keyframes in time order, one per timestamp (a later duplicate wins); heading/speed defaulted. */
export function cleanKeyframes(frames: Keyframe[]): Keyframe[] {
  const sorted = frames
    .filter(finite)
    .map((k, i) => ({ k, i }))
    .sort((a, b) => a.k.t_s - b.k.t_s || a.i - b.i)
    .map(({ k }) => ({
      ...k,
      heading_deg: Number.isFinite(k.heading_deg) ? k.heading_deg : 0,
      speed_mps: Number.isFinite(k.speed_mps) ? k.speed_mps : 0,
    }));
  const out: Keyframe[] = [];
  for (const k of sorted) {
    if (out.length && Math.abs(out[out.length - 1].t_s - k.t_s) < 1e-9) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

/** Exact pose from time-ordered keyframes: linear between neighbours, held outside. */
export function keyframePose(frames: Keyframe[], t: number): { p: V2; h: number } {
  const n = frames.length;
  if (t <= frames[0].t_s || n === 1) return { p: [frames[0].x_m, frames[0].y_m], h: frames[0].heading_deg };
  const last = frames[n - 1];
  if (t >= last.t_s) return { p: [last.x_m, last.y_m], h: last.heading_deg };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t_s <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const u = (t - a.t_s) / (b.t_s - a.t_s);
  return {
    p: [a.x_m + (b.x_m - a.x_m) * u, a.y_m + (b.y_m - a.y_m) * u],
    h: a.heading_deg + wrapDeg(b.heading_deg - a.heading_deg) * u,
  };
}

/** True when the keyframes cover time t: the vehicle is on the road then. */
export const coversTime = (frames: Keyframe[], t: number, eps = 1e-6) =>
  frames.length > 0 && t >= frames[0].t_s - eps && t <= frames[frames.length - 1].t_s + eps;

export function trackAt(track: Track, t: number): { p: V2; h: number } {
  if (track.at) return track.at(t);
  const n = track.x.length;
  if (n < 2) return { p: [track.x[0], track.y[0]], h: track.h[0] };
  const f = Math.min(n - 1, Math.max(0, t * SIM_HZ));
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  const dh = wrapDeg(track.h[i + 1] - track.h[i]);
  return { p: [track.x[i] + (track.x[i + 1] - track.x[i]) * k, track.y[i] + (track.y[i + 1] - track.y[i]) * k], h: track.h[i] + dh * k };
}

function replayTrack(frames: Keyframe[], n: number): Track {
  const track: Track = { x: new Float64Array(n), y: new Float64Array(n), h: new Float64Array(n), at: (t) => keyframePose(frames, t) };
  for (let i = 0; i < n; i++) {
    const { p, h } = keyframePose(frames, i / SIM_HZ);
    track.x[i] = p[0];
    track.y[i] = p[1];
    track.h[i] = h;
  }
  return track;
}

/**
 * A crash vehicle whose keyframes end after the crash, at rest, before the clip does: its
 * annotation was lost (occluded wreck). Returns the hold keyframe to append, or null.
 */
function restHold(frames: Keyframe[], crashStart: number, duration: number): Keyframe | null {
  const last = frames[frames.length - 1];
  if (last.t_s >= duration - 1e-6 || last.t_s < crashStart) return null;
  const before = keyframePose(frames, last.t_s - 1).p;
  const drift = Math.hypot(last.x_m - before[0], last.y_m - before[1]);
  if (last.speed_mps > REST_SPEED_MPS || drift > REST_DRIFT_M) return null;
  return {
    t_s: duration,
    x_m: last.x_m,
    y_m: last.y_m,
    heading_deg: last.heading_deg,
    speed_mps: 0,
    src: "occluded-rest",
    sigma_m: Math.max(REST_SIGMA_M, last.sigma_m ?? 0),
  };
}

export function planMotion(spec: IncidentSpec, _options: PlanOptions): MotionPlan {
  const n = Math.floor(spec.duration_s * SIM_HZ + 1e-6) + 1;
  const vehicles: PlannedVehicle[] = [];
  const removed: MotionPlan["removed"] = [];
  const notes: string[] = [];
  const crashIds = new Set(spec.crash?.participants ?? []);
  const sources = new Map<SampleSource, number>();

  for (const object of spec.objects) {
    const frames = cleanKeyframes(object.keyframes ?? []);
    if (!frames.length) {
      removed.push({ id: object.id, label: object.label, reason: "no observed positions available" });
      continue;
    }
    const adjustments: string[] = [];
    if (spec.crash && crashIds.has(object.id)) {
      const hold = restHold(frames, spec.crash.start_s, spec.duration_s);
      if (hold) {
        adjustments.push(`held at its last observed rest pose from ${frames[frames.length - 1].t_s.toFixed(2)} s to the end of the clip (occluded-rest)`);
        notes.push(`${object.label}: annotation ends at ${frames[frames.length - 1].t_s.toFixed(2)} s with the vehicle at rest; held there to ${spec.duration_s.toFixed(2)} s as occluded-rest.`);
        frames.push(hold);
      }
    }
    // Keyframes, including extrapolated samples, define playback bounds. Observation-only
    // visible_from/to metadata must not suppress the run-in or an occluded wreck. Keep the
    // input spec untouched so planning/rendering cannot silently rewrite the stored evidence.
    const replayObject = {
      ...object,
      keyframes: frames,
      visible_from_s: frames[0].t_s,
      visible_to_s: frames[frames.length - 1].t_s,
    };
    for (const k of frames) if (k.src && k.src !== "measured") sources.set(k.src, (sources.get(k.src) ?? 0) + 1);
    vehicles.push({ object: replayObject, track: replayTrack(frames, n), visible: [frames[0].t_s, frames[frames.length - 1].t_s], adjustments });
  }

  notes.unshift(
    "Every vehicle replays its reported keyframes exactly (linear between samples, heading included) and is shown from its first keyframe to its last. No traffic model, relocation or contact is added; occlusions and calibration limit accuracy.",
  );
  if (sources.size) {
    notes.push(`Not directly measured: ${[...sources].map(([src, count]) => `${count} ${src}`).join(", ")} sample(s); drawn like the measured ones and labelled in the data.`);
  }
  return {
    duration: spec.duration_s,
    samples: n,
    vehicles,
    removed,
    crash: spec.crash
      ? { start_s: spec.crash.start_s, end_s: spec.crash.end_s, participants: spec.crash.participants.filter((id) => vehicles.some((v) => v.object.id === id)) }
      : null,
    notes,
  };
}
