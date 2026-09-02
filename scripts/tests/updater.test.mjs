import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const flush = async () => {
  for (let index = 0; index < 5; index += 1) await new Promise(setImmediate);
};

function fixture(t, buildChannel = 'beta') {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tage-updater-test-'));
  const native = new EventEmitter();
  const calls = { checks: 0, downloads: 0, installs: [], cancelled: 0, backups: 0 };
  const safety = { ready: true, backupFailure: false, installFailure: false, holdBackup: /** @type {Promise<void> | null} */ (null) };
  native.checkForUpdates = async () => { calls.checks += 1; };
  native.downloadUpdate = async () => { calls.downloads += 1; };
  native.quitAndInstall = (...args) => {
    if (safety.installFailure) throw new Error('Installer unavailable');
    calls.installs.push(args);
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return { app: {
      getPath: () => directory, getVersion: () => '1.1.5', isPackaged: true,
    } };
    if (request === 'electron-updater') return { autoUpdater: native };
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve('../../desktop/electron/updater.cjs');
  delete require.cache[modulePath];
  let loaded;
  try {
    loaded = require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
  const updater = loaded.createTaggiUpdater({ buildChannel, buildNumber: 10 });
  updater.attachWindow({
    isDestroyed: () => false,
    webContents: {
      once() {}, send() {},
      async executeJavaScript(script) {
        if (script.includes('prepare()')) return safety.ready;
        if (script.includes('cancel()')) { calls.cancelled += 1; return; }
        calls.backups += 1;
        if (safety.holdBackup) await safety.holdBackup;
        if (safety.backupFailure) throw new Error('Backup unavailable');
        return { localStorage: {}, sessionStorage: {} };
      },
    },
  });
  t.after(() => {
    updater.stop();
    fs.rmSync(directory, { recursive: true, force: true });
    delete require.cache[modulePath];
  });
  const ready = async () => {
    native.emit('update-downloaded', { version: '1.1.6', releaseNotes: 'Atualização automática.' });
    await flush();
  };
  return { updater, native, calls, safety, ready, normalize: loaded.normalizeReleaseNotes };
}

void test('baixa sem clique, preserva estado e instala silenciosamente uma única vez', async (t) => {
  const { updater, native, calls, ready, normalize } = fixture(t);
  assert.equal(normalize('<h2>Novidades</h2><ul><li>Login salvo.</li></ul>'), 'Novidades\n• Login salvo.');
  await Promise.all([updater.checkForUpdates(), updater.checkForUpdates()]);
  assert.equal(calls.checks, 1);
  native.emit('update-available', { version: '1.1.6' });
  await flush();
  assert.equal(calls.downloads, 1);
  native.emit('download-progress', { percent: 64.6 });
  assert.equal(updater.getState().progress, 65);
  await ready();
  assert.equal(updater.getState().phase, 'ready');
  updater.configureReleasePolicy({ channel: 'beta', blockedVersions: [], latestVersion: '1.1.6' });
  assert.equal(updater.getState().phase, 'ready');
  assert.equal(calls.checks, 1);
  t.mock.timers.tick(3000);
  await flush();
  assert.deepEqual(calls.installs, [[true, true]]);
  assert.equal(calls.backups, 2, 'backup atualizado imediatamente antes da instalação');
  assert.equal(updater.getState().phase, 'installing');
  t.mock.timers.tick(9000);
  await flush();
  assert.equal(calls.installs.length, 1);
});

void test('aguarda rascunho ou envio e retoma sozinha quando o renderer libera', async (t) => {
  const { updater, calls, safety, ready } = fixture(t);
  safety.ready = false;
  await ready();
  t.mock.timers.tick(6000);
  await flush();
  assert.equal(calls.installs.length, 0);
  assert.equal(updater.getState().phase, 'ready');
  safety.ready = true;
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls.installs.length, 1);
});

void test('não instala release bloqueada antes nem depois do download', async (t) => {
  const { updater, native, calls, ready } = fixture(t);
  await ready();
  updater.configureReleasePolicy({ channel: 'beta', blockedVersions: ['1.1.6'] });
  native.emit('update-available', { version: '1.1.6' });
  native.emit('download-progress', { percent: 99 });
  await ready();
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls.downloads, 0);
  assert.equal(calls.installs.length, 0);
  assert.equal(updater.getState().phase, 'blocked');
});

void test('revogação durante o backup impede a instalação', async (t) => {
  const { updater, calls, safety, ready } = fixture(t);
  await ready();
  let release;
  safety.holdBackup = new Promise((resolve) => { release = resolve; });
  const installing = updater.installDownloadedUpdate();
  await flush();
  updater.configureReleasePolicy({ channel: 'beta', blockedVersions: ['1.1.6'] });
  release();
  await installing;
  assert.equal(calls.installs.length, 0);
  assert.equal(updater.getState().phase, 'blocked');
  assert.ok(calls.cancelled > 0);
});

void test('falha no backup preserva versão e libera a interface', async (t) => {
  const { updater, calls, safety, ready } = fixture(t);
  await ready();
  safety.backupFailure = true;
  assert.deepEqual(await updater.installDownloadedUpdate(), { ok: false, reason: 'BACKUP_FAILED' });
  assert.equal(calls.installs.length, 0);
  assert.equal(updater.getState().phase, 'error');
  assert.ok(calls.cancelled > 0);
});

void test('falha no instalador não deixa a interface travada', async (t) => {
  const { updater, calls, safety, ready } = fixture(t);
  await ready();
  safety.installFailure = true;
  assert.deepEqual(await updater.installDownloadedUpdate(), { ok: false, reason: 'UPDATE_INSTALL_FAILED' });
  assert.equal(updater.getState().phase, 'error');
  assert.ok(calls.cancelled > 0);
});

void test('encerrar o updater cancela a instalação pendente', async (t) => {
  const { updater, calls, ready } = fixture(t);
  await ready();
  updater.stop();
  t.mock.timers.tick(6000);
  await flush();
  assert.equal(calls.installs.length, 0);
});

void test('build local nunca instala atualização', async (t) => {
  const { updater, calls, ready } = fixture(t, 'local');
  updater.start();
  await ready();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(calls.installs.length, 0);
  assert.equal(calls.checks, 0);
  assert.equal(updater.getState().phase, 'disabled');
});

void test('verifica ao abrir e a cada quinze minutos', async (t) => {
  const { updater, calls } = fixture(t);
  updater.start();
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(calls.checks, 1);
  t.mock.timers.tick(15 * 60 * 1000);
  await flush();
  assert.equal(calls.checks, 2);
});
