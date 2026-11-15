const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("reconstruct", {
  isDesktop: true,
});
