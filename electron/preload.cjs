"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (action, payload) =>
  ipcRenderer.invoke("optimizer:request", action, payload);

contextBridge.exposeInMainWorld(
  "optimizer",
  Object.freeze({
    getState: () => invoke("state"),
    listTweaks: () => ipcRenderer.invoke("optimizer:catalog"),
    scan: () => invoke("scan"),
    applyTweaks: (ids, options) => invoke("apply", { ...options, ids }),
    restoreBackup: (id, options) => invoke("restore", { ...options, id }),
    createRestorePoint: (options) => invoke("restorePoint", options),
    analyzeCleanup: () => invoke("analyzeCleanup"),
    clean: (ids, options) => invoke("clean", { ...options, ids }),
    cs2Scan: () => invoke("cs2Scan"),
    cs2Apply: (options) => invoke("cs2Apply", options),
    cs2Restore: (options) => invoke("cs2Restore", options),
    elevate: (options) => ipcRenderer.invoke("optimizer:elevate", options),
    onProgress: (callback) => {
      const listener = (_event, update) => callback(update);
      ipcRenderer.on("optimizer:progress", listener);
      return () => ipcRenderer.removeListener("optimizer:progress", listener);
    },
  }),
);
