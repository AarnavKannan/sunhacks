/**
 * Speech model registry and first-run download.
 *
 * Files go to <userData>/voice-models/<model id>/, never into the repo. A download writes
 * `<file>.partial`, resumes it with an HTTP Range request after an interruption, checks the
 * byte count and SHA-256, then renames it into place and leaves a `<file>.ok` receipt so
 * later launches only compare sizes. (The partial file, resume, and receipt follow Hex's
 * model download in src/transcription/models.rs, https://github.com/anomalyco/hex, MIT.)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const hf = (repo, revision, name) => `https://huggingface.co/${repo}/resolve/${revision}/${name}`;

const PARAKEET_REPO = "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
const PARAKEET_REVISION = "84b478d541cdbf0c296a7ab5f1e20a6f8f998114";

/** NVIDIA Parakeet TDT 0.6B v2 (English), int8 ONNX export by the sherpa-onnx project. */
const PARAKEET_V2 = {
  id: "parakeet-tdt-0.6b-v2-int8",
  label: "Parakeet TDT 0.6B v2 (English)",
  files: [
    {
      name: "encoder.int8.onnx",
      url: hf(PARAKEET_REPO, PARAKEET_REVISION, "encoder.int8.onnx"),
      bytes: 652282309,
      sha256: "92a10bd9c23936ea0566c29f963bc57c2a5df4261b6a8921c39abea66557ca8b",
    },
    {
      name: "decoder.int8.onnx",
      url: hf(PARAKEET_REPO, PARAKEET_REVISION, "decoder.int8.onnx"),
      bytes: 7257753,
      sha256: "4d097bae3bac5c96018d5293ba39f1b657296102b142affda40378f38b020f41",
    },
    {
      name: "joiner.int8.onnx",
      url: hf(PARAKEET_REPO, PARAKEET_REVISION, "joiner.int8.onnx"),
      bytes: 1739080,
      sha256: "77a29f3e5ac7d37074e0af465391b80f314015d5b97f0f90c6c7767f1d56f428",
    },
    {
      name: "tokens.txt",
      url: hf(PARAKEET_REPO, PARAKEET_REVISION, "tokens.txt"),
      bytes: 9384,
      sha256: "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d",
    },
    {
      // Silero VAD as packaged by sherpa-onnx. Keeps silence and room noise away from
      // the recognizer, which would otherwise invent text for it.
      name: "silero_vad.onnx",
      url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
      bytes: 643854,
      sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
    },
  ],
};

const DEFAULT_MODEL = PARAKEET_V2;

function totalBytes(model) {
  return model.files.reduce((sum, file) => sum + file.bytes, 0);
}

function modelDir(root, model) {
  return path.join(root, model.id);
}

function filePaths(root, model) {
  const dir = modelDir(root, model);
  return Object.fromEntries(model.files.map((file) => [file.name, path.join(dir, file.name)]));
}

function sizeOf(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return -1;
  }
}

/** Installed means every file is in place at its pinned size and was verified once. */
function isFileInstalled(dir, file) {
  const target = path.join(dir, file.name);
  if (sizeOf(target) !== file.bytes) return false;
  try {
    return fs.readFileSync(`${target}.ok`, "utf8").trim() === file.sha256;
  } catch {
    return false;
  }
}

function isInstalled(root, model) {
  const dir = modelDir(root, model);
  return model.files.every((file) => isFileInstalled(dir, file));
}

/** Bytes already on disk (installed files plus partial downloads), for progress after a restart. */
function bytesOnDisk(root, model) {
  const dir = modelDir(root, model);
  return model.files.reduce((sum, file) => {
    if (isFileInstalled(dir, file)) return sum + file.bytes;
    return sum + Math.max(0, Math.min(file.bytes, sizeOf(path.join(dir, `${file.name}.partial`))));
  }, 0);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function downloadFile(dir, file, { signal, onBytes }) {
  const target = path.join(dir, file.name);
  const partial = `${target}.partial`;
  let have = Math.max(0, sizeOf(partial));
  if (have > file.bytes) {
    fs.rmSync(partial, { force: true });
    have = 0;
  }
  onBytes(have);

  if (have < file.bytes) {
    const headers = have > 0 ? { Range: `bytes=${have}-` } : {};
    const response = await fetch(file.url, { headers, signal, redirect: "follow" });
    if (response.status === 200 && have > 0) {
      // The server ignored the range: start over.
      have = 0;
      fs.rmSync(partial, { force: true });
      onBytes(0);
    } else if (response.status !== 200 && response.status !== 206) {
      throw new Error(`Download of ${file.name} failed: HTTP ${response.status}`);
    }
    if (!response.body) throw new Error(`Download of ${file.name} returned no data`);
    let received = have;
    const counter = new (require("stream").Transform)({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        onBytes(received);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(partial, { flags: have > 0 ? "a" : "w" }), {
      signal,
    });
  }

  const size = sizeOf(partial);
  if (size !== file.bytes) throw new Error(`Download of ${file.name} is incomplete (${size} of ${file.bytes} bytes)`);
  const digest = await sha256File(partial);
  if (digest !== file.sha256) {
    fs.rmSync(partial, { force: true });
    throw new Error(`Download of ${file.name} is corrupt (checksum mismatch); it will start over next time`);
  }
  fs.renameSync(partial, target);
  fs.writeFileSync(`${target}.ok`, `${file.sha256}\n`);
}

/**
 * Downloads every missing file of `model` into root/<id>. `onProgress({ received, total, file })`
 * fires as bytes arrive. Rejects with an AbortError if `signal` aborts; the partial files stay
 * for the next attempt.
 */
async function ensureModel(root, model, { signal, onProgress = () => {} } = {}) {
  const dir = modelDir(root, model);
  fs.mkdirSync(dir, { recursive: true });
  const total = totalBytes(model);
  let done = 0;
  for (const file of model.files) {
    if (isFileInstalled(dir, file)) {
      done += file.bytes;
      onProgress({ received: done, total, file: file.name });
      continue;
    }
    // A file at the right size without a receipt (copied in by hand): verify it instead.
    const target = path.join(dir, file.name);
    if (sizeOf(target) === file.bytes && (await sha256File(target)) === file.sha256) {
      fs.writeFileSync(`${target}.ok`, `${file.sha256}\n`);
    } else {
      fs.rmSync(target, { force: true });
      const base = done;
      await downloadFile(dir, file, { signal, onBytes: (bytes) => onProgress({ received: base + bytes, total, file: file.name }) });
    }
    done += file.bytes;
    onProgress({ received: done, total, file: file.name });
  }
  return filePaths(root, model);
}

module.exports = { DEFAULT_MODEL, PARAKEET_V2, totalBytes, modelDir, filePaths, isInstalled, bytesOnDisk, ensureModel };
