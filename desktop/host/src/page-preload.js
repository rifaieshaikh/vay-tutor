const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vayDesktop", {
  isHost: true,
  pickBackupSavePath(suggestedName) {
    return ipcRenderer.invoke("backup-pick-save", suggestedName);
  },
  writeBackupFile(filePath, data) {
    return ipcRenderer.invoke("backup-write-file", filePath, data);
  },
});
