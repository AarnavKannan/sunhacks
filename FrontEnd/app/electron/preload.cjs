const { contextBridge, ipcRenderer, webUtils } = require("electron");

/** Subscribe to a main→renderer channel; returns an unsubscribe function. */
function listen(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("reconstruct", {
  isDesktop: true,
  stageVideos: (files) => {
    const paths = files.map((file) => webUtils.getPathForFile(file));
    return ipcRenderer.invoke("footage:stage", paths);
  },

  /** The assistant runs in the main process; the renderer only sends text and renders events. */
  assistant: {
    providers: (refresh) => ipcRenderer.invoke("assistant:providers", Boolean(refresh)),
    choice: () => ipcRenderer.invoke("assistant:choice"),
    start: (opts) => ipcRenderer.invoke("assistant:start", opts),
    send: (text) => ipcRenderer.invoke("assistant:send", text),
    interrupt: () => ipcRenderer.invoke("assistant:interrupt"),
    onEvent: (callback) => listen("assistant:event", callback),
  },

  /**
   * The app implements the scene controller in the renderer. The main process calls it
   * (for MCP tools) with scene:call and gets the answer back on scene:result.
   */
  scene: {
    onCall: (callback) => listen("scene:call", callback),
    reply: (payload) => ipcRenderer.send("scene:result", payload),
  },

  /** Per-frame kinematics in MongoDB (electron/kinematics.ts). Read-only apart from sync. */
  kinematics: {
    status: () => ipcRenderer.invoke("kinematics:status"),
    sync: (meta, frames) => ipcRenderer.invoke("kinematics:sync", meta, frames),
    incident: (incidentId) => ipcRenderer.invoke("kinematics:incident", incidentId),
    sample: (incidentId, entityId, times) => ipcRenderer.invoke("kinematics:sample", incidentId, entityId, times),
    positions: (incidentId, t) => ipcRenderer.invoke("kinematics:positions", incidentId, t),
  },

  /** Gemini scene reading (electron/gemini.ts). The API key never reaches the renderer. */
  gemini: {
    status: () => ipcRenderer.invoke("gemini:status"),
    analyze: (files, opts) => ipcRenderer.invoke("gemini:analyze", files.map((file) => webUtils.getPathForFile(file)), opts ?? {}),
    saveScene: (record) => ipcRenderer.invoke("gemini:save-scene", record),
    listScenes: () => ipcRenderer.invoke("gemini:list-scenes"),
    onProgress: (callback) => listen("gemini:progress", callback),
  },

  /** Saves an exported video; returns the saved path. */
  saveExport: (bytes, fileName) => ipcRenderer.invoke("export:save", bytes, fileName),

  /** Voice transcription, implemented in electron/voice.cjs. */
  voice: {
    invoke: (method, ...args) => ipcRenderer.invoke(`voice:${method}`, ...args),
    on: (callback) => listen("voice:event", callback),
  },
});
