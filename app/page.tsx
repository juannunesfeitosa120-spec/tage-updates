'use client';

import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  BarChart3,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  History,
  Home,
  ImagePlus,
  Info,
  KeyRound,
  LayoutDashboard,
  LogOut,
  LockKeyhole,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Monitor,
  Moon,
  Palette,
  PackageOpen,
  Plus,
  Rocket,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Sun,
  Trash2,
  Users,
  Wifi,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AccessPanel } from '@/components/taggi/access-panel';
import { TeamDeletionPanel } from '@/components/taggi/team-deletion-panel';
import { ChatPanel } from '@/components/taggi/chat-panel';
import { HomeDashboard } from '@/components/taggi/home-dashboard';
import {
  InventoryAdminPanel,
  InventoryPanel,
} from '@/components/taggi/inventory-panel';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { useDesktopUpdates } from '@/hooks/use-desktop-updates';
import { compareVersions, loadReleasePolicy } from '@/lib/release-client';
import { supabase } from '@/lib/supabase';
import {
  AVATAR_BUCKET,
  createSignedImageUrl,
  PLATFORM_LOGO_BUCKET,
  removePrivateImage,
  uploadPrivateImage,
} from '@/lib/taggi-media';
import {
  readableError,
  roleLabels,
  roleLevel,
  type TaggiRole,
} from '@/lib/taggi';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import './taggi.css';

type View =
  | 'home'
  | 'inventory'
  | 'launch'
  | 'history'
  | 'chat'
  | 'admin'
  | 'settings';
type ThemeChoice = 'light' | 'dark' | 'auto';
type AdminSection =
  | 'dashboard'
  | 'platforms'
  | 'team'
  | 'inventory'
  | 'security';
type PlatformStore = {
  id: string;
  name: string;
};
type Platform = {
  id: string;
  name: string;
  value: number;
  accent: string;
  brandColor: string;
  initials: string;
  occurrences: number;
  logoPath: string | null;
  logoUrl: string;
  stores: PlatformStore[];
};
type Member = {
  id: string;
  userId: string;
  displayName: string;
  role: TaggiRole;
  lastSeenAt: string;
  avatarUrl: string;
};
type HistoryEvent = {
  id: string;
  platformId: string;
  storeId: string;
  storeName: string;
  delta: number;
  eventType: string;
  reason: string | null;
  user: string;
  createdAt: string;
  workDate: string;
};
const navigation = [
  { id: 'home' as const, label: 'Início', icon: Home },
  { id: 'launch' as const, label: 'Lançamento', icon: Rocket },
  { id: 'inventory' as const, label: 'Insumos', icon: PackageOpen },
  { id: 'history' as const, label: 'Histórico', icon: History },
  { id: 'chat' as const, label: 'Chat', icon: MessageCircle },
  { id: 'admin' as const, label: 'Administração', icon: LockKeyhole },
];

const themeOptions = [
  { id: 'light' as const, label: 'Claro', icon: Sun },
  { id: 'dark' as const, label: 'Escuro', icon: Moon },
  { id: 'auto' as const, label: 'Automático', icon: Monitor },
];

const accentColors = [
  '#ff4f87',
  '#ef4b55',
  '#f2bd12',
  '#22bd72',
  '#1684ff',
  '#8b6cff',
];
const UI_PREFERENCES_KEY = 'taggi:v1:ui-preferences';
const tutorialSlides = [
  {
    title: 'Sua equipe no Tage',
    text: 'Cada equipe possui um espaço exclusivo, vazio e sincronizado entre os computadores.',
    steps: [
      'Quem cria a equipe entra automaticamente como Gestor.',
      'Abra o menu do perfil para copiar o código exclusivo da equipe.',
      'Os funcionários escolhem Entrar com código e usam esse mesmo código no primeiro acesso.',
    ],
    icon: Users,
  },
  {
    title: 'Primeiro: plataformas e lojas',
    text: 'Comece a operação criando a estrutura que sua equipe realmente usa.',
    steps: [
      'Abra Administração e informe a senha criada pelo Gestor ao formar a equipe.',
      'Entre em Plataformas e lojas e clique em Nova plataforma.',
      'Cadastre a primeira loja. Depois use Configurar para adicionar as demais lojas dessa plataforma.',
    ],
    icon: Store,
  },
  {
    title: 'Lançamento rápido',
    text: 'Registre uma contagem inteira sem tirar as mãos do teclado.',
    steps: [
      'Selecione a plataforma; somente as lojas vinculadas a ela serão sugeridas.',
      'Digite o nome da loja e pressione TAB para completar.',
      'Informe a quantidade na mesma linha e pressione ENTER para lançar.',
    ],
    icon: Rocket,
  },
  {
    title: 'Controle de insumos',
    text: 'Cadastre produtos, conte o estoque e acompanhe cada movimentação.',
    steps: [
      'Use Editar insumo para adicionar itens e ajustar quantidades.',
      'Marque urgências de compra e finalize o inventário para avisar a Administração.',
      'Use Dar baixa sempre que um item for consumido; o estoque é validado no servidor.',
    ],
    icon: PackageOpen,
  },
  {
    title: 'Equipe e chat',
    text: 'Tudo é sincronizado entre os computadores conectados pelo mesmo código da equipe.',
    steps: [
      'Veja quem está online e converse no grupo ou em particular.',
      'Fotos aparecem diretamente na conversa; outros arquivos continuam disponíveis para download.',
      'A Administração permite alterar cargos e revogar acessos.',
    ],
    icon: MessageCircle,
  },
  {
    title: 'Histórico e fechamento diário',
    text: 'O Tage preserva as contagens de forma organizada e auditável.',
    steps: [
      'Os lançamentos do dia aparecem em tempo real para toda a equipe.',
      'À meia-noite, as contagens são confirmadas, zeradas e enviadas ao Histórico.',
      'Consulte os consolidados por mês e registre correções quando necessário.',
    ],
    icon: History,
  },
  {
    title: 'Acesso protegido',
    text: 'O código conecta o dispositivo à equipe e a senha administrativa protege as configurações.',
    steps: [
      'Crie uma equipe nova ou use o código exclusivo para entrar em uma existente.',
      'Depois disso, o Tage mantém a sessão neste computador até você se desconectar.',
      'Use a senha da Administração definida pelo Gestor ao criar a equipe.',
    ],
    icon: ShieldCheck,
  },
];

const formatNumber = (value: number) =>
  new Intl.NumberFormat('pt-BR').format(value);
const formText = (data: FormData, key: string, fallback = '') => {
  const value = data.get(key);
  return typeof value === 'string' ? value : fallback;
};
const todaySaoPaulo = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
const monthAgoSaoPaulo = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(date);
};
const millisecondsUntilNextSaoPauloMidnight = () => {
  const now = new Date();
  const saoPauloNow = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
  );
  const nextMidnight = new Date(saoPauloNow);
  nextMidnight.setHours(24, 0, 0, 150);
  return Math.max(1000, nextMidnight.getTime() - saoPauloNow.getTime());
};
const formatRemoteTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));

async function copyText(text: string) {
  if (window.taggiDesktop?.copyText) {
    const result = await window.taggiDesktop.copyText(text);
    return result.ok;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function evaluateExpression(expression: string) {
  const normalized = expression.replace(/\s/g, '');
  if (!/^\d+(?:[+-]\d+)*$/.test(normalized)) return null;
  const parts = normalized.match(/[+-]?\d+/g);
  if (!parts) return null;
  return Math.max(
    0,
    parts.reduce((total, part) => total + Number(part), 0),
  );
}

function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex items-end justify-between gap-5">
      <div>
        <h1 className="text-[31px] font-semibold tracking-[-0.035em] text-[var(--text-main)]">
          {title}
        </h1>
        <p className="mt-1.5 text-[16px] text-[var(--text-soft)]">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function BrandMark({
  isDark,
  compact = false,
}: {
  isDark: boolean;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <img
        src="./taggi-app-icon.png"
        alt="Tage"
        className="size-12 shrink-0 rounded-2xl"
      />
    );
  }
  return (
    <div className="tage-brand max-sm:hidden">
      <img src="./taggi-app-icon.png" alt="" className="tage-brand-icon" />
      <span
        className="max-lg:hidden"
        style={{ color: isDark ? '#f8fafc' : '#111318' }}
      >
        tage
      </span>
    </div>
  );
}

function PlatformMark({
  platform,
  className,
}: {
  platform: Platform | undefined;
  className: string;
}) {
  if (platform?.logoUrl) {
    return (
      <span className={className + ' overflow-hidden bg-white'}>
        <img
          src={platform.logoUrl}
          alt={'Logo ' + platform.name}
          className="size-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      className={className}
      style={{
        background: platform?.brandColor ?? '#1684ff',
        color: platform?.brandColor === '#080a0d' ? '#fff' : '#111',
      }}
    >
      {platform?.initials ?? 'T'}
    </span>
  );
}

function TaggiWorkspace() {
  const {
    booting,
    session,
    activeMembership: groupSession,
    refreshMemberships,
    signOut,
  } = useAuth();
  const [view, setView] = useState<View>('home');
  const [theme, setTheme] = useState<ThemeChoice>('dark');
  const [systemDark, setSystemDark] = useState(true);
  const [accent, setAccent] = useState('#1684ff');
  const [platformNumberColor, setPlatformNumberColor] = useState('auto');
  const [totalColor, setTotalColor] = useState('#1684ff');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [search, setSearch] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [teamAccessOpen, setTeamAccessOpen] = useState(false);
  const [avatarPath, setAvatarPath] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [addPlatformOpen, setAddPlatformOpen] = useState(false);
  const [managePlatformId, setManagePlatformId] = useState<string | null>(null);
  const [platformEditName, setPlatformEditName] = useState('');
  const [platformEditColor, setPlatformEditColor] = useState('#1684ff');
  const [platformLogoFile, setPlatformLogoFile] = useState<File | null>(null);
  const [newStoreName, setNewStoreName] = useState('');
  const [platformBusy, setPlatformBusy] = useState(false);
  const [occurrencePlatformId, setOccurrencePlatformId] = useState<
    string | null
  >(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetReason, setResetReason] = useState(
    'Fechamento da contagem diária',
  );
  const [correctionEvent, setCorrectionEvent] = useState<HistoryEvent | null>(
    null,
  );
  const [correctionValue, setCorrectionValue] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [toast, setToast] = useState('');
  const [inventoryUnread, setInventoryUnread] = useState(0);
  const [dayClosed, setDayClosed] = useState(false);
  const [appConfirm, setAppConfirm] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const [selectedPlatformId, setSelectedPlatformId] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [expression, setExpression] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminSession, setAdminSession] = useState<{
    id: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const [adminError, setAdminError] = useState('');
  const [currentAdminPassword, setCurrentAdminPassword] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [adminSection, setAdminSection] = useState<AdminSection>('dashboard');
  const [tutorialStep, setTutorialStep] = useState(0);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');
  const [setupError, setSetupError] = useState('');
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [networkState, setNetworkState] = useState<
    'connecting' | 'connected' | 'error'
  >('connecting');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const { appInfo, updateState, checkForUpdates } =
    useDesktopUpdates();

  const isDark = theme === 'dark' || (theme === 'auto' && systemDark);
  const isBeta = true;
  const minimumRequired = Boolean(
    appInfo &&
    updateState.minimumSupportedVersion &&
    compareVersions(appInfo.version, updateState.minimumSupportedVersion) < 0,
  );
  const updateBusy = ['checking', 'available', 'downloading', 'ready', 'installing'].includes(
    updateState.phase,
  );
  const resolvedPlatformColor =
    platformNumberColor === 'auto'
      ? isDark
        ? '#f5f7fa'
        : '#15181d'
      : platformNumberColor;
  const total = useMemo(
    () => platforms.reduce((sum, platform) => sum + platform.value, 0),
    [platforms],
  );
  const filteredPlatforms = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    if (!query) return platforms;
    return platforms.filter(
      (platform) =>
        platform.name.toLocaleLowerCase('pt-BR').includes(query) ||
        platform.stores.some((store) =>
          store.name.toLocaleLowerCase('pt-BR').includes(query),
        ),
    );
  }, [platforms, search]);
  const launchResult = evaluateExpression(expression);
  const selectedPlatform =
    platforms.find((platform) => platform.id === selectedPlatformId) ??
    platforms[0];
  const selectedStore =
    selectedPlatform?.stores.find((store) => store.id === selectedStoreId) ??
    selectedPlatform?.stores[0];
  const managedPlatform = platforms.find(
    (platform) => platform.id === managePlatformId,
  );
  const occurrencePlatform = platforms.find(
    (platform) => platform.id === occurrencePlatformId,
  );
  const onlineMembers = members.filter(
    (member) =>
      Date.now() - new Date(member.lastSeenAt).getTime() < 3 * 60 * 1000,
  );
  const historyDays = useMemo(() => {
    const byDate = new Map<string, HistoryEvent[]>();
    for (const item of historyEvents) {
      byDate.set(item.workDate, [...(byDate.get(item.workDate) ?? []), item]);
    }
    return [...byDate.entries()].sort(([left], [right]) =>
      right.localeCompare(left),
    );
  }, [historyEvents]);
  const adminChartData = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const key = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
      }).format(date);
      const events = historyEvents.filter((item) => item.workDate === key);
      return {
        day: formatter.format(date),
        entradas: events
          .filter((item) => item.delta > 0)
          .reduce((sum, item) => sum + item.delta, 0),
      };
    });
  }, [historyEvents]);

  const loadGroupData = useCallback(
    async (groupId: string) => {
      if (!supabase) return;
      setNetworkState('connecting');
      const day = todaySaoPaulo();
      const [
        platformResult,
        storeResult,
        eventResult,
        memberResult,
        profileResult,
        dailyCycleResult,
      ] = await Promise.all([
        supabase
          .from('taggi_platforms')
          .select('id,name,initials,accent,brand_color,logo_path,sort_order')
          .eq('group_id', groupId)
          .eq('status', 'active')
          .order('sort_order'),
        supabase
          .from('taggi_platform_stores')
          .select('id,platform_id,name,sort_order')
          .eq('group_id', groupId)
          .eq('status', 'active')
          .order('sort_order'),
        supabase
          .from('taggi_count_events')
          .select(
            'id,platform_id,store_id,delta,event_type,reason,created_by_name,created_at,work_date',
          )
          .eq('group_id', groupId)
          .gte('work_date', monthAgoSaoPaulo())
          .order('created_at', { ascending: false }),
        supabase
          .from('taggi_group_members')
          .select('id,user_id,display_name,role,last_seen_at')
          .eq('group_id', groupId)
          .eq('status', 'active')
          .order('display_name'),
        supabase.from('taggi_profiles').select('user_id,avatar_url'),
        supabase
          .from('taggi_daily_cycles')
          .select('id,close_mode,close_reason,closed_by_name,closed_at')
          .eq('group_id', groupId)
          .eq('work_date', day)
          .limit(1),
      ]);

      const firstError =
        platformResult.error ??
        storeResult.error ??
        eventResult.error ??
        memberResult.error ??
        profileResult.error ??
        dailyCycleResult.error;
      if (firstError) {
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        setNetworkState(offline ? 'error' : 'connecting');
        setToast(readableError(firstError));
        return;
      }

      const totals = new Map<string, number>();
      for (const event of (eventResult.data ?? []).filter(
        (item) => item.work_date === day,
      )) {
        totals.set(
          event.platform_id,
          (totals.get(event.platform_id) ?? 0) + event.delta,
        );
      }

      const storesByPlatform = new Map<string, PlatformStore[]>();
      for (const store of storeResult.data ?? []) {
        storesByPlatform.set(store.platform_id, [
          ...(storesByPlatform.get(store.platform_id) ?? []),
          { id: store.id, name: store.name },
        ]);
      }
      const logoUrls = new Map<string, string>();
      await Promise.all(
        (platformResult.data ?? []).map(async (platform) => {
          if (!platform.logo_path) return;
          logoUrls.set(
            platform.id,
            await createSignedImageUrl(
              PLATFORM_LOGO_BUCKET,
              platform.logo_path,
            ),
          );
        }),
      );
      const avatarPaths = new Map(
        (profileResult.data ?? []).map((profile) => [
          profile.user_id,
          profile.avatar_url as string | null,
        ]),
      );
      const avatarUrls = new Map<string, string>();
      await Promise.all(
        [...avatarPaths.entries()].map(async ([userId, path]) => {
          if (!path) return;
          avatarUrls.set(
            userId,
            await createSignedImageUrl(AVATAR_BUCKET, path),
          );
        }),
      );

      const nextPlatforms: Platform[] = (platformResult.data ?? []).map(
        (platform) => ({
          id: platform.id,
          name: platform.name,
          value: Math.max(0, totals.get(platform.id) ?? 0),
          accent: platform.accent,
          brandColor: platform.brand_color,
          initials: platform.initials,
          logoPath: platform.logo_path,
          logoUrl: logoUrls.get(platform.id) ?? '',
          stores: storesByPlatform.get(platform.id) ?? [],
          occurrences: (eventResult.data ?? []).filter(
            (event) =>
              event.work_date === day &&
              event.platform_id === platform.id &&
              event.event_type === 'occurrence',
          ).length,
        }),
      );
      const storeNames = new Map(
        (storeResult.data ?? []).map((store) => [store.id, store.name]),
      );
      setPlatforms(nextPlatforms);
      setHistoryEvents(
        (eventResult.data ?? []).map((event) => ({
          id: event.id,
          platformId: event.platform_id,
          storeId: event.store_id,
          storeName: storeNames.get(event.store_id) ?? 'Loja arquivada',
          delta: event.delta,
          eventType: event.event_type,
          reason: event.reason,
          user: event.created_by_name,
          createdAt: event.created_at,
          workDate: event.work_date,
        })),
      );
      setMembers(
        (memberResult.data ?? []).map((member) => ({
          id: member.id,
          userId: member.user_id,
          displayName: member.display_name,
          role: member.role as TaggiRole,
          lastSeenAt: member.last_seen_at,
          avatarUrl: avatarUrls.get(member.user_id) ?? '',
        })),
      );
      const ownAvatarPath = avatarPaths.get(session?.user.id ?? '') ?? '';
      setAvatarPath(ownAvatarPath ?? '');
      setAvatarUrl(avatarUrls.get(session?.user.id ?? '') ?? '');
      setDayClosed((dailyCycleResult.data?.length ?? 0) > 0);
      setNetworkState('connected');
    },
    [session?.user.id],
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const onOffline = () => setNetworkState('error');
    const onOnline = () => {
      setNetworkState('connecting');
      if (groupSession?.groupId) void loadGroupData(groupSession.groupId);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [groupSession?.groupId, loadGroupData]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(UI_PREFERENCES_KEY);
      if (saved) {
        const preferences = JSON.parse(saved);
        if (['light', 'dark', 'auto'].includes(preferences.theme)) {
          setTheme(preferences.theme);
        }
        if (typeof preferences.accent === 'string')
          setAccent(preferences.accent);
        if (typeof preferences.platformNumberColor === 'string') {
          setPlatformNumberColor(preferences.platformNumberColor);
        }
        if (typeof preferences.totalColor === 'string') {
          setTotalColor(preferences.totalColor);
        }
      }
    } catch {
      // Invalid local preferences are ignored and replaced on the next save.
    } finally {
      setPreferencesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    localStorage.setItem(
      UI_PREFERENCES_KEY,
      JSON.stringify({ theme, accent, platformNumberColor, totalColor }),
    );
  }, [accent, platformNumberColor, preferencesLoaded, theme, totalColor]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    if (!appInfo || !session?.user.id || !window.taggiDesktop) return;
    let alive = true;
    const syncPolicy = async () => {
      const policy = await loadReleasePolicy(appInfo);
      if (alive) await window.taggiDesktop?.configureReleasePolicy(policy);
    };
    void syncPolicy();
    const timer = window.setInterval(syncPolicy, 6 * 60 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [appInfo, session?.user.id]);

  useEffect(() => {
    if (!appInfo || booting || !window.taggiDesktop) return;
    let settingsReadable = false;
    try {
      localStorage.getItem(UI_PREFERENCES_KEY);
      settingsReadable = true;
    } catch {
      settingsReadable = false;
    }
    void window.taggiDesktop.reportHealthy({
      rendererReady: true,
      settingsReadable,
      backendConfigured: Boolean(supabase),
      backendReachable: networkState === 'connected',
    });
  }, [appInfo, booting, networkState]);

  useEffect(() => {
    const groupId = groupSession?.groupId;
    if (!groupId || !supabase) return;
    const client = supabase;
    let reloadTimer: number | undefined;
    let rolloverTimer: number | undefined;
    let observedWorkDate = todaySaoPaulo();
    const reloadNow = () => {
      void loadGroupData(groupId);
      void refreshMemberships();
    };
    const reload = () => {
      if (reloadTimer) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(reloadNow, 120);
    };
    const filter = 'group_id=eq.' + groupId;
    const channel = client
      .channel('taggi-sync-' + groupId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'taggi_platforms', filter },
        reload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'taggi_platform_stores',
          filter,
        },
        reload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'taggi_count_events', filter },
        reload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'taggi_daily_cycles', filter },
        reload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'taggi_group_members', filter },
        reload,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'taggi_profiles' },
        reload,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setNetworkState('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          setNetworkState(navigator.onLine ? 'connecting' : 'error');
        else setNetworkState('connecting');
      });

    const heartbeat = async () => {
      await client.rpc('taggi_touch_presence', { p_group_id: groupId });
      const currentWorkDate = todaySaoPaulo();
      if (currentWorkDate !== observedWorkDate) {
        observedWorkDate = currentWorkDate;
        reloadNow();
      }
    };
    const scheduleRollover = () => {
      rolloverTimer = window.setTimeout(() => {
        observedWorkDate = todaySaoPaulo();
        reloadNow();
        scheduleRollover();
      }, millisecondsUntilNextSaoPauloMidnight());
    };
    void heartbeat();
    const heartbeatTimer = window.setInterval(heartbeat, 60_000);
    scheduleRollover();
    reloadNow();

    return () => {
      window.clearInterval(heartbeatTimer);
      if (reloadTimer) window.clearTimeout(reloadTimer);
      if (rolloverTimer) window.clearTimeout(rolloverTimer);
      void client.removeChannel(channel);
    };
  }, [groupSession?.groupId, loadGroupData, refreshMemberships]);

  useEffect(() => {
    setAdminSession(null);
    setAdminPassword('');
    setAdminError('');
    setAdminSection('dashboard');
    setView('home');
  }, [groupSession?.groupId]);

  useEffect(() => {
    if (!adminSession) return;
    const remaining = new Date(adminSession.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setAdminSession(null);
      return;
    }
    const timer = window.setTimeout(() => setAdminSession(null), remaining);
    return () => window.clearTimeout(timer);
  }, [adminSession]);

  useEffect(() => {
    if (
      platforms.length > 0 &&
      !platforms.some((platform) => platform.id === selectedPlatformId)
    ) {
      setSelectedPlatformId(platforms[0].id);
    }
  }, [platforms, selectedPlatformId]);

  useEffect(() => {
    if (!selectedPlatform?.stores.length) {
      setSelectedStoreId('');
      return;
    }
    if (
      !selectedPlatform.stores.some((store) => store.id === selectedStoreId)
    ) {
      setSelectedStoreId(selectedPlatform.stores[0].id);
    }
  }, [selectedPlatform, selectedStoreId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function handleAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !supabase || !session?.user) return;
    event.target.value = '';
    setProfileOpen(false);
    setToast('Salvando foto...');
    let newPath = '';
    try {
      newPath = await uploadPrivateImage({
        bucket: AVATAR_BUCKET,
        folder: session.user.id,
        file,
        kind: 'avatar',
        maxDimension: 640,
      });
      const response = await supabase
        .from('taggi_profiles')
        .update({ avatar_url: newPath })
        .eq('user_id', session.user.id);
      if (response.error) throw response.error;
      const nextUrl = await createSignedImageUrl(AVATAR_BUCKET, newPath);
      const previousPath = avatarPath;
      setAvatarPath(newPath);
      setAvatarUrl(nextUrl);
      await removePrivateImage(AVATAR_BUCKET, previousPath);
      setToast('Foto do perfil atualizada e salva');
    } catch (caught) {
      if (newPath) await removePrivateImage(AVATAR_BUCKET, newPath);
      setToast(readableError(caught, 'Não foi possível salvar a foto.'));
    }
  }

  async function confirmLaunch(event?: FormEvent) {
    event?.preventDefault();
    if (dayClosed) {
      setToast('As contagens de hoje já foram finalizadas pela Administração.');
      return;
    }
    if (
      !supabase ||
      !groupSession ||
      !selectedPlatform ||
      !selectedStore ||
      launchResult === null ||
      launchResult <= 0
    ) {
      setToast('Digite uma quantidade válida');
      return;
    }
    const response = await supabase.rpc('taggi_record_launch', {
      p_group_id: groupSession.groupId,
      p_platform_id: selectedPlatform.id,
      p_store_id: selectedStore.id,
      p_quantity: launchResult,
    });
    if (response.error) {
      setToast(response.error.message);
      return;
    }
    setExpression('');
    await loadGroupData(groupSession.groupId);
    setToast(String(launchResult) + ' etiquetas adicionadas');
  }

  async function closeOperationalDay() {
    if (!supabase || !groupSession || !adminSession) return;
    const response = await supabase.rpc('taggi_admin_close_operational_day', {
      p_group_id: groupSession.groupId,
      p_reason: resetReason.trim(),
      p_session_id: adminSession.id,
      p_session_token: adminSession.token,
    });
    if (response.error) {
      setToast(readableError(response.error));
      return;
    }
    setResetOpen(false);
    await loadGroupData(groupSession.groupId);
    setToast('Contagens confirmadas e dia finalizado.');
  }

  async function addPlatform(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !groupSession || !adminSession) return;
    const data = new FormData(event.currentTarget);
    const name = formText(data, 'name').trim();
    const store = formText(data, 'store').trim();
    const color = formText(data, 'color', '#1684ff');
    const logo = data.get('logo');
    if (!name || !store) {
      setToast('Informe a plataforma e a primeira loja');
      return;
    }
    setPlatformBusy(true);
    const platformResponse = await supabase.rpc('taggi_admin_create_platform', {
      p_group_id: groupSession.groupId,
      p_name: name,
      p_store_name: store,
      p_accent: color,
      p_session_id: adminSession.id,
      p_session_token: adminSession.token,
    });
    if (platformResponse.error) {
      setPlatformBusy(false);
      setToast(readableError(platformResponse.error));
      return;
    }
    const platformId = platformResponse.data as string;
    let logoPath: string | null = null;
    try {
      if (logo instanceof File && logo.size > 0) {
        logoPath = await uploadPrivateImage({
          bucket: PLATFORM_LOGO_BUCKET,
          folder: groupSession.groupId + '/' + platformId,
          file: logo,
          kind: 'logo',
          maxDimension: 640,
        });
        const updateResponse = await supabase.rpc(
          'taggi_admin_update_platform',
          {
            p_group_id: groupSession.groupId,
            p_platform_id: platformId,
            p_name: name,
            p_accent: color,
            p_logo_path: logoPath,
            p_session_id: adminSession.id,
            p_session_token: adminSession.token,
          },
        );
        if (updateResponse.error) throw updateResponse.error;
      }
    } catch (caught) {
      if (logoPath) await removePrivateImage(PLATFORM_LOGO_BUCKET, logoPath);
      setToast(
        readableError(
          caught,
          'A plataforma foi criada, mas a logo não pôde ser salva.',
        ),
      );
    } finally {
      setPlatformBusy(false);
    }
    setAddPlatformOpen(false);
    event.currentTarget.reset();
    await loadGroupData(groupSession.groupId);
    setToast(
      logoPath
        ? 'Plataforma, loja e logo adicionadas'
        : 'Plataforma e loja adicionadas',
    );
  }

  function openPlatformManager(platform: Platform) {
    setManagePlatformId(platform.id);
    setPlatformEditName(platform.name);
    setPlatformEditColor(platform.accent);
    setPlatformLogoFile(null);
    setNewStoreName('');
  }

  async function savePlatformSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !groupSession || !adminSession || !managedPlatform) return;
    setPlatformBusy(true);
    let nextLogoPath = managedPlatform.logoPath;
    let uploadedPath = '';
    try {
      if (platformLogoFile) {
        uploadedPath = await uploadPrivateImage({
          bucket: PLATFORM_LOGO_BUCKET,
          folder: groupSession.groupId + '/' + managedPlatform.id,
          file: platformLogoFile,
          kind: 'logo',
          maxDimension: 640,
        });
        nextLogoPath = uploadedPath;
      }
      const response = await supabase.rpc('taggi_admin_update_platform', {
        p_group_id: groupSession.groupId,
        p_platform_id: managedPlatform.id,
        p_name: platformEditName.trim(),
        p_accent: platformEditColor,
        p_logo_path: nextLogoPath,
        p_session_id: adminSession.id,
        p_session_token: adminSession.token,
      });
      if (response.error) throw response.error;
      if (uploadedPath) {
        await removePrivateImage(
          PLATFORM_LOGO_BUCKET,
          managedPlatform.logoPath,
        );
      }
      setPlatformLogoFile(null);
      await loadGroupData(groupSession.groupId);
      setToast('Configurações da plataforma salvas');
    } catch (caught) {
      if (uploadedPath)
        await removePrivateImage(PLATFORM_LOGO_BUCKET, uploadedPath);
      setToast(readableError(caught));
    } finally {
      setPlatformBusy(false);
    }
  }

  async function addStoreToManaged(event: FormEvent) {
    event.preventDefault();
    if (
      !supabase ||
      !groupSession ||
      !adminSession ||
      !managedPlatform ||
      !newStoreName.trim()
    )
      return;
    setPlatformBusy(true);
    const response = await supabase.rpc('taggi_admin_add_store', {
      p_group_id: groupSession.groupId,
      p_platform_id: managedPlatform.id,
      p_name: newStoreName.trim(),
      p_session_id: adminSession.id,
      p_session_token: adminSession.token,
    });
    setPlatformBusy(false);
    if (response.error) {
      setToast(readableError(response.error));
      return;
    }
    setNewStoreName('');
    await loadGroupData(groupSession.groupId);
    setToast('Loja adicionada à plataforma');
  }

  async function archiveStore(store: PlatformStore) {
    if (!supabase || !groupSession || !adminSession || !managedPlatform) return;
    const response = await supabase.rpc('taggi_admin_archive_store', {
      p_group_id: groupSession.groupId,
      p_store_id: store.id,
      p_session_id: adminSession.id,
      p_session_token: adminSession.token,
    });
    if (response.error) {
      setToast(readableError(response.error));
      return;
    }
    await loadGroupData(groupSession.groupId);
    setToast('Loja removida');
  }

  async function registerOccurrence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dayClosed) {
      setToast('As contagens de hoje já foram finalizadas pela Administração.');
      return;
    }
    if (!supabase || !groupSession) return;
    const platform = platforms.find((item) => item.id === occurrencePlatformId);
    if (!platform) return;
    const data = new FormData(event.currentTarget);
    const storeId = formText(data, 'storeId');
    const store =
      platform.stores.find((item) => item.id === storeId) ?? platform.stores[0];
    if (!store) {
      setToast('Cadastre uma loja para esta plataforma');
      return;
    }
    const requested = Math.max(1, Number(data.get('quantity') ?? 1));
    const reason = formText(data, 'reason', 'Ajuste');
    const applied = Math.min(requested, platform.value);
    if (applied <= 0) {
      setToast('Não há etiquetas válidas para ajustar');
      return;
    }
    const response = await supabase.rpc('taggi_record_occurrence', {
      p_group_id: groupSession.groupId,
      p_platform_id: platform.id,
      p_store_id: store.id,
      p_quantity: applied,
      p_reason: reason,
    });
    if (response.error) {
      setToast(response.error.message);
      return;
    }
    setOccurrencePlatformId(null);
    await loadGroupData(groupSession.groupId);
    setToast('Ocorrência registrada e contagem ajustada');
  }

  async function unlockAdmin(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !groupSession || !adminPassword) {
      setAdminError('Digite a senha da Administração.');
      return;
    }
    const response = await supabase.rpc('taggi_unlock_admin', {
      p_group_id: groupSession.groupId,
      p_password: adminPassword,
    });
    const row = response.data?.[0];
    if (response.error || !row) {
      setAdminError(
        readableError(response.error, 'Senha da Administração incorreta.'),
      );
      return;
    }
    setAdminSession({
      id: row.session_id,
      token: row.session_token,
      expiresAt: row.expires_at,
    });
    setAdminPassword('');
    setAdminError('');
    setToast('Administração desbloqueada temporariamente');
  }

  async function lockAdmin() {
    if (supabase && groupSession && adminSession) {
      await supabase.rpc('taggi_lock_admin', {
        p_group_id: groupSession.groupId,
        p_session_id: adminSession.id,
        p_session_token: adminSession.token,
      });
    }
    setAdminSession(null);
    setToast('Administração bloqueada');
  }

  function openHistoryCorrection(item: HistoryEvent) {
    setCorrectionEvent(item);
    setCorrectionValue(String(item.delta));
    setCorrectionReason(
      'Correção do registro de ' + formatRemoteTime(item.createdAt),
    );
  }

  async function submitHistoryCorrection(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !groupSession || !adminSession || !correctionEvent) return;
    const nextValue = Number(correctionValue);
    if (!Number.isInteger(nextValue) || correctionReason.trim().length < 3) {
      setToast('Informe o novo valor e o motivo da correção');
      return;
    }
    const response = await supabase.rpc('taggi_admin_correct_history_event', {
      p_group_id: groupSession.groupId,
      p_event_id: correctionEvent.id,
      p_new_delta: nextValue,
      p_reason: correctionReason.trim(),
      p_session_id: adminSession.id,
      p_session_token: adminSession.token,
    });
    if (response.error) {
      setToast(readableError(response.error));
      return;
    }
    setCorrectionEvent(null);
    await loadGroupData(groupSession.groupId);
    setToast('Correção registrada sem apagar o histórico original');
  }

  async function changeAdminPassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !groupSession) return;
    if (newAdminPassword.length < 8) {
      setToast('A nova senha precisa ter pelo menos 8 caracteres');
      return;
    }
    const response = await supabase.rpc('taggi_change_admin_password', {
      p_group_id: groupSession.groupId,
      p_current_password: currentAdminPassword,
      p_new_password: newAdminPassword,
    });
    if (response.error) {
      setToast(readableError(response.error));
      return;
    }
    setCurrentAdminPassword('');
    setNewAdminPassword('');
    setAdminSession(null);
    setToast('Senha alterada; a Administração foi bloqueada novamente');
  }

  async function updateMemberRole(
    member: Member,
    nextRole: TaggiRole,
    confirmLastAuthority = false,
  ) {
    if (!supabase || !groupSession || !adminSession) return;
    if (
      !confirmLastAuthority &&
      member.userId === session?.user.id &&
      member.role !== 'employee' &&
      nextRole === 'employee'
    ) {
      setAppConfirm({
        title: 'Confirmar alteração do próprio cargo',
        description:
          'Se você for a última autoridade, a empresa poderá ficar sem gestão. O servidor fará a verificação antes de concluir.',
        run: async () => updateMemberRole(member, nextRole, true),
      });
      return;
    }
    const response = await supabase.rpc('taggi_update_member_role_via_admin', {
      p_group_id: groupSession.groupId,
      p_target_user_id: member.userId,
      p_new_role: nextRole,
      p_session_id: adminSession.id,
      p_session_token: adminSession.token,
    });
    if (
      response.error?.message.includes('last_authority_confirmation_required')
    ) {
      setAppConfirm({
        title: 'Última autoridade ativa',
        description:
          'Esta pessoa é a última autoridade da empresa. Confirme apenas se deseja continuar mesmo assim.',
        run: async () => updateMemberRole(member, nextRole, true),
      });
      return;
    } else if (response.error) {
      setToast(readableError(response.error));
      return;
    }
    await refreshMemberships(groupSession.groupId);
    await loadGroupData(groupSession.groupId);
    setToast('Cargo atualizado');
  }

  async function removeMember(member: Member) {
    if (!supabase || !groupSession) return;
    const response = await supabase.rpc('taggi_remove_member', {
      p_group_id: groupSession.groupId,
      p_target_user_id: member.userId,
    });
    if (response.error) {
      setToast(readableError(response.error));
      return;
    }
    await loadGroupData(groupSession.groupId);
    setToast('Membro removido');
  }

  async function finishTutorial(skipped: boolean) {
    if (!supabase || !groupSession) return;
    setOnboardingBusy(true);
    const response = await supabase.rpc('taggi_complete_tutorial', {
      p_group_id: groupSession.groupId,
      p_skipped: skipped,
    });
    if (response.error) setToast(readableError(response.error));
    else await refreshMemberships(groupSession.groupId);
    setOnboardingBusy(false);
  }

  async function saveInitialAdminPassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !groupSession) return;
    setSetupError('');
    if (setupPassword.length < 8) {
      setSetupError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (setupPassword !== setupPasswordConfirm) {
      setSetupError('As duas senhas precisam ser iguais.');
      return;
    }
    setOnboardingBusy(true);
    const response = await supabase.rpc('taggi_set_initial_admin_password', {
      p_group_id: groupSession.groupId,
      p_password: setupPassword,
    });
    if (response.error) setSetupError(readableError(response.error));
    else {
      setSetupPassword('');
      setSetupPasswordConfirm('');
      await refreshMemberships(groupSession.groupId);
      setToast('Senha da Administração criada');
    }
    setOnboardingBusy(false);
  }

  async function leaveGroup() {
    setAdminSession(null);
    await signOut();
    setPlatforms([]);
    setHistoryEvents([]);
    setMembers([]);
    setAvatarPath('');
    setAvatarUrl('');
    setProfileOpen(false);
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !groupSession) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const category = formText(data, 'category', 'sugestao');
    const body = formText(data, 'body').trim();
    if (body.length < 5) {
      setToast('Conte um pouco mais sobre o feedback');
      return;
    }
    setFeedbackSent(true);
    const response = await supabase.from('taggi_feedback').insert({
      group_id: groupSession.groupId,
      category,
      body,
      app_version: appInfo?.version ?? '1.0.1',
    });
    setFeedbackSent(false);
    if (response.error) {
      setToast(readableError(response.error));
      return;
    }
    form.reset();
    setFeedbackOpen(false);
    setToast('Obrigado! Seu feedback nos ajuda a melhorar o Tage.');
  }

  const appStyle = {
    '--app-accent': accent,
    '--platform-number': resolvedPlatformColor,
    '--total-color': totalColor,
  } as CSSProperties;
  const currentRoleLabel = groupSession
    ? roleLabels[groupSession.role]
    : 'Funcionário';
  const adminUnlocked = Boolean(
    adminSession && new Date(adminSession.expiresAt).getTime() > Date.now(),
  );

  if (booting) {
    return (
      <main
        className="taggi-shell grid min-h-screen place-items-center"
        style={appStyle}
      >
        <div className="text-center">
          <img
            src="./taggi-app-icon.png"
            alt=""
            className="mx-auto size-20 rounded-[22px]"
          />
          <LoaderCircle className="mx-auto mt-6 size-5 animate-spin text-[var(--app-accent)]" />
          <p className="mt-3 text-sm text-[var(--text-soft)]">
            Abrindo seu espaço de trabalho...
          </p>
        </div>
      </main>
    );
  }

  if (!groupSession) {
    return (
      <main
        className="taggi-shell grid min-h-screen place-items-center px-6 py-10"
        style={appStyle}
      >
        <section className="surface-panel w-full max-w-[520px] p-10 max-sm:p-6">
          <div className="mb-9 flex items-center justify-center gap-3 text-white">
            <img
              src="./taggi-app-icon.png"
              alt=""
              className="size-12 rounded-2xl"
            />
            <span className="text-[36px] font-semibold tracking-[-0.06em]">
              tage
            </span>
          </div>
          <AccessPanel />
        </section>
      </main>
    );
  }

  return (
    <main
      className="taggi-shell"
      style={appStyle}
      data-update-busy={Boolean(expression.trim() || currentAdminPassword || newAdminPassword || platformBusy || onboardingBusy)}
    >
      <aside className="taggi-sidebar">
        <BrandMark isDark={isDark} />
        <div className="sm:hidden">
          <BrandMark isDark={isDark} compact />
        </div>
        {isBeta ? (
          <span className="taggi-beta-badge mx-2 mb-4 inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.14em] max-lg:hidden">
            Versão Beta
          </span>
        ) : null}
        <nav aria-label="Navegação principal" className="taggi-nav space-y-1.5">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="nav-item"
              data-active={view === id}
              onClick={() => {
                setView(id);
                setProfileOpen(false);
              }}
              aria-current={view === id ? 'page' : undefined}
              aria-label={label}
            >
              <Icon className="size-5 shrink-0" strokeWidth={1.7} />
              <span className="text-[15px]">{label}</span>
              {id === 'admin' && inventoryUnread > 0 ? (
                <span
                  className="nav-badge"
                  aria-label={
                    inventoryUnread +
                    (inventoryUnread === 1
                      ? ' notificação não lida'
                      : ' notificações não lidas')
                  }
                >
                  {inventoryUnread > 99 ? '99+' : inventoryUnread}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="taggi-sidebar-footer mt-auto px-2 max-sm:hidden">
          <div className="relative">
            <button
              className="taggi-sidebar-profile flex w-full items-center gap-3 rounded-xl p-2 text-left"
              onClick={() => setProfileOpen((open) => !open)}
              aria-expanded={profileOpen}
            >
              <Avatar className="size-10 shrink-0">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
                <AvatarFallback className="bg-[var(--surface-hover)] text-[var(--text-main)]">
                  {groupSession.displayName
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 max-lg:hidden">
                <strong className="block truncate text-sm font-medium">
                  {groupSession.displayName}
                </strong>
                <small className="mt-0.5 block text-xs text-[var(--text-soft)]">
                  {currentRoleLabel}
                </small>
              </span>
              <ChevronDown className="size-4 shrink-0 text-[var(--text-soft)] max-lg:hidden" />
            </button>
            {profileOpen ? (
              <div className="surface-panel taggi-sidebar-profile-menu absolute bottom-0 left-[calc(100%+14px)] z-50 w-64 p-2">
                <div className="flex w-full items-center justify-between rounded-xl bg-[var(--surface-soft)] px-3 py-3 text-left">
                  <span>
                    <span className="block text-xs text-[var(--text-soft)]">Equipe conectada</span>
                    <span className="mt-1 block text-sm font-semibold">{groupSession.groupName}</span>
                  </span>
                  <Wifi className="size-4 text-emerald-400" />
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 rounded-xl px-3 py-3">
                  <span className="min-w-0 select-text">
                    <span className="block text-xs text-[var(--text-soft)]">Código da equipe</span>
                    <span className="mt-1 block truncate font-mono text-sm font-semibold tracking-[.08em]">{groupSession.groupCode}</span>
                  </span>
                  <button
                    type="button"
                    className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--line)] text-[var(--text-soft)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
                    aria-label="Copiar código da equipe"
                    onClick={() => {
                      void copyText(groupSession.groupCode).then((copied) =>
                        setToast(
                          copied
                            ? 'Código da equipe copiado'
                            : 'Selecione o código exibido e copie manualmente.',
                        ),
                      );
                    }}
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm text-[var(--text-soft)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]">
                  <Users className="size-4" />
                  Alterar foto do perfil
                  <input className="sr-only" type="file" accept="image/*" onChange={handleAvatar} />
                </label>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-[var(--text-soft)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
                  onClick={() => {
                    setProfileOpen(false);
                    setTeamAccessOpen(true);
                  }}
                >
                  <Users className="size-4" />
                  Equipes e novo grupo
                </button>
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-[var(--text-soft)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
                  onClick={() => {
                    setView('settings');
                    setProfileOpen(false);
                  }}
                >
                  <Settings className="size-4" />
                  Configurações
                </button>
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-red-400 transition hover:bg-red-500/10"
                  onClick={() => void leaveGroup()}
                >
                  <LogOut className="size-4" />
                  Desconectar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="taggi-main">
        {minimumRequired ? (
          <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-amber-400/35 bg-amber-400/10 px-5 py-4 text-sm text-[var(--text-main)]">
            <div>
              <p className="font-semibold">Atualização necessária</p>
              <p className="mt-1 text-[var(--text-soft)]">
                Esta versão não é mais suportada. Atualize para continuar com
                segurança.
              </p>
            </div>
            {['ready', 'installing'].includes(updateState.phase) ? (
              <p className="text-sm text-[var(--text-soft)]">{updateState.message}</p>
            ) : (
              <Button
                className="taggi-button-subtle shrink-0"
                variant="outline"
                onClick={() => void checkForUpdates()}
              >
                Verificar agora
              </Button>
            )}
          </div>
        ) : null}
        {view === 'home' ? (
          <header className="taggi-topbar relative mb-9 flex items-center justify-between gap-8">
            <label className="taggi-search">
              <Search
                className="size-6 shrink-0 text-[var(--text-soft)]"
                strokeWidth={1.7}
              />
              <input
                aria-label="Buscar loja ou plataforma"
                placeholder="Buscar loja ou plataforma..."
                className="w-full bg-transparent text-[16px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-soft)]"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </header>
        ) : null}

        {dayClosed ? (
          <div className="day-closed-banner" role="status">
            <Check className="size-4" />
            <span>
              <strong>Dia finalizado.</strong> As contagens de hoje estão
              confirmadas no Histórico. Um novo dia começará zerado à meia-noite
              de São Paulo.
            </span>
          </div>
        ) : null}

        <div key={view} className="fade-page">
          {view === 'home' ? (
            <>
              <SectionHeading
                title="Início"
                subtitle="Acompanhe suas contagens por plataforma em tempo real."
              />
              <HomeDashboard
                platforms={platforms}
                filteredPlatforms={filteredPlatforms}
                total={total}
                selectedPlatformId={selectedPlatform?.id ?? ''}
                selectedStoreId={selectedStore?.id ?? ''}
                expression={expression}
                launchResult={launchResult}
                onPlatformChange={setSelectedPlatformId}
                onStoreChange={setSelectedStoreId}
                onExpressionChange={setExpression}
                onOccurrence={setOccurrencePlatformId}
                onLaunch={confirmLaunch}
              />
            </>
          ) : null}

          {view === 'launch' ? (
            <>
              <SectionHeading
                title="Lançamento"
                subtitle="Adicione contagens em poucos segundos."
              />
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)] gap-5 max-xl:grid-cols-1">
                <form className="surface-panel p-7" onSubmit={confirmLaunch}>
                  <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                    <label className="text-sm text-[var(--text-soft)]">
                      Plataforma
                      <NativeSelect
                        className="mt-2 w-full"
                        value={selectedPlatformId}
                        onChange={(event) =>
                          setSelectedPlatformId(event.target.value)
                        }
                      >
                        {platforms.map((platform) => (
                          <NativeSelectOption
                            key={platform.id}
                            value={platform.id}
                          >
                            {platform.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="text-sm text-[var(--text-soft)]">
                      Loja
                      <NativeSelect
                        className="mt-2 w-full"
                        value={selectedStoreId}
                        onChange={(event) =>
                          setSelectedStoreId(event.target.value)
                        }
                      >
                        {(selectedPlatform?.stores ?? []).map((store) => (
                          <NativeSelectOption key={store.id} value={store.id}>
                            {store.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                  </div>
                  <div className="mt-7 rounded-[18px] border border-[var(--line)] bg-[var(--surface-soft)] p-5">
                    <div className="flex items-center gap-2 text-sm text-[var(--text-soft)]">
                      <Calculator className="size-4" />
                      Quantidade
                    </div>
                    <Input
                      inputMode="numeric"
                      className="mt-3 h-16 border-0 bg-transparent px-0 text-[34px] font-semibold tracking-[-0.03em] shadow-none focus-visible:ring-0"
                      value={expression}
                      onChange={(event) => setExpression(event.target.value)}
                      placeholder="Digite a quantidade para registrar"
                      aria-label="Quantidade para registrar"
                    />
                    <div className="mt-3 flex items-end justify-between gap-4 border-t border-[var(--line)] pt-4">
                      <span className="text-sm text-[var(--text-soft)]">
                        Resultado
                      </span>
                      <strong className="text-[36px] font-semibold tracking-[-0.04em] text-[var(--app-accent)]">
                        {launchResult === null
                          ? '0'
                          : formatNumber(launchResult)}
                      </strong>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[10, 25, 50, 100].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--text-soft)] transition hover:bg-[var(--surface-hover)]"
                        onClick={() =>
                          setExpression((current) =>
                            current ? current + '+' + amount : String(amount),
                          )
                        }
                      >
                        +{amount}
                      </button>
                    ))}
                  </div>
                  <div className="mt-7 flex flex-wrap gap-3">
                    <Button
                      type="submit"
                      className="taggi-button-primary h-11 rounded-xl px-5"
                      disabled={dayClosed}
                    >
                      <Check className="size-4" />
                      Confirmar lançamento
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 rounded-xl px-4 text-[var(--text-soft)]"
                      onClick={() => setExpression('')}
                    >
                      Editar
                    </Button>
                  </div>
                </form>
                <aside className="space-y-5">
                  <section className="surface-panel p-6">
                    <h2 className="font-semibold">Contagem selecionada</h2>
                    <div className="mt-5 flex items-center gap-4">
                      <PlatformMark
                        platform={selectedPlatform}
                        className="grid size-12 place-items-center rounded-2xl font-bold"
                      />
                      <div>
                        <p className="font-medium">{selectedPlatform?.name}</p>
                        <p className="mt-1 text-sm text-[var(--text-soft)]">
                          {selectedStore?.name ?? 'Selecione uma loja'}
                        </p>
                      </div>
                    </div>
                    <strong className="mt-7 block text-[46px] font-semibold tracking-[-0.045em]">
                      {formatNumber(selectedPlatform?.value ?? 0)}
                    </strong>
                    <span className="text-sm text-[var(--text-soft)]">
                      etiquetas válidas hoje
                    </span>
                  </section>
                </aside>
              </div>
            </>
          ) : null}

          {view === 'history' ? (
            <>
              <SectionHeading
                title="Histórico"
                subtitle="Lançamentos, ajustes e responsáveis dos últimos 30 dias."
              />
              <div className="space-y-4">
                {historyDays.map(([date, dayEvents], dayIndex) => {
                  const dayTotal = dayEvents.reduce(
                    (sum, item) => sum + item.delta,
                    0,
                  );
                  const platformGroups = [
                    ...dayEvents
                      .reduce((groups, item) => {
                        const items = groups.get(item.platformId) ?? [];
                        items.push(item);
                        groups.set(item.platformId, items);
                        return groups;
                      }, new Map<string, HistoryEvent[]>())
                      .entries(),
                  ];
                  return (
                    <details
                      key={date}
                      className="surface-panel group p-0"
                      open={dayIndex === 0}
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5">
                        <div>
                          <h2 className="font-semibold">
                            {new Intl.DateTimeFormat('pt-BR', {
                              timeZone: 'UTC',
                            }).format(new Date(`${date}T12:00:00Z`))}
                          </h2>
                          <p className="mt-1 text-sm text-[var(--text-soft)]">
                            {formatNumber(Math.max(0, dayTotal))} etiquetas
                            válidas · {dayEvents.length} movimentações
                          </p>
                        </div>
                        <ChevronDown className="size-5 text-[var(--text-soft)] transition group-open:rotate-180" />
                      </summary>
                      <div className="history-platform-grid border-t border-[var(--line)] p-5">
                        {platformGroups.map(([platformId, platformEvents]) => {
                          const platform = platforms.find(
                            (entry) => entry.id === platformId,
                          );
                          const platformTotal = platformEvents.reduce(
                            (sum, item) => sum + item.delta,
                            0,
                          );
                          const storeGroups = [
                            ...platformEvents
                              .reduce((groups, item) => {
                                const items = groups.get(item.storeName) ?? [];
                                items.push(item);
                                groups.set(item.storeName, items);
                                return groups;
                              }, new Map<string, HistoryEvent[]>())
                              .entries(),
                          ];
                          return (
                            <section
                              key={platformId}
                              className="history-platform-card"
                            >
                              <header className="history-platform-head">
                                <span
                                  className="size-2.5 rounded-full"
                                  style={{
                                    background: platform?.accent ?? '#1684ff',
                                  }}
                                />
                                <div className="min-w-0 flex-1">
                                  <h3 className="truncate font-semibold">
                                    {platform?.name ?? 'Plataforma arquivada'}
                                  </h3>
                                  <p>
                                    {storeGroups.length}{' '}
                                    {storeGroups.length === 1
                                      ? 'loja'
                                      : 'lojas'}{' '}
                                    neste dia
                                  </p>
                                </div>
                                <strong
                                  className={
                                    platformTotal < 0
                                      ? 'text-red-400'
                                      : 'text-emerald-400'
                                  }
                                >
                                  {platformTotal > 0 ? '+' : ''}
                                  {formatNumber(platformTotal)}
                                </strong>
                              </header>
                              <div className="history-store-list">
                                {storeGroups.map(([storeName, storeEvents]) => (
                                  <div
                                    key={storeName}
                                    className="history-store-group"
                                  >
                                    <div className="history-store-summary">
                                      <span>
                                        <Store className="size-4" />
                                        {storeName}
                                      </span>
                                      <strong>
                                        {storeEvents.reduce(
                                          (sum, item) => sum + item.delta,
                                          0,
                                        )}
                                      </strong>
                                    </div>
                                    {storeEvents.map((item) => {
                                      const label =
                                        item.eventType === 'launch'
                                          ? 'Lançamento'
                                          : item.eventType === 'occurrence'
                                            ? 'Ocorrência'
                                            : item.eventType ===
                                                  'admin_reset' ||
                                                item.eventType === 'reset'
                                              ? 'Zeragem administrativa'
                                              : item.eventType ===
                                                    'admin_correction' ||
                                                  item.eventType ===
                                                    'admin_adjustment'
                                                ? 'Correção administrativa'
                                                : 'Ajuste';
                                      const canCorrect =
                                        adminUnlocked &&
                                        ![
                                          'admin_reset',
                                          'reset',
                                          'admin_correction',
                                        ].includes(item.eventType);
                                      return (
                                        <div
                                          key={item.id}
                                          className="history-event-row"
                                        >
                                          <div>
                                            <p>{label}</p>
                                            <span>
                                              {item.reason ?? 'Sem observação'}
                                            </span>
                                          </div>
                                          <div className="history-event-person">
                                            <p>{item.user}</p>
                                            <span>
                                              {formatRemoteTime(item.createdAt)}
                                            </span>
                                          </div>
                                          <strong
                                            className={
                                              item.delta < 0
                                                ? 'text-red-400'
                                                : 'text-emerald-400'
                                            }
                                          >
                                            {item.delta > 0 ? '+' : ''}
                                            {formatNumber(item.delta)}
                                          </strong>
                                          {canCorrect ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openHistoryCorrection(item)
                                              }
                                            >
                                              Corrigir
                                            </button>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}
                {!historyDays.length ? (
                  <div className="surface-panel grid min-h-64 place-items-center p-8 text-center">
                    <div>
                      <History className="mx-auto size-7 text-[var(--text-muted)]" />
                      <p className="mt-4 font-medium">
                        Nenhuma movimentação ainda
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-soft)]">
                        Os lançamentos aparecerão aqui por um mês.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <ChatPanel
            groupId={groupSession.groupId}
            userId={session?.user.id ?? ''}
            members={members.map((member) => ({
              userId: member.userId,
              displayName: member.displayName,
              avatarUrl: member.avatarUrl,
              lastSeenAt: member.lastSeenAt,
            }))}
            groupName={groupSession.groupName}
            noticeSeen={groupSession.chatRetentionNoticeSeen}
            active={view === 'chat'}
            refreshMemberships={async () => {
              await refreshMemberships(groupSession.groupId);
              await loadGroupData(groupSession.groupId);
            }}
            onToast={setToast}
          />

          <InventoryPanel
            groupId={groupSession.groupId}
            active={view === 'inventory'}
            onToast={setToast}
            onUnreadChange={setInventoryUnread}
          />

          {view === 'admin' ? (
            <>
              <SectionHeading
                title="Administração"
                subtitle="Área protegida pela senha compartilhada da empresa."
                action={
                  adminUnlocked ? (
                    <Button
                      variant="outline"
                      className="taggi-button-subtle rounded-xl"
                      onClick={() => void lockAdmin()}
                    >
                      <LockKeyhole className="size-4" />
                      Bloquear agora
                    </Button>
                  ) : undefined
                }
              />
              {!adminUnlocked ? (
                <section className="surface-panel mx-auto grid min-h-[520px] max-w-2xl place-items-center p-8 text-center">
                  <form className="w-full max-w-sm" onSubmit={unlockAdmin}>
                    <span className="mx-auto grid size-16 place-items-center rounded-[20px] bg-[var(--surface-soft)] ring-1 ring-[var(--line)]">
                      <LockKeyhole className="size-7" strokeWidth={1.6} />
                    </span>
                    <h2 className="mt-6 text-xl font-semibold">
                      Autorização necessária
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
                      Digite a senha da Administração. Quem a possuir poderá
                      gerenciar os cargos da equipe nesta sessão.
                    </p>
                    <Input
                      type="password"
                      className="taggi-control mt-6 h-11 text-center"
                      placeholder="Senha da Administração"
                      value={adminPassword}
                      onChange={(event) => setAdminPassword(event.target.value)}
                    />
                    {adminError ? (
                      <p className="mt-2 text-sm text-red-400">{adminError}</p>
                    ) : null}
                    <Button
                      type="submit"
                      className="taggi-button-primary mt-4 h-11 w-full rounded-xl"
                    >
                      <ShieldCheck className="size-4" />
                      Autorizar acesso
                    </Button>
                    <p className="mt-5 text-xs text-[var(--text-muted)]">
                      A autorização expira automaticamente e não altera o seu
                      cargo.
                    </p>
                  </form>
                </section>
              ) : (
                <div className="space-y-5">
                  <nav
                    className="surface-panel flex flex-wrap gap-2 p-2"
                    aria-label="Seções da Administração"
                  >
                    {(
                      [
                        ['dashboard', 'Visão geral', LayoutDashboard],
                        ['platforms', 'Plataformas', Store],
                        ['team', 'Equipe', Users],
                        ['inventory', 'Insumos', PackageOpen],
                        ['security', 'Segurança', ShieldCheck],
                      ] as const
                    ).map(([id, label, Icon]) => (
                      <button
                        key={id}
                        type="button"
                        className={
                          adminSection === id
                            ? 'flex items-center gap-2 rounded-xl bg-[var(--app-accent)] px-4 py-2.5 text-sm font-medium text-white'
                            : 'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm text-[var(--text-soft)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]'
                        }
                        onClick={() => setAdminSection(id)}
                      >
                        <Icon className="size-4" />
                        {label}
                        {id === 'inventory' && inventoryUnread > 0 ? (
                          <span className="admin-tab-badge">
                            {inventoryUnread > 99 ? '99+' : inventoryUnread}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </nav>

                  {adminSection === 'dashboard' ? (
                    <>
                      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
                        <section className="surface-panel p-5">
                          <BarChart3 className="size-5 text-[var(--app-accent)]" />
                          <strong className="mt-6 block text-[34px] font-semibold">
                            {formatNumber(total)}
                          </strong>
                          <span className="text-sm text-[var(--text-soft)]">
                            Etiquetas hoje
                          </span>
                        </section>
                        <section className="surface-panel p-5">
                          <History className="size-5 text-[var(--app-accent)]" />
                          <strong className="mt-6 block text-[34px] font-semibold">
                            {
                              historyEvents.filter(
                                (item) => item.workDate === todaySaoPaulo(),
                              ).length
                            }
                          </strong>
                          <span className="text-sm text-[var(--text-soft)]">
                            Movimentações hoje
                          </span>
                        </section>
                        <section className="surface-panel p-5">
                          <Users className="size-5 text-[var(--app-accent)]" />
                          <strong className="mt-6 block text-[34px] font-semibold">
                            {members.length}
                          </strong>
                          <span className="text-sm text-[var(--text-soft)]">
                            Pessoas na empresa
                          </span>
                        </section>
                        <section className="surface-panel p-5">
                          <Wifi className="size-5 text-emerald-400" />
                          <strong className="mt-6 block text-[34px] font-semibold">
                            {onlineMembers.length}
                          </strong>
                          <span className="text-sm text-[var(--text-soft)]">
                            Online agora
                          </span>
                        </section>
                      </div>

                      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)] gap-5 max-xl:grid-cols-1">
                        <section className="surface-panel p-6">
                          <div>
                            <h2 className="font-semibold">
                              Entradas dos últimos 7 dias
                            </h2>
                            <p className="mt-1 text-sm text-[var(--text-soft)]">
                              Lançamentos registrados pela equipe.
                            </p>
                          </div>
                          <div className="mt-6 h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={adminChartData}>
                                <defs>
                                  <linearGradient id="adminEntriesFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--app-accent)" stopOpacity={0.42} />
                                    <stop offset="82%" stopColor="var(--app-accent)" stopOpacity={0.03} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid
                                  stroke="var(--line)"
                                  vertical={false}
                                  strokeDasharray="4 7"
                                />
                                <XAxis
                                  dataKey="day"
                                  tick={{
                                    fill: 'var(--text-muted)',
                                    fontSize: 11,
                                  }}
                                  axisLine={false}
                                  tickLine={false}
                                />
                                <YAxis
                                  tick={{
                                    fill: 'var(--text-muted)',
                                    fontSize: 11,
                                  }}
                                  axisLine={false}
                                  tickLine={false}
                                  width={42}
                                />
                                <Tooltip
                                  cursor={false}
                                  contentStyle={{
                                    background: 'var(--surface-strong)',
                                    border: '1px solid var(--line)',
                                    borderRadius: 12,
                                  }}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="entradas"
                                  name="Entradas"
                                  stroke="var(--app-accent)"
                                  strokeWidth={2.5}
                                  fill="url(#adminEntriesFill)"
                                  activeDot={{ r: 5, fill: 'var(--app-accent)', strokeWidth: 0 }}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </section>
                        <section className="surface-panel p-6">
                          <h2 className="font-semibold">
                            Distribuição de hoje
                          </h2>
                          <p className="mt-1 text-sm text-[var(--text-soft)]">
                            Participação por plataforma.
                          </p>
                          <div className="mt-6 space-y-5">
                            {platforms.map((platform) => {
                              const share =
                                total > 0
                                  ? Math.round((platform.value / total) * 100)
                                  : 0;
                              return (
                                <div key={platform.id}>
                                  <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="truncate">
                                      {platform.name}
                                    </span>
                                    <span className="text-[var(--text-soft)]">
                                      {share}%
                                    </span>
                                  </div>
                                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                                    <span
                                      className="block h-full rounded-full"
                                      style={{
                                        width: share + '%',
                                        background: platform.accent,
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      </div>

                      <section className="surface-panel flex items-center justify-between gap-5 p-6 max-sm:flex-col max-sm:items-stretch">
                        <div>
                          <h2 className="font-semibold">
                            Controles da contagem
                          </h2>
                          <p className="mt-1 text-sm text-[var(--text-soft)]">
                            As correções são feitas diretamente em Histórico. A
                            finalização confirma o dia, salva os totais no
                            Histórico e bloqueia alterações operacionais.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="taggi-button-subtle shrink-0"
                          onClick={() => setResetOpen(true)}
                          disabled={dayClosed}
                        >
                          <CheckCircle2 className="size-4" />
                          {dayClosed ? 'Dia finalizado' : 'Finalizar dia'}
                        </Button>
                      </section>

                      <section className="surface-panel p-6">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h2 className="font-semibold">Histórico recente</h2>
                            <p className="mt-1 text-sm text-[var(--text-soft)]">
                              Corrija o valor de um registro sem apagar o
                              original.
                            </p>
                          </div>
                          <button
                            className="text-sm text-[var(--app-accent)]"
                            onClick={() => setView('history')}
                          >
                            Ver tudo
                          </button>
                        </div>
                        <div className="mt-5 divide-y divide-[var(--line)]">
                          {historyEvents.slice(0, 6).map((item) => {
                            const platform = platforms.find(
                              (entry) => entry.id === item.platformId,
                            );
                            return (
                              <div
                                key={item.id}
                                className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 py-4 text-sm max-lg:grid-cols-1"
                              >
                                <span>
                                  <span className="block font-medium">
                                    {platform?.name ?? 'Plataforma arquivada'}
                                  </span>
                                  <span className="mt-1 block text-xs text-[var(--text-muted)]">
                                    {item.storeName}
                                  </span>
                                </span>
                                <span>
                                  <span className="block">{item.user}</span>
                                  <span className="mt-1 block text-xs text-[var(--text-muted)]">
                                    {formatRemoteTime(item.createdAt)}
                                  </span>
                                </span>
                                <strong
                                  className={
                                    item.delta < 0
                                      ? 'text-red-400'
                                      : 'text-emerald-400'
                                  }
                                >
                                  {item.delta > 0 ? '+' : ''}
                                  {formatNumber(item.delta)}
                                </strong>
                                <button
                                  className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--text-soft)] hover:bg-[var(--surface-hover)]"
                                  onClick={() => openHistoryCorrection(item)}
                                  disabled={[
                                    'admin_reset',
                                    'reset',
                                    'admin_correction',
                                  ].includes(item.eventType)}
                                >
                                  Corrigir
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </>
                  ) : null}

                  {adminSection === 'platforms' ? (
                    <section className="surface-panel p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h2 className="font-semibold">Plataformas e lojas</h2>
                          <p className="mt-1 text-sm text-[var(--text-soft)]">
                            Cadastre lojas, altere cores e mantenha as logos
                            oficiais.
                          </p>
                        </div>
                        <Button
                          className="taggi-button-primary rounded-xl"
                          onClick={() => setAddPlatformOpen(true)}
                        >
                          <Plus className="size-4" />
                          Nova plataforma
                        </Button>
                      </div>
                      <div className="mt-6 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
                        {platforms.map((platform) => (
                          <article
                            key={platform.id}
                            className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-5"
                          >
                            <div className="flex items-center gap-4">
                              <PlatformMark
                                platform={platform}
                                className="grid size-14 shrink-0 place-items-center rounded-2xl font-bold"
                              />
                              <div className="min-w-0 flex-1">
                                <h3 className="truncate font-medium">
                                  {platform.name}
                                </h3>
                                <p className="mt-1 text-sm text-[var(--text-soft)]">
                                  {platform.stores.length}{' '}
                                  {platform.stores.length === 1
                                    ? 'loja cadastrada'
                                    : 'lojas cadastradas'}
                                </p>
                              </div>
                              <button
                                className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs hover:bg-[var(--surface-hover)]"
                                onClick={() => openPlatformManager(platform)}
                              >
                                Configurar
                              </button>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              {platform.stores.map((store) => (
                                <span
                                  key={store.id}
                                  className="rounded-full bg-[var(--surface-hover)] px-3 py-1 text-xs text-[var(--text-soft)]"
                                >
                                  {store.name}
                                </span>
                              ))}
                            </div>
                          </article>
                        ))}
                        {!platforms.length ? (
                          <div className="col-span-2 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-8 text-center max-lg:col-span-1">
                            <Store className="mx-auto size-7 text-[var(--app-accent)]" />
                            <h3 className="mt-4 font-medium">
                              Nenhuma plataforma cadastrada
                            </h3>
                            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--text-soft)]">
                              Crie uma plataforma com sua primeira loja. Depois,
                              abra Configurar para incluir todas as outras lojas
                              vinculadas a ela.
                            </p>
                            <Button
                              className="taggi-button-primary mt-5 rounded-xl"
                              onClick={() => setAddPlatformOpen(true)}
                            >
                              <Plus className="size-4" />
                              Criar primeira plataforma
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {adminSection === 'team' ? (
                    <section className="surface-panel p-6">
                      <h2 className="font-semibold">Equipe ativa</h2>
                      <p className="mt-1 text-sm text-[var(--text-soft)]">
                        Gerencie cargos e acessos da empresa em um só lugar.
                      </p>
                      <div className="mt-5 divide-y divide-[var(--line)]">
                        {members.map((member) => (
                          <div
                            key={member.id}
                            className="grid grid-cols-[1fr_190px_100px_auto] items-center gap-3 py-4 text-sm max-lg:grid-cols-1"
                          >
                            <span className="flex items-center gap-3">
                              <Avatar className="size-10">
                                {member.avatarUrl ? (
                                  <AvatarImage src={member.avatarUrl} alt="" />
                                ) : null}
                                <AvatarFallback>
                                  {member.displayName
                                    .split(' ')
                                    .map((part) => part[0])
                                    .slice(0, 2)
                                    .join('')
                                    .toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span>
                                <span className="block font-medium">
                                  {member.displayName}
                                </span>
                                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                                  {Date.now() -
                                    new Date(member.lastSeenAt).getTime() <
                                  3 * 60 * 1000
                                    ? 'Online'
                                    : 'Ausente'}
                                </span>
                              </span>
                            </span>
                            <NativeSelect
                              value={member.role}
                              onChange={(event) =>
                                void updateMemberRole(
                                  member,
                                  event.target.value as TaggiRole,
                                )
                              }
                            >
                              <NativeSelectOption value="employee">
                                Funcionário
                              </NativeSelectOption>
                              <NativeSelectOption value="administrative">
                                Administrativo
                              </NativeSelectOption>
                              <NativeSelectOption value="manager">
                                Gestor
                              </NativeSelectOption>
                            </NativeSelect>
                            <span className="text-xs text-[var(--text-muted)]">
                              {member.userId === session?.user.id ? 'Você' : ''}
                            </span>
                            {member.userId !== session?.user.id &&
                            roleLevel[member.role] <=
                              roleLevel[groupSession.role] ? (
                              <button
                                className="text-xs text-red-400 hover:text-red-300"
                                onClick={() =>
                                  setAppConfirm({
                                    title: 'Remover membro',
                                    description: `Remover ${member.displayName} desta empresa? O histórico existente será preservado.`,
                                    run: async () => removeMember(member),
                                  })
                                }
                              >
                                Remover
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {adminSection === 'inventory' ? (
                    <InventoryAdminPanel
                      groupId={groupSession.groupId}
                      active
                      adminSession={adminSession}
                      onToast={setToast}
                      onUnreadChange={setInventoryUnread}
                    />
                  ) : null}

                  {adminSection === 'security' ? (
                    <section className="surface-panel p-6">
                      <h2 className="font-semibold">
                        Alterar senha da Administração
                      </h2>
                      <p className="mt-1 text-sm text-[var(--text-soft)]">
                        Exige a senha atual. Todas as autorizações abertas serão
                        encerradas.
                      </p>
                      <form
                        className="mt-5 grid grid-cols-[1fr_1fr_auto] gap-3 max-lg:grid-cols-1"
                        onSubmit={changeAdminPassword}
                      >
                        <Input
                          type="password"
                          className="taggi-control"
                          placeholder="Senha atual"
                          value={currentAdminPassword}
                          onChange={(event) =>
                            setCurrentAdminPassword(event.target.value)
                          }
                        />
                        <Input
                          type="password"
                          className="taggi-control"
                          placeholder="Nova senha (mín. 8)"
                          value={newAdminPassword}
                          onChange={(event) =>
                            setNewAdminPassword(event.target.value)
                          }
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          className="taggi-button-subtle"
                        >
                          Alterar senha
                        </Button>
                      </form>
                      <TeamDeletionPanel
                        groupId={groupSession.groupId}
                        groupName={groupSession.groupName}
                        adminSession={adminSession}
                        onDeleted={async () => {
                          await signOut('Equipe excluída. Crie uma equipe vazia ou continue em outro acesso salvo.');
                          await refreshMemberships();
                        }}
                      />
                    </section>
                  ) : null}
                </div>
              )}
            </>
          ) : null}

          {view === 'settings' ? (
            <>
              <SectionHeading
                title="Configurações"
                subtitle="Personalize a aparência e consulte as informações do aplicativo."
              />
              <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)] gap-5 max-xl:grid-cols-1">
                <div className="space-y-5">
                  <section className="surface-panel overflow-hidden p-6">
                    <div className="flex items-center gap-3">
                      <Palette className="size-5 text-[var(--app-accent)]" />
                      <h2 className="font-semibold">Aparência</h2>
                    </div>
                    <p className="mt-6 text-sm text-[var(--text-soft)]">Tema</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 max-sm:grid-cols-1">
                      {themeOptions.map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          className={
                            theme === id
                              ? 'flex items-center justify-center gap-2 rounded-xl border border-[var(--app-accent)] bg-[var(--surface-hover)] px-3 py-3 text-sm'
                              : 'flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-3 text-sm text-[var(--text-soft)]'
                          }
                          onClick={() => setTheme(id)}
                        >
                          <Icon className="size-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-7 border-t border-[var(--line)] pt-6">
                      <p className="text-sm text-[var(--text-soft)]">
                        Cor principal
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        {accentColors.map((color) => (
                          <button
                            key={color}
                            aria-label={'Usar cor ' + color}
                            className="grid size-10 place-items-center rounded-full transition hover:scale-105"
                            style={{
                              background: color,
                              outline:
                                accent === color
                                  ? '2px solid ' + color
                                  : undefined,
                              outlineOffset: '3px',
                            }}
                            onClick={() => setAccent(color)}
                          >
                            {accent === color ? (
                              <Check className="size-4 text-white" />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-7 grid grid-cols-2 gap-5 border-t border-[var(--line)] pt-6 max-sm:grid-cols-1">
                      <div>
                        <p className="text-sm text-[var(--text-soft)]">
                          Números das plataformas
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[
                            ['auto', 'Auto'],
                            ['#f5f7fa', 'Branco'],
                            ['#1684ff', 'Azul'],
                            ['#22bd72', 'Verde'],
                          ].map((choice) => (
                            <button
                              key={choice[0]}
                              className={
                                platformNumberColor === choice[0]
                                  ? 'rounded-lg border border-[var(--app-accent)] px-3 py-2 text-xs'
                                  : 'rounded-lg border border-[var(--line)] px-3 py-2 text-xs'
                              }
                              onClick={() => setPlatformNumberColor(choice[0])}
                            >
                              {choice[1]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm text-[var(--text-soft)]">
                          Total do Dia
                        </p>
                        <div className="mt-3 flex gap-2">
                          {['#1684ff', '#22bd72', '#ff4f87', '#8b6cff'].map(
                            (color) => (
                              <button
                                key={color}
                                aria-label={'Usar cor ' + color + ' no total'}
                                className="size-8 rounded-full"
                                style={{
                                  background: color,
                                  outline:
                                    totalColor === color
                                      ? '2px solid ' + color
                                      : undefined,
                                  outlineOffset: '2px',
                                }}
                                onClick={() => setTotalColor(color)}
                              />
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
                <aside className="space-y-5">
                  <section className="surface-panel overflow-hidden p-6">
                    <div className="flex items-center gap-3">
                      <Info className="size-5 text-[var(--app-accent)]" />
                      <h2 className="font-semibold">Sobre</h2>
                    </div>
                    <p className="mt-5 text-sm leading-6 text-[var(--text-soft)]">
                      O Tage foi criado para simplificar a rotina de operações
                      de e-commerce, reunindo pedidos, etiquetas, saídas e
                      atividades da equipe em um só lugar. As informações são
                      organizadas por empresa e sincronizadas em tempo real,
                      facilitando o acompanhamento da operação e reduzindo erros
                      no dia a dia.
                    </p>
                    <h3 className="mt-6 border-t border-[var(--line)] pt-5 text-lg font-semibold">
                      Tage
                    </h3>
                    <p className="mt-1 text-sm text-[var(--text-soft)]">
                      Versão {appInfo?.version ?? '1.0.0'}
                    </p>
                    <p className="mt-6 border-t border-[var(--line)] pt-5 text-sm text-[var(--text-muted)]">
                      Desenvolvido por Juan Nunes
                    </p>
                  </section>
                  <section className="surface-panel p-6">
                    <div className="flex items-center gap-3">
                      <Download className="size-5 text-[var(--app-accent)]" />
                      <h2 className="font-semibold">Atualizações</h2>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--text-soft)]">
                      O Tage busca e baixa novas versões sozinho. Quando não há
                      edição ou envio em andamento, ele instala e reabre
                      automaticamente. Não é necessário clicar em nada.
                    </p>
                    {updateState.phase === 'disabled' ? (
                      <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                        Este instalador é uma versão de teste. A atualização
                        automática começa quando esta versão for aprovada e
                        publicada.
                      </p>
                    ) : updateState.phase !== 'idle' ? (
                      <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                        {updateState.message}
                      </p>
                    ) : null}
                    {updateState.phase === 'downloading' ? (
                      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                        <div
                          className="h-full rounded-full bg-[var(--app-accent)] transition-[width]"
                          style={{ width: (updateState.progress ?? 0) + '%' }}
                        />
                      </div>
                    ) : null}
                    {updateState.releaseNotes ? (
                      <p className="mt-4 whitespace-pre-line rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-3 text-xs leading-5 text-[var(--text-soft)]">
                        {updateState.releaseNotes}
                      </p>
                    ) : null}
                    {!['ready', 'installing'].includes(updateState.phase) ? (
                      <Button
                        variant="outline"
                        className="taggi-button-subtle mt-5 w-full"
                        disabled={updateBusy}
                        onClick={() => {
                          if (updateState.phase === 'disabled') {
                            setToast(
                              'Esta versão é de teste. Após sua aprovação, a versão publicada será entregue automaticamente.',
                            );
                            return;
                          }
                          void checkForUpdates();
                        }}
                      >
                        <RefreshCw
                          className={
                            updateBusy ? 'size-4 animate-spin' : 'size-4'
                          }
                        />
                        Verificar atualizações
                      </Button>
                    ) : null}
                  </section>
                  <section className="surface-panel p-6">
                    <h2 className="font-semibold">Feedback</h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
                      Compartilhe uma sugestão, elogio ou problema. Seu relato
                      nos ajuda a melhorar o Tage.
                    </p>
                    <Button
                      variant="outline"
                      className="taggi-button-subtle mt-5 w-full rounded-xl"
                      onClick={() => setFeedbackOpen(true)}
                    >
                      <MessagesSquare className="size-4" />
                      Abrir feedback
                    </Button>
                  </section>
                </aside>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <Dialog
        open={!groupSession.tutorialCompletedAt}
        onOpenChange={() => undefined}
      >
        <DialogContent
          className="taggi-dialog sm:max-w-lg"
          showCloseButton={false}
        >
          {(() => {
            const slide = tutorialSlides[tutorialStep] ?? tutorialSlides[0];
            const TutorialIcon = slide.icon;
            const last = tutorialStep === tutorialSlides.length - 1;
            return (
              <div className="p-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="grid size-14 place-items-center rounded-2xl bg-[var(--surface-soft)] text-[var(--app-accent)] ring-1 ring-[var(--line)]">
                    <TutorialIcon className="size-6" />
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {tutorialStep + 1} de {tutorialSlides.length}
                  </span>
                </div>
                <h2 className="mt-7 text-2xl font-semibold tracking-[-0.03em]">
                  {slide.title}
                </h2>
                <p className="mt-3 min-h-20 text-sm leading-7 text-[var(--text-soft)]">
                  {slide.text}
                </p>
                <ol className="mt-4 space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm text-[var(--text-soft)]">
                  {slide.steps.map((step, index) => (
                    <li key={step} className="flex gap-3 leading-6">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--app-accent)] text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-6 flex gap-2">
                  {tutorialSlides.map((_, index) => (
                    <span
                      key={index}
                      className="h-1.5 flex-1 rounded-full"
                      style={{
                        background:
                          index <= tutorialStep
                            ? 'var(--app-accent)'
                            : 'var(--surface-hover)',
                      }}
                    />
                  ))}
                </div>
                <div className="mt-7 flex items-center justify-between gap-3">
                  <button
                    className="text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]"
                    disabled={onboardingBusy}
                    onClick={() => void finishTutorial(true)}
                  >
                    Pular tutorial
                  </button>
                  <div className="flex gap-2">
                    {tutorialStep > 0 ? (
                      <Button
                        variant="outline"
                        className="taggi-button-subtle"
                        onClick={() => setTutorialStep((step) => step - 1)}
                      >
                        Voltar
                      </Button>
                    ) : null}
                    <Button
                      className="taggi-button-primary"
                      disabled={onboardingBusy}
                      onClick={() =>
                        last
                          ? void finishTutorial(false)
                          : setTutorialStep((step) => step + 1)
                      }
                    >
                      {onboardingBusy ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : null}
                      {last ? 'Concluir' : 'Continuar'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(
          groupSession.tutorialCompletedAt &&
          groupSession.role === 'manager' &&
          !groupSession.adminPasswordConfigured,
        )}
        onOpenChange={() => undefined}
      >
        <DialogContent
          className="taggi-dialog sm:max-w-md"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>Crie a senha da Administração</DialogTitle>
            <DialogDescription>
              Esta etapa é obrigatória para concluir a configuração da empresa.
              A senha será protegida no servidor e não será exibida novamente.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveInitialAdminPassword}>
            <Input
              type="password"
              autoComplete="new-password"
              className="taggi-control h-11"
              placeholder="Senha com 8 ou mais caracteres"
              value={setupPassword}
              onChange={(event) => setSetupPassword(event.target.value)}
            />
            <Input
              type="password"
              autoComplete="new-password"
              className="taggi-control h-11"
              placeholder="Repita a senha"
              value={setupPasswordConfirm}
              onChange={(event) => setSetupPasswordConfirm(event.target.value)}
            />
            {setupError ? (
              <p className="text-sm text-red-400">{setupError}</p>
            ) : null}
            <Button
              type="submit"
              className="taggi-button-primary h-11 w-full"
              disabled={onboardingBusy}
            >
              {onboardingBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Salvar senha e entrar
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="taggi-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar feedback</DialogTitle>
            <DialogDescription>
              Agradecemos por compartilhar sua experiência. Seu feedback nos
              ajuda a melhorar o Tage a cada versão.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitFeedback}>
            <label className="block text-sm text-[var(--text-soft)]">
              Categoria
              <NativeSelect className="mt-2 w-full" name="category">
                <NativeSelectOption value="sugestao">
                  Sugestão
                </NativeSelectOption>
                <NativeSelectOption value="problema">
                  Problema
                </NativeSelectOption>
                <NativeSelectOption value="elogio">Elogio</NativeSelectOption>
                <NativeSelectOption value="interface">
                  Interface
                </NativeSelectOption>
                <NativeSelectOption value="desempenho">
                  Desempenho
                </NativeSelectOption>
                <NativeSelectOption value="cobranca">
                  Cobrança
                </NativeSelectOption>
                <NativeSelectOption value="outro">Outro</NativeSelectOption>
              </NativeSelect>
            </label>
            <label className="block text-sm text-[var(--text-soft)]">
              Relato
              <textarea
                required
                name="body"
                minLength={5}
                maxLength={3000}
                className="taggi-control mt-2 min-h-28 w-full rounded-xl border p-3 outline-none"
                placeholder="Conte o que aconteceu..."
              />
            </label>
            <Button
              type="submit"
              className="taggi-button-primary h-10 w-full rounded-xl"
              disabled={feedbackSent}
            >
              {feedbackSent ? 'Enviando...' : 'Enviar feedback'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addPlatformOpen} onOpenChange={setAddPlatformOpen}>
        <DialogContent className="taggi-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar plataforma</DialogTitle>
            <DialogDescription>
              Cadastre a plataforma, a primeira loja e, se quiser, a logo
              oficial.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={addPlatform}>
            <label className="block text-sm text-[var(--text-soft)]">
              Plataforma
              <Input
                className="taggi-control mt-2 h-10"
                name="name"
                placeholder="Ex.: Mercado Livre"
                required
              />
            </label>
            <label className="block text-sm text-[var(--text-soft)]">
              Primeira loja
              <Input
                className="taggi-control mt-2 h-10"
                name="store"
                placeholder="Ex.: Loja principal"
                required
              />
            </label>
            <label className="block text-sm text-[var(--text-soft)]">
              Logo da plataforma
              <span className="taggi-control mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3">
                <ImagePlus className="size-4" />
                <span className="text-sm">Selecionar JPG, PNG ou WebP</span>
                <input
                  className="sr-only"
                  name="logo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
              </span>
            </label>
            <label className="block text-sm text-[var(--text-soft)]">
              Cor de identificação
              <Input
                className="taggi-control mt-2 h-10 p-1"
                name="color"
                type="color"
                defaultValue="#1684ff"
              />
            </label>
            <Button
              type="submit"
              className="taggi-button-primary h-10 w-full rounded-xl"
              disabled={platformBusy}
            >
              {platformBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {platformBusy ? 'Salvando...' : 'Adicionar'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(managedPlatform)}
        onOpenChange={(open) => {
          if (!open) setManagePlatformId(null);
        }}
      >
        <DialogContent className="taggi-dialog max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Configurar plataforma</DialogTitle>
            <DialogDescription>
              Altere a identidade visual e organize as lojas disponíveis no
              lançamento.
            </DialogDescription>
          </DialogHeader>
          {managedPlatform ? (
            <div className="space-y-6">
              <form className="space-y-4" onSubmit={savePlatformSettings}>
                <div className="flex items-center gap-4 rounded-2xl bg-[var(--surface-soft)] p-4">
                  <PlatformMark
                    platform={managedPlatform}
                    className="grid size-16 shrink-0 place-items-center rounded-2xl font-bold"
                  />
                  <div>
                    <p className="font-medium">{managedPlatform.name}</p>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">
                      A logo continuará salva ao fechar o aplicativo.
                    </p>
                  </div>
                </div>
                <label className="block text-sm text-[var(--text-soft)]">
                  Nome da plataforma
                  <Input
                    className="taggi-control mt-2 h-10"
                    value={platformEditName}
                    onChange={(event) =>
                      setPlatformEditName(event.target.value)
                    }
                    required
                  />
                </label>
                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <label className="block text-sm text-[var(--text-soft)]">
                    Nova logo
                    <span className="taggi-control mt-2 flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3">
                      <ImagePlus className="size-4" />
                      <span className="truncate text-xs">
                        {platformLogoFile?.name ?? 'Escolher arquivo'}
                      </span>
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) =>
                          setPlatformLogoFile(event.target.files?.[0] ?? null)
                        }
                      />
                    </span>
                  </label>
                  <label className="block text-sm text-[var(--text-soft)]">
                    Cor
                    <Input
                      className="taggi-control mt-2 h-10 p-1"
                      type="color"
                      value={platformEditColor}
                      onChange={(event) =>
                        setPlatformEditColor(event.target.value)
                      }
                    />
                  </label>
                </div>
                <Button
                  type="submit"
                  className="taggi-button-primary w-full"
                  disabled={platformBusy}
                >
                  {platformBusy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Salvar identidade
                </Button>
              </form>

              <section className="border-t border-[var(--line)] pt-5">
                <h3 className="font-medium">Lojas desta plataforma</h3>
                <div className="mt-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] px-4">
                  {managedPlatform.stores.map((store) => (
                    <div
                      key={store.id}
                      className="flex items-center justify-between gap-3 py-3 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <Store className="size-4 text-[var(--text-muted)]" />
                        {store.name}
                      </span>
                      {managedPlatform.stores.length > 1 ? (
                        <button
                          className="text-red-400"
                          onClick={() =>
                            setAppConfirm({
                              title: 'Remover loja',
                              description: `Remover ${store.name} desta plataforma? O histórico existente será preservado.`,
                              run: async () => archiveStore(store),
                            })
                          }
                          aria-label={'Remover ' + store.name}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <form className="mt-3 flex gap-2" onSubmit={addStoreToManaged}>
                  <Input
                    className="taggi-control h-10 flex-1"
                    placeholder="Nome da nova loja"
                    value={newStoreName}
                    onChange={(event) => setNewStoreName(event.target.value)}
                  />
                  <Button
                    type="submit"
                    className="taggi-button-subtle"
                    variant="outline"
                    disabled={platformBusy || newStoreName.trim().length < 2}
                  >
                    <Plus className="size-4" />
                    Adicionar loja
                  </Button>
                </form>
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(occurrencePlatformId)}
        onOpenChange={(open) => {
          if (!open) setOccurrencePlatformId(null);
        }}
      >
        <DialogContent className="taggi-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar ocorrência</DialogTitle>
            <DialogDescription>
              A quantidade será descontada automaticamente da contagem válida.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={registerOccurrence}>
            <label className="block text-sm text-[var(--text-soft)]">
              Loja
              <NativeSelect className="mt-2 w-full" name="storeId">
                {(occurrencePlatform?.stores ?? []).map((store) => (
                  <NativeSelectOption key={store.id} value={store.id}>
                    {store.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="block text-sm text-[var(--text-soft)]">
              Motivo
              <NativeSelect className="mt-2 w-full" name="reason">
                <NativeSelectOption value="Pedido cancelado">
                  Pedido cancelado
                </NativeSelectOption>
                <NativeSelectOption value="Pedido duplicado">
                  Pedido duplicado
                </NativeSelectOption>
                <NativeSelectOption value="Sem estoque">
                  Sem estoque
                </NativeSelectOption>
                <NativeSelectOption value="Outro ajuste">
                  Outro ajuste
                </NativeSelectOption>
              </NativeSelect>
            </label>
            <label className="block text-sm text-[var(--text-soft)]">
              Quantidade
              <Input
                className="taggi-control mt-2 h-10"
                name="quantity"
                type="number"
                min="1"
                defaultValue="1"
                required
              />
            </label>
            <Button
              type="submit"
              className="taggi-button-primary h-10 w-full rounded-xl"
              disabled={dayClosed}
            >
              Confirmar ajuste
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={teamAccessOpen} onOpenChange={setTeamAccessOpen}>
        <DialogContent className="taggi-dialog max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogTitle className="sr-only">Equipes e acessos</DialogTitle>
          <DialogDescription className="sr-only">Escolha uma equipe salva ou crie uma operação nova.</DialogDescription>
          <AccessPanel embedded onComplete={() => setTeamAccessOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="taggi-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Finalizar as contagens do dia?</DialogTitle>
            <DialogDescription>
              Os totais serão confirmados no Histórico e novos lançamentos
              ficarão bloqueados até a meia-noite de São Paulo. A ação é
              auditável.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm text-[var(--text-soft)]">
            Motivo obrigatório
            <Input
              className="taggi-control mt-2"
              value={resetReason}
              onChange={(event) => setResetReason(event.target.value)}
              placeholder="Ex.: Encerramento da operação"
            />
          </label>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              className="taggi-button-subtle"
              onClick={() => setResetOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              className="taggi-button-primary"
              disabled={resetReason.trim().length < 3}
              onClick={closeOperationalDay}
            >
              Confirmar e finalizar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(correctionEvent)}
        onOpenChange={(open) => {
          if (!open) setCorrectionEvent(null);
        }}
      >
        <DialogContent className="taggi-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Corrigir registro do histórico</DialogTitle>
            <DialogDescription>
              O registro original será preservado. A correção cria uma
              movimentação auditável protegida pela senha da Administração.
            </DialogDescription>
          </DialogHeader>
          {correctionEvent ? (
            <form className="space-y-4" onSubmit={submitHistoryCorrection}>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm">
                <p className="font-medium">
                  Valor registrado: {correctionEvent.delta > 0 ? '+' : ''}
                  {formatNumber(correctionEvent.delta)}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {correctionEvent.storeName} ·{' '}
                  {formatRemoteTime(correctionEvent.createdAt)}
                </p>
              </div>
              <label className="block text-sm text-[var(--text-soft)]">
                Valor correto
                <Input
                  className="taggi-control mt-2"
                  type="number"
                  step="1"
                  value={correctionValue}
                  onChange={(event) => setCorrectionValue(event.target.value)}
                  required
                />
              </label>
              <label className="block text-sm text-[var(--text-soft)]">
                Motivo da correção
                <Input
                  className="taggi-control mt-2"
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  required
                />
              </label>
              <Button type="submit" className="taggi-button-primary w-full">
                Registrar correção
              </Button>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(appConfirm)}
        onOpenChange={(open) => {
          if (!open) setAppConfirm(null);
        }}
      >
        <DialogContent className="taggi-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{appConfirm?.title}</DialogTitle>
            <DialogDescription>{appConfirm?.description}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              className="taggi-button-subtle"
              onClick={() => setAppConfirm(null)}
            >
              Cancelar
            </Button>
            <Button
              className="bg-red-500 text-white hover:bg-red-500/80"
              onClick={() => {
                const action = appConfirm;
                setAppConfirm(null);
                if (action) void action.run();
              }}
            >
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {toast ? (
        <output
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[80] rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--text-main)] shadow-2xl backdrop-blur-xl"
        >
          {toast}
        </output>
      ) : null}
    </main>
  );
}

function ActiveTeamWorkspace() {
  const { activeMembership } = useAuth();
  return <TaggiWorkspace key={activeMembership?.groupId ?? 'access'} />;
}

export default function TaggiApp() {
  return (
    <AuthProvider>
      <ActiveTeamWorkspace />
    </AuthProvider>
  );
}
