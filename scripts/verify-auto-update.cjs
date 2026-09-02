/* oxlint-disable typescript/no-require-imports */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Isolated Electron process: no real installer, account or production data.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tage-native-update-'));
app.setPath('userData', directory);
Object.defineProperty(app, 'isPackaged', { value: true });
const native = new EventEmitter();
const installs = [];
native.checkForUpdates = async () => {};
native.downloadUpdate = async () => {};
native.quitAndInstall = (...args) => installs.push(args);
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'electron-updater') return { autoUpdater: native };
  return originalLoad.call(this, request, parent, isMain);
};
const { createTaggiUpdater } = require('../desktop/electron/updater.cjs');
Module._load = originalLoad;

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
async function waitUntil(predicate) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('O atualizador não avançou no prazo do teste.');
    await wait(25);
  }
}

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const updater = createTaggiUpdater({ buildChannel: 'beta', buildNumber: 10 });
  updater.attachWindow(window);
  try {
    await window.loadFile(path.join(__dirname, 'tests/fixtures/update-guard.html'));
    const guardSource = fs.readFileSync(path.join(__dirname, '../desktop/update-guard.mjs'), 'utf8')
      .replace('export function installUpdateGuard', 'function installUpdateGuard');
    await window.webContents.executeJavaScript(guardSource + `
      window.testClock = 0;
      window.taggiUpdateGuard = installUpdateGuard(window, () => window.testClock);
      const draft = document.getElementById('draft');
      draft.focus();
      // A hidden test window does not receive OS focus/typing events by itself.
      draft.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: 'mensagem' }));
      draft.value = 'mensagem não enviada';
      window.testClock = 31000;
      localStorage.setItem('taggi:update-test', 'preservado');
    `);
    assert.equal(await window.webContents.executeJavaScript('window.taggiUpdateGuard.prepare()'), false);
    native.emit('update-downloaded', { version: '1.1.7', releaseNotes: 'Teste isolado.' });
    await waitUntil(() => updater.getState().phase === 'ready');
    await wait(3200);
    assert.equal(installs.length, 0, 'não deve instalar enquanto há um rascunho');
    await window.webContents.executeJavaScript("document.getElementById('draft').value = ''; document.getElementById('root').dataset.updateBusy = 'true'");
    await wait(3100);
    assert.equal(installs.length, 0, 'um rascunho mantido em outra aba também impede a instalação');
    await window.webContents.executeJavaScript("document.getElementById('root').dataset.updateBusy = 'false'");
    await waitUntil(() => installs.length > 0);
    assert.deepEqual(installs, [[true, true]], 'instalador silencioso com reabertura automática');
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('root').inert"), true);
    const transition = JSON.parse(fs.readFileSync(path.join(directory, 'taggi-system/update-transition.json'), 'utf8'));
    const backup = JSON.parse(fs.readFileSync(transition.backupPath, 'utf8'));
    assert.equal(backup.data.localStorage['taggi:update-test'], 'preservado');
    console.log('PASS: Electron real, rascunho protegido, instalação sem clique, backup atualizado e reabertura silenciosa.');
  } finally {
    updater.stop();
    window.destroy();
  }
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
