import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createUpdateBackup,
  getInstallationIdHash,
} = require('../../desktop/electron/persistence.cjs');

void test('cria backup verificado e mantém somente os dois mais recentes', async () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'taggi-backup-test-'),
  );
  const window = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async () => ({
        localStorage: {
          'taggi:v1:ui-preferences': '{"theme":"dark"}',
          'sb-project-auth-token': '{"access_token":"test"}',
        },
        sessionStorage: {},
      }),
    },
  };

  try {
    for (let index = 0; index < 3; index += 1) {
      await createUpdateBackup(window, temporaryDirectory, {
        fromVersion: `1.0.${index}`,
        toVersion: `1.0.${index + 1}`,
        channel: 'beta',
      });
    }
    const backups = fs.readdirSync(
      path.join(temporaryDirectory, 'taggi-backups'),
    );
    assert.equal(backups.length, 2);
    const newest = JSON.parse(
      fs.readFileSync(
        path.join(temporaryDirectory, 'taggi-backups', backups.at(-1)),
        'utf8',
      ),
    );
    assert.equal(newest.integrity.algorithm, 'sha256');
    assert.match(newest.integrity.value, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

void test('identificador de instalação é aleatório, persistente e enviado como hash', () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'taggi-installation-test-'),
  );
  try {
    const first = getInstallationIdHash(temporaryDirectory);
    const second = getInstallationIdHash(temporaryDirectory);
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
