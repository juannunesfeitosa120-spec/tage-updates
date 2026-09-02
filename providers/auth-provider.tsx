'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import type { TaggiMembership, TaggiRole } from '@/lib/taggi';

const STORAGE_PREFIX = 'taggi:v1:';

type AuthContextValue = {
  booting: boolean;
  configured: boolean;
  session: Session | null;
  user: User | null;
  memberships: TaggiMembership[];
  activeMembership: TaggiMembership | null;
  accessNotice: string;
  refreshMemberships: (preferredGroupId?: string) => Promise<void>;
  setActiveGroupId: (groupId: string) => void;
  clearAccessNotice: () => void;
  signOut: (notice?: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function clearTaggiStorage() {
  for (const storage of [localStorage, sessionStorage]) {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<TaggiMembership[]>([]);
  const [activeGroupId, setActiveGroupIdState] = useState<string | null>(null);
  const [accessNotice, setAccessNotice] = useState('');
  const sessionUserId = session?.user.id;
  const refreshRevision = useRef(0);

  const refreshMemberships = useCallback(async (preferredGroupId?: string) => {
    if (!supabase) return;
    const revision = ++refreshRevision.current;
    const sessionResult = await supabase.auth.getSession();
    if (revision !== refreshRevision.current) return;
    const currentUser = sessionResult.data.session?.user;
    if (!currentUser) {
      setMemberships([]);
      setActiveGroupIdState(null);
      return;
    }

    // Preserve an explicit selection if a concurrent realtime refresh supersedes it.
    if (preferredGroupId) {
      localStorage.setItem(`${STORAGE_PREFIX}active-group:${currentUser.id}`, preferredGroupId);
      localStorage.removeItem(`${STORAGE_PREFIX}disconnected:${currentUser.id}`);
    }

    const memberResult = await supabase
      .from('taggi_group_members')
      .select('group_id,display_name,role,last_seen_at')
      .eq('user_id', currentUser.id)
      .eq('status', 'active')
      .order('joined_at');

    if (revision !== refreshRevision.current) return;
    if (memberResult.error) throw memberResult.error;
    const groupIds = (memberResult.data ?? []).map((member) => member.group_id);
    if (!groupIds.length) {
      setMemberships([]);
      setActiveGroupIdState(null);
      localStorage.removeItem(`${STORAGE_PREFIX}active-group:${currentUser.id}`);
      return;
    }

    const [groupResult, preferenceResult] = await Promise.all([
      supabase
        .from('taggi_groups')
        .select('id,code,name,admin_password_configured_at')
        .in('id', groupIds)
        .eq('status', 'active'),
      supabase
        .from('taggi_member_preferences')
        .select('group_id,tutorial_completed_at,tutorial_skipped,chat_retention_notice_seen')
        .eq('user_id', currentUser.id)
        .in('group_id', groupIds),
    ]);

    if (revision !== refreshRevision.current) return;
    if (groupResult.error) throw groupResult.error;
    if (preferenceResult.error) throw preferenceResult.error;
    const groups = new Map((groupResult.data ?? []).map((group) => [group.id, group]));
    const preferences = new Map((preferenceResult.data ?? []).map((item) => [item.group_id, item]));
    const next = (memberResult.data ?? []).flatMap((member) => {
      const group = groups.get(member.group_id);
      if (!group) return [];
      const preference = preferences.get(member.group_id);
      return [{
        groupId: group.id,
        groupCode: group.code,
        groupName: group.name,
        displayName: member.display_name,
        role: member.role as TaggiRole,
        lastSeenAt: member.last_seen_at,
        tutorialCompletedAt: preference?.tutorial_completed_at ?? null,
        tutorialSkipped: preference?.tutorial_skipped ?? false,
        chatRetentionNoticeSeen: preference?.chat_retention_notice_seen ?? false,
        adminPasswordConfigured: Boolean(group.admin_password_configured_at),
      } satisfies TaggiMembership];
    });

    const storageKey = `${STORAGE_PREFIX}active-group:${currentUser.id}`;
    const disconnectedKey = `${STORAGE_PREFIX}disconnected:${currentUser.id}`;
    if (preferredGroupId) localStorage.removeItem(disconnectedKey);
    const intentionallyDisconnected =
      !preferredGroupId && localStorage.getItem(disconnectedKey) === '1';
    const savedGroupId = localStorage.getItem(storageKey);
    const requestedGroupId = preferredGroupId || savedGroupId;
    const nextActive = intentionallyDisconnected
      ? null
      : next.find((item) => item.groupId === requestedGroupId)?.groupId ??
        next[0]?.groupId ??
        null;
    setMemberships(next);
    setActiveGroupIdState(nextActive);
    if (nextActive) localStorage.setItem(storageKey, nextActive);
    else localStorage.removeItem(storageKey);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setBooting(false);
      return;
    }
    let alive = true;
    void (async () => {
      const sessionResult = await supabase.auth.getSession();
      const savedSession = sessionResult.data.session;
      if (!alive) return;
      if (!savedSession) {
        setSession(null);
        setBooting(false);
        return;
      }

      const userResult = await supabase.auth.getUser();
      if (!alive) return;
      if (userResult.error || !userResult.data.user) {
        await supabase.auth.signOut({ scope: 'local' });
        if (!alive) return;
        setSession(null);
        setBooting(false);
        return;
      }

      setSession(savedSession);
    })().catch(() => {
      if (!alive) return;
      setSession(null);
      setBooting(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!alive) return;
      if (event === 'INITIAL_SESSION') return;
      setSession(nextSession);
      if (!nextSession) {
        setMemberships([]);
        setActiveGroupIdState(null);
        setBooting(false);
      }
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    let alive = true;
    void refreshMemberships()
      .catch(() => {
        if (alive) setMemberships([]);
      })
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionUserId, refreshMemberships]);

  const setActiveGroupId = useCallback((groupId: string) => {
    if (!session || !memberships.some((item) => item.groupId === groupId)) return;
    refreshRevision.current += 1;
    localStorage.removeItem(`${STORAGE_PREFIX}disconnected:${session.user.id}`);
    localStorage.setItem(`${STORAGE_PREFIX}active-group:${session.user.id}`, groupId);
    setActiveGroupIdState(groupId);
  }, [memberships, session]);

  const signOut = useCallback(async (notice = '') => {
    refreshRevision.current += 1;
    setAccessNotice(notice);
    if (session?.user.id) {
      localStorage.setItem(
        `${STORAGE_PREFIX}disconnected:${session.user.id}`,
        '1',
      );
      localStorage.removeItem(
        `${STORAGE_PREFIX}active-group:${session.user.id}`,
      );
    }
    setActiveGroupIdState(null);
  }, [session?.user.id]);

  const activeMembership = memberships.find((item) => item.groupId === activeGroupId) ?? null;
  const clearAccessNotice = useCallback(() => setAccessNotice(''), []);

  useEffect(() => {
    if (!supabase || !activeMembership) return;
    const client = supabase;
    let alive = true;
    let checking = false;

    const verifyEntitlement = async () => {
      if (checking) return;
      checking = true;
      try {
        const groupResult = await client
          .from('taggi_groups')
          .select('id')
          .eq('id', activeMembership.groupId)
          .eq('status', 'active')
          .maybeSingle();
        if (!alive || groupResult.error) return;
        if (!groupResult.data) {
          await signOut(
            'Esta equipe foi excluída ou seu acesso foi encerrado. Seus outros acessos salvos foram preservados.',
          );
          await refreshMemberships();
          return;
        }
        const result = await client.rpc('taggi_entitlement', {
          p_group_id: activeMembership.groupId,
        });
        if (!alive || result.error) return;
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        if (row && !row.allowed) {
          setAccessNotice(
            'A assinatura desta empresa foi cancelada ou expirou. O acesso foi encerrado.',
          );
          clearTaggiStorage();
          setMemberships([]);
          setActiveGroupIdState(null);
          await client.auth.signOut();
        }
      } finally {
        checking = false;
      }
    };

    void verifyEntitlement();
    const interval = window.setInterval(() => void verifyEntitlement(), 30000);
    const onFocus = () => void verifyEntitlement();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [activeMembership?.groupId, refreshMemberships, signOut]);

  const value = useMemo<AuthContextValue>(() => ({
    booting,
    configured: hasSupabaseConfig,
    session,
    user: session?.user ?? null,
    memberships,
    activeMembership,
    accessNotice,
    refreshMemberships,
    setActiveGroupId,
    clearAccessNotice,
    signOut,
  }), [booting, session, memberships, activeMembership, accessNotice, refreshMemberships, setActiveGroupId, clearAccessNotice, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return context;
}
