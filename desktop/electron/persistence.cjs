/* oxlint-disable typescript/no-require-imports */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BACKUP_LIMIT = 2;
const MAX_LOG_BYTES = 1024 * 1024;

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJsonAtomically(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const temporaryPath = filePath + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getSystemDirectory(userDataPath) {
  return path.join(userDataPath, 'taggi-system');
}

function getInstallationIdHash(userDataPath) {
  const filePath = path.join(getSystemDirectory(userDataPath), 'installation.json');
  let record = readJson(filePath);
  if (!record?.installationId) {
    record = {
      installationId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    writeJsonAtomically(filePath, record);
  }
  return hash('taggi-installation:' + record.installationId);
}

function pruneBackups(backupDirectory) {
  const backups = fs
    .readdirSync(backupDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => ({
      name: entry.name,
      modifiedAt: fs.statSync(path.join(backupDirectory, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const obsolete of backups.slice(BACKUP_LIMIT)) {
    fs.unlinkSync(path.join(backupDirectory, obsolete.name));
  }
}

async function createUpdateBackup(window, userDataPath, transition) {
  if (!window || window.isDestroyed()) {
    throw new Error('A janela do Tage não está disponível para criar o backup.');
  }

  const storage = await window.webContents.executeJavaScript(
    `(() => {
      const keep = (key) =>
        key.startsWith('taggi:') ||
        (key.startsWith('sb-') && key.endsWith('-auth-token'));
      const collect = (source) => {
        const result = {};
        for (let index = 0; index < source.length; index += 1) {
          const key = source.key(index);
          if (key && keep(key)) result[key] = source.getItem(key);
        }
        return result;
      };
      return {
        localStorage: collect(window.localStorage),
        sessionStorage: collect(window.sessionStorage),
      };
    })()`,
    true,
  );

  const createdAt = new Date().toISOString();
  const payload = {
    format: 1,
    createdAt,
    fromVersion: transition.fromVersion,
    toVersion: transition.toVersion,
    channel: transition.channel,
    data: storage,
  };
  const serializedPayload = JSON.stringify(payload);
  const backup = {
    ...payload,
    integrity: {
      algorithm: 'sha256',
      value: hash(serializedPayload),
    },
  };

  const backupDirectory = path.join(userDataPath, 'taggi-backups');
  ensureDirectory(backupDirectory);
  const safeTimestamp = createdAt.replaceAll(':', '-');
  const backupPath = path.join(
    backupDirectory,
    `backup-${transition.fromVersion}-to-${transition.toVersion}-${safeTimestamp}.json`,
  );

  writeJsonAtomically(backupPath, backup);
  const verified = readJson(backupPath);
  if (!verified?.integrity || verified.integrity.value !== hash(JSON.stringify(payload))) {
    throw new Error('O backup foi criado, mas falhou na verificação de integridade.');
  }

  pruneBackups(backupDirectory);
  return backupPath;
}

function getTransitionPath(userDataPath) {
  return path.join(getSystemDirectory(userDataPath), 'update-transition.json');
}

function readUpdateTransition(userDataPath) {
  return readJson(getTransitionPath(userDataPath));
}

function writeUpdateTransition(userDataPath, transition) {
  writeJsonAtomically(getTransitionPath(userDataPath), transition);
}

function createRotatingLogger(userDataPath) {
  const logDirectory = path.join(userDataPath, 'logs');
  const logPath = path.join(logDirectory, 'taggi-updater.log');
  ensureDirectory(logDirectory);

  const append = (level, values) => {
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
        const previousPath = logPath + '.1';
        if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
        fs.renameSync(logPath, previousPath);
      }
      const message = values
        .map((value) => {
          if (value instanceof Error) return value.stack ?? value.message;
          if (typeof value === 'string') return value;
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .join(' ');
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] [${level}] ${message}\n`,
        'utf8',
      );
    } catch {
      // Logging must never stop the application.
    }
  };

  return {
    debug: (...values) => append('DEBUG', values),
    info: (...values) => append('INFO', values),
    warn: (...values) => append('WARN', values),
    error: (...values) => append('ERROR', values),
    logPath,
  };
}

module.exports = {
  createRotatingLogger,
  createUpdateBackup,
  getInstallationIdHash,
  readUpdateTransition,
  writeUpdateTransition,
};
