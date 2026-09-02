export type TaggiReleaseChannel = 'local' | 'beta' | 'stable';

export type TaggiAppInfo = {
  version: string;
  buildNumber: number;
  channel: TaggiReleaseChannel;
  effectiveChannel: TaggiReleaseChannel;
  installationIdHash: string;
  updaterEnabled: boolean;
  logPath: string;
  minimumSupportedVersion: string | null;
  latestVersion: string | null;
};

export type TaggiUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'up-to-date'
  | 'blocked'
  | 'health-check'
  | 'error';

export type TaggiUpdateState = {
  phase: TaggiUpdatePhase;
  currentVersion: string;
  channel: TaggiReleaseChannel;
  effectiveChannel: TaggiReleaseChannel;
  buildNumber: number;
  message: string;
  availableVersion?: string;
  progress?: number;
  releaseNotes?: string;
  errorCode?: string;
  minimumSupportedVersion?: string | null;
  latestVersion?: string | null;
};

type TaggiReleasePolicy = {
  channel: 'beta' | 'stable';
  blockedVersions: string[];
  minimumSupportedVersion: string | null;
  latestVersion: string | null;
};

declare global {
  interface Window {
    taggiUpdateGuard?: {
      prepare: () => boolean;
      cancel: () => void;
      dispose: () => void;
    };
    taggiDesktop?: {
      getAppInfo: () => Promise<TaggiAppInfo>;
      getUpdateState: () => Promise<TaggiUpdateState>;
      checkForUpdates: () => Promise<TaggiUpdateState>;
      configureReleasePolicy: (
        policy: TaggiReleasePolicy,
      ) => Promise<TaggiUpdateState>;
      installUpdate: () => Promise<{ ok: boolean; reason?: string }>;
      reportHealthy: (details: {
        rendererReady: boolean;
        settingsReadable: boolean;
        backendConfigured: boolean;
        backendReachable?: boolean;
      }) => Promise<{ ok: boolean; status: string }>;
      showNotification: (payload: {
        title: string;
        body: string;
      }) => Promise<{ ok: boolean }>;
      copyText: (value: string) => Promise<{ ok: boolean }>;
      onUpdateState: (
        listener: (state: TaggiUpdateState) => void,
      ) => () => void;
    };
  }
}
