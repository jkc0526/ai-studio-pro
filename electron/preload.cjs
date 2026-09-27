const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weaveUpdates', {
  getVersion: () => ipcRenderer.invoke('weave-updates:get-version'),
  getStatus: () => ipcRenderer.invoke('weave-updates:get-status'),
  getRecentReleases: () => ipcRenderer.invoke('weave-updates:get-recent-releases'),
  check: () => ipcRenderer.invoke('weave-updates:check'),
  download: () => ipcRenderer.invoke('weave-updates:download'),
  install: () => ipcRenderer.invoke('weave-updates:install'),
  onStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('weave-updates:status', listener);
    return () => ipcRenderer.removeListener('weave-updates:status', listener);
  },
});
