const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vay", {
  savedHost() {
    return ipcRenderer.invoke("saved-host");
  },
  connect(url) {
    return ipcRenderer.invoke("connect", url);
  },
  listTabs() {
    return ipcRenderer.invoke("tabs-list");
  },
  newTab() {
    return ipcRenderer.invoke("tabs-new");
  },
  selectTab(id) {
    return ipcRenderer.invoke("tabs-select", id);
  },
  closeTab(id) {
    return ipcRenderer.invoke("tabs-close", id);
  },
  changeHost() {
    return ipcRenderer.invoke("change-host");
  },
  onTabs(callback) {
    const listener = (_event, items) => callback(items);
    ipcRenderer.on("tabs-changed", listener);
    return () => ipcRenderer.removeListener("tabs-changed", listener);
  },
});
