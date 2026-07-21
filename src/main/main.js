'use strict';

const { app, BrowserWindow, ipcMain, session, dialog, powerSaveBlocker, shell } = require('electron');
const path = require('path');
const { HereSphereClient } = require('./heresphere-client');
const { DEFAULT_HERESPHERE_PORT, discoverHereSphere } = require('./heresphere-discovery');
const fs = require('fs/promises');
const { scanFunscriptFolder, resolveFunscript } = require('./script-library');
const { SettingsStore } = require('./settings-store');
const { DiagnosticLogManager } = require('./flight-recorder');

app.commandLine.appendSwitch('enable-experimental-web-platform-features');

let mainWindow = null;
let pendingBluetoothCallback = null;
const deviceCache = new Map();
let hereSphereClient = null;
let scriptLibrary = { root: '', entries: [] };
let hereSphereAutoConnectPromise = null;
let settingsStore = null;
let powerSaveBlockerId = null;
let diagnosticLogs = null;
let quittingAfterFlightFlush = false;

function ensurePowerSaveBlocker() {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) return powerSaveBlockerId;
  powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  return powerSaveBlockerId;
}

function powerSaveStatus() {
  ensurePowerSaveBlocker();
  return {
    active: powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId),
    mode: 'prevent-display-sleep'
  };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function isOssmDevice(device) {
  return String(device.deviceName || '').toLowerCase().includes('ossm');
}

function sendDeviceList() {
  const devices = Array.from(deviceCache.values())
    .filter(isOssmDevice)
    .sort((a, b) => String(a.deviceName).localeCompare(String(b.deviceName)));
  sendToRenderer('bluetooth-device-list', devices);
}



function librarySummary() {
  return {
    root: scriptLibrary.root,
    count: scriptLibrary.entries.length,
    entries: scriptLibrary.entries.map(({ relativePath, name }) => ({ relativePath, name }))
  };
}

async function loadScriptLibrary(rootPath, { persist = false } = {}) {
  scriptLibrary = await scanFunscriptFolder(rootPath);
  if (persist && settingsStore) await settingsStore.set('scriptLibraryRoot', scriptLibrary.root);
  return librarySummary();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#111417',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      experimentalFeatures: true,
      backgroundThrottling: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    pendingBluetoothCallback = callback;

    for (const device of deviceList) {
      deviceCache.set(device.deviceId, {
        deviceId: device.deviceId,
        deviceName: device.deviceName || '(périphérique sans nom)'
      });
    }

    sendDeviceList();
  });

  mainWindow.on('closed', () => {
    hereSphereClient?.disconnect();
    hereSphereClient = null;
    mainWindow = null;
    pendingBluetoothCallback = null;
    deviceCache.clear();
  });
}

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  const logsEnabled = Boolean(await settingsStore.get('diagnosticLogsEnabled', false));
  diagnosticLogs = new DiagnosticLogManager(path.join(app.getPath('appData'), 'ossm-heresphere', 'logs'), {
    enabled: logsEnabled,
    appVersion: app.getVersion()
  });
  await diagnosticLogs.readyPromise;
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ['bluetooth', 'bluetoothScanning', 'bluetoothDevices'].includes(permission);
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['bluetooth', 'bluetoothScanning', 'bluetoothDevices'].includes(permission));
  });

  ensurePowerSaveBlocker();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.on('bluetooth-select-device', (_event, deviceId) => {
  if (!pendingBluetoothCallback) return;
  pendingBluetoothCallback(deviceId || '');
  pendingBluetoothCallback = null;
  deviceCache.clear();
});

ipcMain.on('bluetooth-cancel-selection', () => {
  if (!pendingBluetoothCallback) return;
  pendingBluetoothCallback('');
  pendingBluetoothCallback = null;
  deviceCache.clear();
});

function connectHereSphere(host, port = DEFAULT_HERESPHERE_PORT) {
  hereSphereClient?.disconnect();
  hereSphereClient = new HereSphereClient({
    onStatus: (status) => sendToRenderer('heresphere-status', status),
    onTimestamp: (timestamp) => sendToRenderer('heresphere-timestamp', timestamp),
    onLog: (message) => sendToRenderer('heresphere-log', message)
  });
  hereSphereClient.connect(host, port);
}

ipcMain.handle('heresphere-connect', (_event, settings) => {
  const host = String(settings?.host || '').trim();
  if (!host) throw new Error('Adresse HereSphere manquante.');
  connectHereSphere(host, DEFAULT_HERESPHERE_PORT);
  return { ok: true, host, port: DEFAULT_HERESPHERE_PORT };
});

ipcMain.handle('heresphere-auto-connect', async (_event, settings) => {
  if (hereSphereAutoConnectPromise) return hereSphereAutoConnectPromise;
  hereSphereAutoConnectPromise = (async () => {
    const preferredHost = String(settings?.preferredHost || '').trim();
    sendToRenderer('heresphere-status', { state: 'discovering', message: `Recherche automatique sur le port ${DEFAULT_HERESPHERE_PORT}…` });
    const result = await discoverHereSphere({ preferredHost, port: DEFAULT_HERESPHERE_PORT });
    if (!result) throw new Error(`Aucun serveur HereSphere détecté sur le port ${DEFAULT_HERESPHERE_PORT}.`);
    connectHereSphere(result.host, result.port);
    return { ok: true, ...result };
  })();
  try {
    return await hereSphereAutoConnectPromise;
  } finally {
    hereSphereAutoConnectPromise = null;
  }
});

ipcMain.handle('heresphere-disconnect', () => {
  hereSphereClient?.disconnect();
  hereSphereClient = null;
  return { ok: true };
});



ipcMain.handle('app-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  author: 'IOmat'
}));

ipcMain.handle('settings-get', async (_event, key, fallback = null) => {
  if (!settingsStore) return fallback;
  return settingsStore.get(String(key || ''), fallback);
});

ipcMain.handle('settings-set', async (_event, key, value) => {
  if (!settingsStore) throw new Error('Configuration Electron indisponible.');
  await settingsStore.set(String(key || ''), value);
  return { ok: true };
});

ipcMain.handle('power-save-status', () => powerSaveStatus());

ipcMain.handle('flight-record-batch', async (_event, events) => {
  if (!diagnosticLogs) throw new Error('Enregistreur de diagnostic indisponible.');
  if (!Array.isArray(events)) throw new Error('Lot de diagnostic invalide.');
  await diagnosticLogs.appendBatch(events.slice(0, 2000));
  return { ok: true };
});

ipcMain.handle('flight-flush', async () => {
  if (!diagnosticLogs) return { ok: false };
  return { ok: true, ...(await diagnosticLogs.flush()) };
});

ipcMain.handle('flight-info', async () => {
  if (!diagnosticLogs) return { enabled: false, rootDir: '', filePath: '', sessionId: '', totalBytes: 0, totalLimitBytes: 0 };
  return diagnosticLogs.status();
});

ipcMain.handle('flight-set-enabled', async (_event, enabled) => {
  if (!diagnosticLogs || !settingsStore) throw new Error('Enregistreur de diagnostic indisponible.');
  const status = await diagnosticLogs.setEnabled(Boolean(enabled));
  await settingsStore.set('diagnosticLogsEnabled', status.enabled);
  return status;
});

ipcMain.handle('flight-purge', async () => {
  if (!diagnosticLogs) throw new Error('Enregistreur de diagnostic indisponible.');
  return diagnosticLogs.purge();
});

ipcMain.handle('flight-open-folder', async () => {
  if (!diagnosticLogs) throw new Error('Enregistreur de diagnostic indisponible.');
  const status = await diagnosticLogs.flush();
  const result = await shell.openPath(status.rootDir);
  if (result) throw new Error(result);
  return { ok: true, ...status };
});


ipcMain.handle('scripts-choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir le dossier réservoir de funscripts',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  const summary = await loadScriptLibrary(result.filePaths[0], { persist: true });
  return { canceled: false, ...summary };
});

ipcMain.handle('scripts-set-folder', async (_event, rootPath) => {
  return loadScriptLibrary(rootPath, { persist: true });
});

ipcMain.handle('scripts-restore-folder', async () => {
  const rootPath = String(await settingsStore.get('scriptLibraryRoot', '') || '').trim();
  if (!rootPath) return { status: 'none', root: '', count: 0, entries: [] };
  try {
    const summary = await loadScriptLibrary(rootPath);
    return { status: 'restored', ...summary };
  } catch (error) {
    return { status: 'unavailable', root: rootPath, count: 0, entries: [], error: error.message };
  }
});

ipcMain.handle('scripts-refresh', async () => {
  if (!scriptLibrary.root) throw new Error('Aucun dossier de scripts sélectionné.');
  return loadScriptLibrary(scriptLibrary.root);
});

ipcMain.handle('scripts-resolve-video', async (_event, videoSource) => {
  if (!scriptLibrary.root) return { status: 'no-folder', root: '', count: 0 };
  const resolution = resolveFunscript(scriptLibrary.entries, videoSource);
  if (resolution.status !== 'match') {
    return {
      ...resolution,
      root: scriptLibrary.root,
      count: scriptLibrary.entries.length,
      matches: resolution.matches.map(({ relativePath, name }) => ({ relativePath, name }))
    };
  }
  const content = await fs.readFile(resolution.match.path, 'utf8');
  return {
    ...resolution,
    root: scriptLibrary.root,
    count: scriptLibrary.entries.length,
    match: {
      relativePath: resolution.match.relativePath,
      name: resolution.match.name
    },
    content
  };
});

app.on('before-quit', (event) => {
  if (quittingAfterFlightFlush) return;
  event.preventDefault();
  quittingAfterFlightFlush = true;
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }
  powerSaveBlockerId = null;
  Promise.resolve(diagnosticLogs?.close())
    .catch(() => {})
    .finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
