/**
 * Starts worker.cjs in its own process and talks to it with request ids.
 *
 * Inside Electron it uses utilityProcess (a Node process Electron manages); from plain Node,
 * for tests, child_process.fork with the advanced serializer so Float32Arrays cross intact.
 */
const path = require("path");

const WORKER = path.join(__dirname, "worker.cjs");

/** The folder that holds sherpa-onnx's native libraries for this platform, for the loader path. */
function nativeLibraryDir() {
  const platform = process.platform === "win32" ? "win" : process.platform;
  try {
    return path.dirname(require.resolve(`sherpa-onnx-${platform}-${process.arch}/package.json`));
  } catch {
    return null;
  }
}

function workerEnv() {
  const env = { ...process.env };
  const dir = nativeLibraryDir();
  if (dir && process.platform === "linux") env.LD_LIBRARY_PATH = [dir, env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  if (dir && process.platform === "darwin") env.DYLD_LIBRARY_PATH = [dir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(":");
  return env;
}

function spawn() {
  let electron = null;
  try {
    electron = require("electron");
  } catch {
    electron = null;
  }
  if (electron && typeof electron === "object" && electron.utilityProcess) {
    const child = electron.utilityProcess.fork(WORKER, [], { serviceName: "Voice transcription", env: workerEnv(), stdio: "inherit" });
    return {
      post: (message) => child.postMessage(message),
      onMessage: (handler) => child.on("message", handler),
      onExit: (handler) => child.on("exit", handler),
      kill: () => child.kill(),
    };
  }
  const child = require("child_process").fork(WORKER, [], { env: workerEnv(), serialization: "advanced", stdio: "inherit" });
  return {
    post: (message) => child.send(message),
    onMessage: (handler) => child.on("message", handler),
    onExit: (handler) => child.on("exit", (code) => handler(code)),
    kill: () => child.kill(),
  };
}

class Engine {
  constructor() {
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    /** Called once with the exit code when the worker dies unexpectedly. */
    this.onCrash = () => {};
  }

  start() {
    if (this.child) return;
    const child = spawn();
    this.child = child;
    child.onMessage((message) => {
      if (!message || message.id === undefined) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(new Error(message.error));
    });
    child.onExit((code) => {
      if (this.child !== child) return;
      this.child = null;
      const error = new Error(`The speech engine stopped (exit code ${code})`);
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
      this.onCrash(code);
    });
  }

  request(type, payload = {}) {
    this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.post({ id, type, ...payload });
    });
  }

  /** Stops the worker. Its exit is expected, so onCrash doesn't fire. */
  stop() {
    const child = this.child;
    this.child = null;
    for (const waiter of this.pending.values()) waiter.reject(new Error("The speech engine was stopped"));
    this.pending.clear();
    child?.kill();
  }
}

module.exports = { Engine };
