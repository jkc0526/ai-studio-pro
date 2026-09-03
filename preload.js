const { ipcRenderer } = require('electron');

// Expose safe IPC methods to renderer process
window.electronAPI = {
  // App version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Update related
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Update event listeners
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_, info) => callback(info)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_, info) => callback(info)),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (_, error) => callback(error)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_, progress) => callback(progress)),

  // Check if running in Electron
  isElectron: () => typeof process !== 'undefined' && process.versions && !!process.versions.electron
};
