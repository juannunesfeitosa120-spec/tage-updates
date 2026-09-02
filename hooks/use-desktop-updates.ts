'use client';

import { useCallback, useEffect, useState } from 'react';

import type { TaggiAppInfo, TaggiUpdateState } from '@/desktop/taggi-desktop';

const webFallback: TaggiUpdateState = {
  phase: 'disabled',
  currentVersion: '1.0.0',
  channel: 'local',
  effectiveChannel: 'local',
  buildNumber: 1,
  message: 'Atualizações disponíveis somente no aplicativo desktop.',
};

export function useDesktopUpdates() {
  const [appInfo, setAppInfo] = useState<TaggiAppInfo | null>(null);
  const [updateState, setUpdateState] = useState<TaggiUpdateState>(webFallback);

  useEffect(() => {
    const desktop = window.taggiDesktop;
    if (!desktop) return;
    let alive = true;
    const removeListener = desktop.onUpdateState((state) => {
      if (alive) setUpdateState(state);
    });
    void Promise.all([desktop.getAppInfo(), desktop.getUpdateState()])
      .then(([info, state]) => {
        if (!alive) return;
        setAppInfo(info);
        setUpdateState(state);
      })
      .catch(() => {
        if (!alive) return;
        setUpdateState((current) => ({
          ...current,
          phase: 'error',
          message:
            'Não foi possível consultar o atualizador agora. O Tage continua funcionando normalmente.',
          errorCode: 'UPDATE_STATE_UNAVAILABLE',
        }));
      });
    return () => {
      alive = false;
      removeListener();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!window.taggiDesktop) return;
    setUpdateState((current) => ({
      ...current,
      phase: 'checking',
      message: 'Verificando atualizações...',
    }));
    try {
      await window.taggiDesktop.checkForUpdates();
    } catch {
      setUpdateState((current) => ({
        ...current,
        phase: 'error',
        message:
          'Não foi possível verificar atualizações agora. Tente novamente mais tarde.',
        errorCode: 'UPDATE_CHECK_UNAVAILABLE',
      }));
    }
  }, []);

  const installUpdate = useCallback(async () => {
    try {
      const result = await window.taggiDesktop?.installUpdate();
      if (result && !result.ok) {
        setUpdateState((current) => ({
          ...current,
          message:
            'A atualização ainda não está pronta para ser aplicada. Verifique novamente em instantes.',
        }));
      }
    } catch {
      setUpdateState((current) => ({
        ...current,
        phase: 'error',
        message:
          'Não foi possível iniciar a atualização. Feche e abra o Tage e tente novamente.',
        errorCode: 'UPDATE_INSTALL_UNAVAILABLE',
      }));
    }
  }, []);

  return {
    appInfo,
    updateState,
    checkForUpdates,
    installUpdate,
  };
}
