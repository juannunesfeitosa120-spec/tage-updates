/* oxlint-disable typescript/no-require-imports */
const { app, BrowserWindow, ipcMain, Notification, session, shell } = require('electron');
const path = require('node:path');

const packageMetadata = require('../../package.json');
const { createTaggiUpdater } = require('./updater.cjs');

const isDevelopment = !app.isPackaged;
const buildChannel = isDevelopment
  ? 'local'
  : packageMetadata.taggiReleaseChannel === 'beta'
    ? 'beta'
    : packageMetadata.taggiReleaseChannel === 'local'
      ? 'local'
      : 'stable';
const buildNumber = Number(packageMetadata.buildNumber) || 1;

let mainWindow = null;
let updater = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#05080d',
    icon: path.join(__dirname, '../../public/taggi-app-icon.png'),
    title: buildChannel === 'beta' ? 'Tage Beta' : 'Tage',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const developmentUrl = process.env.TAGGI_DESKTOP_DEV_URL;
    if (isDevelopment && developmentUrl && url.startsWith(developmentUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });

  if (isDevelopment && process.env.TAGGI_DESKTOP_DEV_URL) {
    void window.loadURL(process.env.TAGGI_DESKTOP_DEV_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../../dist-desktop/index.html'));
  }

  mainWindow = window;
  updater.attachWindow(window);
  return window;
}

function registerUpdaterIpc() {
  ipcMain.handle('taggi:get-app-info', () => updater.getAppInfo());
  ipcMain.handle('taggi:get-update-state', () => updater.getState());
  ipcMain.handle('taggi:check-for-updates', () => updater.checkForUpdates());
  ipcMain.handle('taggi:configure-release-policy', (_event, policy) =>
    updater.configureReleasePolicy(policy),
  );
  ipcMain.handle('taggi:install-update', () => updater.installDownloadedUpdate());
  ipcMain.handle('taggi:report-healthy', (_event, details) =>
    updater.reportHealthy(details),
  );
  ipcMain.handle('taggi:show-notification', (_event, payload = {}) => {
    if (!Notification.isSupported()) return { ok: false };
    const title = String(payload.title ?? 'Tage').slice(0, 120);
    const body = String(payload.body ?? '').slice(0, 500);
    if (!body) return { ok: false };
    new Notification({ title, body, icon: path.join(__dirname, '../../public/taggi-app-icon.png') }).show();
    return { ok: true };
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    updater = createTaggiUpdater({ buildChannel, buildNumber });
    registerUpdaterIpc();
    createWindow();
    updater.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => updater?.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
