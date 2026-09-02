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

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 2 * 1000;
const AUTO_INSTALL_INTERVAL_MS = 3 * 1000;
const ACTIVE_PHASES = new Set([
  'checking',
  'available',
  'downloading',
  'ready',
  'installing',
  'health-check',
]);

function normalizeReleaseNotes(value) {
  const raw =
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value
            .map((item) => (typeof item === 'string' ? item : item?.note))
            .filter(Boolean)
            .join('\n')
        : '';
  if (!raw) return '';

  return raw
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:h[1-6]|p|div|li|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function createTaggiUpdater({ buildChannel, buildNumber }) {
  const userDataPath = app.getPath('userData');
  const logger = createRotatingLogger(userDataPath);
  const installationIdHash = getInstallationIdHash(userDataPath);
  const enabled = app.isPackaged && buildChannel !== 'local';
  let window = null;
  let checkTimer = null;
  let initialTimer = null;
  let installTimer = null;
  let installPromise = null;
  let stopped = false;
  let effectiveChannel =
    buildChannel === 'local'
      ? 'local'
      : buildChannel === 'beta'
        ? 'beta'
        : 'stable';
  let blockedVersions = new Set();
  let minimumSupportedVersion = null;
  let latestVersion = null;
  let downloadedInfo = null;
  let backupPath = null;
  let checkPromise = null;
  let downloadPromise = null;
  let backupPromise = null;
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
    if (
      checkPromise ||
      state.phase === 'available' ||
      state.phase === 'downloading' ||
      state.phase === 'ready' ||
      state.phase === 'installing'
    ) {
      return state;
    }
    applyChannel();
    checkPromise = autoUpdater
      .checkForUpdates()
      .catch((error) => {
        logger.error('Falha ao verificar atualização', error);
        broadcast({
          phase: 'error',
          message:
            'Não foi possível verificar atualizações agora. O Tage atual continua funcionando.',
          errorCode: error?.code ?? 'UPDATE_CHECK_FAILED',
        });
      })
      .finally(() => {
        checkPromise = null;
      });
    await checkPromise;
    return state;
  }

  function downloadAvailableUpdate(info) {
    if (downloadPromise || state.phase === 'ready') return;
    downloadedInfo = info;
    broadcast({
      phase: 'available',
      availableVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      message: 'Nova versão encontrada. Iniciando download em segundo plano...',
      errorCode: undefined,
    });
    downloadPromise = autoUpdater
      .downloadUpdate()
      .catch((error) => {
        logger.error('Falha no download da atualização', error);
        broadcast({
          phase: 'error',
          message:
            'O download foi interrompido. O Tage atual não foi alterado e tentará novamente depois.',
          errorCode: error?.code ?? 'UPDATE_DOWNLOAD_FAILED',
        });
      })
      .finally(() => {
        downloadPromise = null;
      });
  }

  autoUpdater.on('checking-for-update', () => {
    if (['downloading', 'ready', 'installing'].includes(state.phase)) return;
    broadcast({
      phase: 'checking',
      message: 'Verificando atualizações...',
      errorCode: undefined,
    });
  });

  autoUpdater.on('update-not-available', () => {
    if (['downloading', 'ready', 'installing'].includes(state.phase)) return;
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
        message:
          'Uma versão retirada de circulação foi ignorada com segurança.',
      });
      return;
    }

    downloadAvailableUpdate(info);
  });

  autoUpdater.on('download-progress', (progress) => {
    if (downloadedInfo && blockedVersions.has(downloadedInfo.version)) return;
    broadcast({
      phase: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
      message: `Baixando atualização... ${Math.round(progress.percent)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (!enabled || stopped || blockedVersions.has(info.version)) return;
    if (
      backupPromise ||
      (['ready', 'installing'].includes(state.phase) && downloadedInfo?.version === info.version)
    ) {
      return;
    }
    downloadedInfo = info;
    backupPromise = createUpdateBackup(window, userDataPath, {
      fromVersion: app.getVersion(),
      toVersion: info.version,
      channel: effectiveChannel,
    })
      .then((createdBackupPath) => {
        if (stopped || blockedVersions.has(info.version)) return;
        backupPath = createdBackupPath;
        logger.info('Atualização pronta e backup verificado', info.version);
        broadcast({
          phase: 'ready',
          progress: 100,
          availableVersion: info.version,
          releaseNotes: normalizeReleaseNotes(info.releaseNotes),
          message: 'Pronta. O Tage reiniciará sozinho após 30 segundos sem edição ou envio em andamento.',
        });
        if (!stopped && !installTimer) {
          installTimer = setInterval(() => void installDownloadedUpdate(), AUTO_INSTALL_INTERVAL_MS);
        }
      })
      .catch((error) => {
        logger.error('Backup pré-atualização falhou', error);
        broadcast({
          phase: 'error',
          message:
            'A atualização não será instalada porque o backup de segurança não pôde ser confirmado.',
          errorCode: 'BACKUP_FAILED',
        });
      })
      .finally(() => {
        backupPromise = null;
      });
  });

  autoUpdater.on('error', (error) => {
    logger.error('Erro do updater', error);
    if (state.phase === 'ready') return;
    cancelRendererLock();
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
        ? policy.blockedVersions.filter(
            (version) => typeof version === 'string',
          )
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
    if (downloadedInfo && blockedVersions.has(downloadedInfo.version)) {
      if (installTimer) clearInterval(installTimer);
      installTimer = null;
      cancelRendererLock();
      broadcast({ phase: 'blocked', message: 'Uma versão retirada de circulação foi ignorada com segurança.' });
      return state;
    }
    if (!ACTIVE_PHASES.has(state.phase)) {
      broadcast({
        phase: enabled ? 'idle' : 'disabled',
        message:
          effectiveChannel === 'beta'
            ? 'Este dispositivo está autorizado para receber versões Beta.'
            : 'Este dispositivo recebe somente versões Stable.',
      });
    } else {
      broadcast();
    }
    if (enabled && !ACTIVE_PHASES.has(state.phase)) void checkForUpdates();
    return state;
  }

  function cancelRendererLock() {
    if (window && !window.isDestroyed()) {
      void window.webContents.executeJavaScript('window.taggiUpdateGuard?.cancel()')
        .catch((error) => logger.warn('Não foi possível liberar a interface', error));
    }
  }

  function installDownloadedUpdate() {
    if (installPromise) return installPromise;
    installPromise = prepareAndInstall().finally(() => { installPromise = null; });
    return installPromise;
  }

  async function prepareAndInstall() {
    if (!enabled || stopped || state.phase !== 'ready' || !downloadedInfo || !backupPath) {
      return { ok: false, reason: 'UPDATE_NOT_READY' };
    }
    if (blockedVersions.has(downloadedInfo.version)) return { ok: false, reason: 'UPDATE_BLOCKED' };
    try {
      const safe = window && !window.isDestroyed() && await window.webContents.executeJavaScript(
        'window.taggiUpdateGuard?.prepare() === true',
      );
      if (!safe) return { ok: false, reason: 'WORK_IN_PROGRESS' };
      broadcast({ phase: 'installing', message: 'Aplicando atualização. O Tage reabrirá sozinho; basta aguardar.' });
      // Refresh the backup only after locking input and new writes, not just at download time.
      backupPath = await createUpdateBackup(window, userDataPath, {
        fromVersion: app.getVersion(), toVersion: downloadedInfo.version, channel: effectiveChannel,
      });
      if (stopped || blockedVersions.has(downloadedInfo.version)) {
        cancelRendererLock();
        return { ok: false, reason: 'UPDATE_CANCELLED' };
      }
    } catch (error) {
      logger.error('Não foi possível preparar a instalação automática', error);
      cancelRendererLock();
      broadcast({ phase: 'error', message: 'Não foi possível preparar a atualização com segurança. O Tage continua funcionando.', errorCode: 'BACKUP_FAILED' });
      return { ok: false, reason: 'BACKUP_FAILED' };
    }
    const transition = {
      status: 'pending-install',
      fromVersion: app.getVersion(),
      toVersion: downloadedInfo.version,
      channel: effectiveChannel,
      backupPath,
      createdAt: new Date().toISOString(),
    };
    try {
      writeUpdateTransition(userDataPath, transition);
      logger.info('Instalação automática iniciada após verificação de segurança', transition);
      // electron-updater 6.x: silent install, then reopen the app automatically.
      autoUpdater.quitAndInstall(true, true);
      return state.phase === 'error' ? { ok: false, reason: 'UPDATE_INSTALL_FAILED' } : { ok: true };
    } catch (error) {
      logger.error('Falha ao iniciar a instalação da atualização', error);
      cancelRendererLock();
      try {
        writeUpdateTransition(userDataPath, {
          ...transition,
          status: 'install-start-failed',
          checkedAt: new Date().toISOString(),
        });
      } catch (transitionError) {
        logger.error('Não foi possível registrar a falha de instalação', transitionError);
      }
      broadcast({
        phase: 'error',
        message:
          'Não foi possível reiniciar automaticamente. Feche e abra o Tage e tente novamente.',
        errorCode: error?.code ?? 'UPDATE_INSTALL_FAILED',
      });
      return { ok: false, reason: 'UPDATE_INSTALL_FAILED' };
    }
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
    stopped = false;
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
        logger.warn(
          'A atualização pendente não foi aplicada; versão atual preservada.',
        );
      }
    }
    if (!enabled) return;
    initialTimer = setTimeout(
      () => void checkForUpdates(),
      INITIAL_CHECK_DELAY_MS,
    );
    checkTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  }

  function stop() {
    stopped = true;
    if (initialTimer) clearTimeout(initialTimer);
    if (checkTimer) clearInterval(checkTimer);
    if (installTimer) clearInterval(installTimer);
    initialTimer = null;
    checkTimer = null;
    installTimer = null;
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

module.exports = {
  createTaggiUpdater,
  normalizeReleaseNotes,
};
