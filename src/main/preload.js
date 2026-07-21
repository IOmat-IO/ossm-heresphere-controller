'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  app: {
    info: () => ipcRenderer.invoke('app-info')
  },
  bluetooth: {
    onDeviceList: (callback) => ipcRenderer.on('bluetooth-device-list', (_event, devices) => callback(devices)),
    selectDevice: (deviceId) => ipcRenderer.send('bluetooth-select-device', deviceId),
    cancelSelection: () => ipcRenderer.send('bluetooth-cancel-selection')
  },
  scripts: {
    chooseFolder: () => ipcRenderer.invoke('scripts-choose-folder'),
    setFolder: (rootPath) => ipcRenderer.invoke('scripts-set-folder', rootPath),
    restoreFolder: () => ipcRenderer.invoke('scripts-restore-folder'),
    refresh: () => ipcRenderer.invoke('scripts-refresh'),
    resolveVideo: (videoSource) => ipcRenderer.invoke('scripts-resolve-video', videoSource)
  },
  settings: {
    get: (key, fallback = null) => ipcRenderer.invoke('settings-get', key, fallback),
    set: (key, value) => ipcRenderer.invoke('settings-set', key, value)
  },
  powerSave: {
    status: () => ipcRenderer.invoke('power-save-status')
  },
  flight: {
    recordBatch: (events) => ipcRenderer.invoke('flight-record-batch', events),
    flush: () => ipcRenderer.invoke('flight-flush'),
    info: () => ipcRenderer.invoke('flight-info'),
    setEnabled: (enabled) => ipcRenderer.invoke('flight-set-enabled', enabled),
    purge: () => ipcRenderer.invoke('flight-purge'),
    openFolder: () => ipcRenderer.invoke('flight-open-folder')
  },
  hereSphere: {
    connect: (settings) => ipcRenderer.invoke('heresphere-connect', settings),
    autoConnect: (settings) => ipcRenderer.invoke('heresphere-auto-connect', settings),
    disconnect: () => ipcRenderer.invoke('heresphere-disconnect'),
    onStatus: (callback) => ipcRenderer.on('heresphere-status', (_event, status) => callback(status)),
    onTimestamp: (callback) => ipcRenderer.on('heresphere-timestamp', (_event, timestamp) => callback(timestamp)),
    onLog: (callback) => ipcRenderer.on('heresphere-log', (_event, message) => callback(message))
  }
});
