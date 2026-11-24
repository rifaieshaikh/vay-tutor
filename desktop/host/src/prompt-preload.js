const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vayPrompt", {
  submit: (payload) => ipcRenderer.send("prompt-submit", payload),
});
