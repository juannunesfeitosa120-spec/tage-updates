'use client';

import { useCallback, useEffect, useState } from 'react';

import type {
  TaggiAppInfo,
  TaggiUpdateState,
} from '@/desktop/taggi-desktop';

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
  const [updateState, setUpdateState] =
    useState<TaggiUpdateState>(webFallback);

  useEffect(() => {
    const desktop = window.taggiDesktop;
    if (!desktop) return;
    let alive = true;
    const removeListener = desktop.onUpdateState((state) => {
      if (alive) setUpdateState(state);
    });
    void Promise.all([desktop.getAppInfo(), desktop.getUpdateState()]).then(
      ([info, state]) => {
        if (!alive) return;
        setAppInfo(info);
        setUpdateState(state);
      },
    );
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
    await window.taggiDesktop.checkForUpdates();
  }, []);

  const installUpdate = useCallback(async () => {
    await window.taggiDesktop?.installUpdate();
  }, []);

  return {
    appInfo,
    updateState,
    checkForUpdates,
    installUpdate,
  };
}
