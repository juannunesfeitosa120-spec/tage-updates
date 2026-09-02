/* oxlint-disable typescript/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taggiDesktop', {
  getAppInfo: () => ipcRenderer.invoke('taggi:get-app-info'),
  getUpdateState: () => ipcRenderer.invoke('taggi:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('taggi:check-for-updates'),
  configureReleasePolicy: (policy) =>
    ipcRenderer.invoke('taggi:configure-release-policy', policy),
  installUpdate: () => ipcRenderer.invoke('taggi:install-update'),
  reportHealthy: (details) => ipcRenderer.invoke('taggi:report-healthy', details),
  showNotification: (payload) => ipcRenderer.invoke('taggi:show-notification', payload),
  copyText: (value) => ipcRenderer.invoke('taggi:copy-text', value),
  onUpdateState: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on('taggi:update-state', wrapped);
    return () => ipcRenderer.removeListener('taggi:update-state', wrapped);
  },
});
