const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("reconstruct", {
  isDesktop: true,
  stageVideos: (files) => {
    const paths = files.map((file) => webUtils.getPathForFile(file));
    return ipcRenderer.invoke("footage:stage", paths);
  },
});
