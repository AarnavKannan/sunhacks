/**
 * The speech recognizer's own process. voice.cjs starts it with Electron's utilityProcess (or
 * child_process.fork when tested from plain Node), so a native crash or a long decode never
 * touches the main process.
 *
 * Messages in:  { id, type: "load", paths, numThreads }
 *               { id, type: "transcribe", samples: Float32Array, sampleRate, partial }
 * Messages out: { id, ok: true, result } | { id, ok: false, error }
 */
const os = require("os");
const sherpa = require("sherpa-onnx-node");
const gate = require("./gate.cjs");

const port = process.parentPort; // set inside an Electron utility process
const send = (message) => (port ? port.postMessage(message) : process.send(message));
const onMessage = (handler) => (port ? port.on("message", (event) => handler(event.data)) : process.on("message", handler));

/** Silero settings from Hex's src/transcription/speech_detector.rs: 0.4 hears a whisper, 160 ms keeps a short "OK". */
const VAD_THRESHOLD = 0.4;
const VAD_MIN_SPEECH_S = 0.16;
const VAD_WINDOW = 512;

let recognizer = null;
let vad = null;

function defaultThreads() {
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, cores - 1));
}

async function decode(samples) {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: gate.SAMPLE_RATE });
  const result = await recognizer.decodeAsync(stream);
  return String(result?.text ?? "").trim();
}

/** Whether Silero hears any speech in 16 kHz `samples`. */
function containsSpeech(samples) {
  // reset(), not clear(): clear() only empties the segment queue and keeps the model's
  // "in speech" state from the previous clip.
  vad.reset();
  let heard = false;
  for (let start = 0; start + VAD_WINDOW <= samples.length && !heard; start += VAD_WINDOW) {
    vad.acceptWaveform(samples.subarray(start, start + VAD_WINDOW));
    heard = !vad.isEmpty();
  }
  if (!heard) {
    vad.flush();
    heard = !vad.isEmpty();
  }
  vad.reset();
  return heard;
}

async function load({ paths, numThreads }) {
  const threads = numThreads || defaultThreads();
  const started = Date.now();
  recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: gate.SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: paths["encoder.int8.onnx"], decoder: paths["decoder.int8.onnx"], joiner: paths["joiner.int8.onnx"] },
      tokens: paths["tokens.txt"],
      modelType: "nemo_transducer",
      numThreads: threads,
      provider: "cpu",
      debug: 0,
    },
    decodingMethod: "greedy_search",
  });
  vad = new sherpa.Vad(
    {
      sileroVad: {
        model: paths["silero_vad.onnx"],
        threshold: VAD_THRESHOLD,
        minSpeechDuration: VAD_MIN_SPEECH_S,
        minSilenceDuration: 0.3,
        windowSize: VAD_WINDOW,
        maxSpeechDuration: 60,
      },
      sampleRate: gate.SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    },
    180,
  );
  const loadMs = Date.now() - started;
  // Warm-up on 1.5 s of silence, as Hex does after loading, so the first real dictation isn't
  // the one that pays for ONNX Runtime's first-run allocations.
  const warmStarted = Date.now();
  await decode(new Float32Array(gate.SAMPLE_RATE * 1.5));
  return { loadMs, warmMs: Date.now() - warmStarted, threads };
}

async function transcribe({ samples, sampleRate, partial }) {
  if (!recognizer) throw new Error("The speech model isn't loaded");
  if (!(samples instanceof Float32Array)) samples = Float32Array.from(samples ?? []);
  const audio = gate.resampleTo16k(samples, sampleRate || gate.SAMPLE_RATE);
  const audioMs = Math.round((audio.length / gate.SAMPLE_RATE) * 1000);
  const level = gate.measure(audio);
  if (!level.passes) return { text: "", discarded: "silence", audioMs, level };
  // Models invent closing phrases ("Thank you.") for noise, so a final clip also needs Silero
  // to hear speech in it. Partials skip this: they are replaced by the final anyway.
  if (!partial && !containsSpeech(audio)) return { text: "", discarded: "no-speech", audioMs, level };
  const started = Date.now();
  const text = await decode(gate.padForParakeet(audio));
  return { text, audioMs, decodeMs: Date.now() - started, level };
}

// One request at a time: decodes share the recognizer and the CPU.
let queue = Promise.resolve();
onMessage((message) => {
  if (!message || typeof message !== "object") return;
  const { id, type } = message;
  queue = queue.then(async () => {
    try {
      const result = type === "load" ? await load(message) : type === "transcribe" ? await transcribe(message) : null;
      if (result === null) throw new Error(`Unknown request: ${type}`);
      send({ id, ok: true, result });
    } catch (error) {
      send({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
});

send({ type: "ready" });
