import { supabase } from '@/lib/supabase';
import type { TaggiAppInfo } from '@/desktop/taggi-desktop';

export type ReleasePolicy = {
  channel: 'beta' | 'stable';
  blockedVersions: string[];
  minimumSupportedVersion: string | null;
  latestVersion: string | null;
};

export async function loadReleasePolicy(
  appInfo: TaggiAppInfo,
): Promise<ReleasePolicy> {
  const fallback: ReleasePolicy = {
    channel: appInfo.channel === 'beta' ? 'beta' : 'stable',
    blockedVersions: [],
    minimumSupportedVersion: null,
    latestVersion: null,
  };
  if (!supabase || appInfo.channel === 'local') return fallback;

  try {
    const [deviceResult, policyResult] = await Promise.all([
      supabase.rpc('taggi_touch_release_device', {
        p_installation_hash: appInfo.installationIdHash,
        p_app_version: appInfo.version,
        p_build_number: appInfo.buildNumber,
        p_health_status: 'running',
      }),
      supabase
        .from('taggi_release_policy')
        .select('latest_version,minimum_supported_version,blocked_versions')
        .eq('id', true)
        .maybeSingle(),
    ]);

    const device = deviceResult.error
      ? null
      : Array.isArray(deviceResult.data)
        ? deviceResult.data[0]
        : deviceResult.data;
    const policy = policyResult.error ? null : policyResult.data;

    return {
      channel:
        appInfo.channel === 'beta'
          ? 'beta'
          : deviceResult.error
            ? fallback.channel
            : device?.enabled && device?.channel === 'beta'
              ? 'beta'
              : 'stable',
      blockedVersions: Array.isArray(policy?.blocked_versions)
        ? policy.blocked_versions.filter(
            (version): version is string => typeof version === 'string',
          )
        : [],
      minimumSupportedVersion:
        typeof policy?.minimum_supported_version === 'string'
          ? policy.minimum_supported_version
          : null,
      latestVersion:
        typeof policy?.latest_version === 'string'
          ? policy.latest_version
          : null,
    };
  } catch {
    return fallback;
  }
}

export function compareVersions(left: string, right: string) {
  const parse = (value: string) =>
    value
      .split('-')[0]
      .split('.')
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}
