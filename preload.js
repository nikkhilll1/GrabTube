const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ─── Window Controls ──────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // ─── Video Info ────────────────────────────────────
  getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),

  // ─── Download ──────────────────────────────────────
  startDownload: (options) => ipcRenderer.invoke('start-download', options),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),

  // ─── Progress Events ──────────────────────────────
  onProgress: (callback) => {
    ipcRenderer.on('download-progress', (_event, data) => callback(data));
  },
  onComplete: (callback) => {
    ipcRenderer.on('download-complete', (_event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('download-error', (_event, data) => callback(data));
  },
  onAppStatus: (callback) => {
    ipcRenderer.on('app-status', (_event, data) => callback(data));
  },

  // ─── Folder ────────────────────────────────────────
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),

  // ─── Settings ──────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings)
});
