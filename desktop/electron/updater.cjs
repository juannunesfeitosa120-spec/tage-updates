/* oxlint-disable typescript/no-require-imports */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const {
  createRotatingLogger,
  createUpdateBackup,
  getInstallationIdHash,
  readUpdateTransition,
  writeUpdateTransition,
} = require('./persistence.cjs');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 20 * 1000;

function normalizeReleaseNotes(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => (typeof item === 'string' ? item : item?.note))
    .filter(Boolean)
    .join('\n');
}

function createTaggiUpdater({ buildChannel, buildNumber }) {
  const userDataPath = app.getPath('userData');
  const logger = createRotatingLogger(userDataPath);
  const installationIdHash = getInstallationIdHash(userDataPath);
  const enabled = app.isPackaged && buildChannel !== 'local';
  let window = null;
  let checkTimer = null;
  let initialTimer = null;
  let effectiveChannel = buildChannel === 'local' ? 'local' : 'stable';
  let blockedVersions = new Set();
  let minimumSupportedVersion = null;
  let latestVersion = null;
  let downloadedInfo = null;
  let backupPath = null;
  let state = {
    phase: enabled ? 'idle' : 'disabled',
    currentVersion: app.getVersion(),
    channel: buildChannel,
    effectiveChannel,
    buildNumber,
    message: enabled
      ? 'As atualizações serão verificadas em segundo plano.'
      : 'Atualizações desativadas nesta build local.',
  };

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;

  function broadcast(patch = {}) {
    state = {
      ...state,
      ...patch,
      channel: buildChannel,
      effectiveChannel,
      minimumSupportedVersion,
      latestVersion,
    };
    if (window && !window.isDestroyed()) {
      window.webContents.send('taggi:update-state', state);
    }
  }

  function applyChannel() {
    if (!enabled) return;
    autoUpdater.channel = effectiveChannel === 'beta' ? 'beta' : 'latest';
    autoUpdater.allowPrerelease = effectiveChannel === 'beta';
    autoUpdater.allowDowngrade = false;
  }

  async function checkForUpdates() {
    if (!enabled) {
      broadcast({ phase: 'disabled' });
      return state;
    }
    applyChannel();
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      logger.error('Falha ao verificar atualização', error);
      broadcast({
        phase: 'error',
        message: 'Não foi possível verificar atualizações agora. O Tage atual continua funcionando.',
        errorCode: error?.code ?? 'UPDATE_CHECK_FAILED',
      });
    }
    return state;
  }

  autoUpdater.on('checking-for-update', () => {
    broadcast({
      phase: 'checking',
      message: 'Verificando atualizações...',
      errorCode: undefined,
    });
  });

  autoUpdater.on('update-not-available', () => {
    broadcast({
      phase: 'up-to-date',
      message: 'O Tage está atualizado.',
      availableVersion: undefined,
      progress: undefined,
    });
  });

  autoUpdater.on('update-available', (info) => {
    if (blockedVersions.has(info.version)) {
      logger.warn('Release bloqueada ignorada', info.version);
      broadcast({
        phase: 'blocked',
        availableVersion: info.version,
        message: 'Uma versão retirada de circulação foi ignorada com segurança.',
      });
      return;
    }

    downloadedInfo = info;
    broadcast({
      phase: 'available',
      availableVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      message: 'Nova versão encontrada. Iniciando download em segundo plano...',
    });
    void autoUpdater.downloadUpdate().catch((error) => {
      logger.error('Falha no download da atualização', error);
      broadcast({
        phase: 'error',
        message: 'O download foi interrompido. O Tage atual não foi alterado e tentará novamente depois.',
        errorCode: error?.code ?? 'UPDATE_DOWNLOAD_FAILED',
      });
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      phase: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
      message: `Baixando atualização... ${Math.round(progress.percent)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedInfo = info;
    void createUpdateBackup(window, userDataPath, {
      fromVersion: app.getVersion(),
      toVersion: info.version,
      channel: effectiveChannel,
    })
      .then((createdBackupPath) => {
        backupPath = createdBackupPath;
        logger.info('Atualização pronta e backup verificado', info.version);
        broadcast({
          phase: 'ready',
          progress: 100,
          availableVersion: info.version,
          releaseNotes: normalizeReleaseNotes(info.releaseNotes),
          message: 'Atualização pronta.',
        });
      })
      .catch((error) => {
        logger.error('Backup pré-atualização falhou', error);
        broadcast({
          phase: 'error',
          message: 'A atualização não será instalada porque o backup de segurança não pôde ser confirmado.',
          errorCode: 'BACKUP_FAILED',
        });
      });
  });

  autoUpdater.on('error', (error) => {
    logger.error('Erro do updater', error);
    broadcast({
      phase: 'error',
      message: 'A atualização falhou. A versão instalada permanece disponível.',
      errorCode: error?.code ?? 'UPDATER_ERROR',
    });
  });

  function attachWindow(nextWindow) {
    window = nextWindow;
    window.webContents.once('did-finish-load', () => broadcast());
  }

  function configureReleasePolicy(policy = {}) {
    blockedVersions = new Set(
      Array.isArray(policy.blockedVersions)
        ? policy.blockedVersions.filter((version) => typeof version === 'string')
        : [],
    );
    minimumSupportedVersion =
      typeof policy.minimumSupportedVersion === 'string'
        ? policy.minimumSupportedVersion
        : null;
    latestVersion =
      typeof policy.latestVersion === 'string' ? policy.latestVersion : null;

    const requestedChannel = policy.channel === 'beta' ? 'beta' : 'stable';
    effectiveChannel = buildChannel === 'local' ? 'local' : requestedChannel;
    applyChannel();
    broadcast({
      phase: enabled ? 'idle' : 'disabled',
      message:
        effectiveChannel === 'beta'
          ? 'Este dispositivo está autorizado para receber versões Beta.'
          : 'Este dispositivo recebe somente versões Stable.',
    });
    if (enabled) void checkForUpdates();
    return state;
  }

  function installDownloadedUpdate() {
    if (state.phase !== 'ready' || !downloadedInfo || !backupPath) {
      return { ok: false, reason: 'UPDATE_NOT_READY' };
    }
    const transition = {
      status: 'pending-install',
      fromVersion: app.getVersion(),
      toVersion: downloadedInfo.version,
      channel: effectiveChannel,
      backupPath,
      createdAt: new Date().toISOString(),
    };
    writeUpdateTransition(userDataPath, transition);
    logger.info('Instalação autorizada pelo usuário', transition);
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  }

  function reportHealthy(details = {}) {
    const transition = readUpdateTransition(userDataPath);
    if (!transition || transition.toVersion !== app.getVersion()) {
      return { ok: true, status: 'no-pending-transition' };
    }
    const healthy =
      details.rendererReady === true &&
      details.settingsReadable === true &&
      typeof details.backendConfigured === 'boolean';
    const next = {
      ...transition,
      status: healthy ? 'healthy' : 'health-check-failed',
      checkedAt: new Date().toISOString(),
      health: {
        rendererReady: details.rendererReady === true,
        settingsReadable: details.settingsReadable === true,
        backendConfigured: details.backendConfigured === true,
        backendReachable:
          typeof details.backendReachable === 'boolean'
            ? details.backendReachable
            : null,
      },
    };
    writeUpdateTransition(userDataPath, next);
    logger[healthy ? 'info' : 'error']('Health check pós-atualização', next);
    return { ok: healthy, status: next.status };
  }

  function start() {
    const transition = readUpdateTransition(userDataPath);
    if (transition?.status === 'pending-install') {
      if (transition.toVersion === app.getVersion()) {
        broadcast({
          phase: 'health-check',
          message: 'Validando a atualização instalada...',
        });
      } else {
        writeUpdateTransition(userDataPath, {
          ...transition,
          status: 'not-applied',
          checkedAt: new Date().toISOString(),
        });
        logger.warn('A atualização pendente não foi aplicada; versão atual preservada.');
      }
    }
    if (!enabled) return;
    initialTimer = setTimeout(() => void checkForUpdates(), INITIAL_CHECK_DELAY_MS);
    checkTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  }

  function stop() {
    if (initialTimer) clearTimeout(initialTimer);
    if (checkTimer) clearInterval(checkTimer);
  }

  function getAppInfo() {
    return {
      version: app.getVersion(),
      buildNumber,
      channel: buildChannel,
      effectiveChannel,
      installationIdHash,
      updaterEnabled: enabled,
      logPath: logger.logPath,
      minimumSupportedVersion,
      latestVersion,
    };
  }

  return {
    attachWindow,
    checkForUpdates,
    configureReleasePolicy,
    getAppInfo,
    getState: () => state,
    installDownloadedUpdate,
    reportHealthy,
    start,
    stop,
  };
}

module.exports = { createTaggiUpdater };
