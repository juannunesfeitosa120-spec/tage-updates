'use client';

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Activity,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileClock,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  TicketCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
import { readableError } from '@/lib/taggi';
import { supabase } from '@/lib/supabase';

type OwnerSession = { id: string; token: string; expiresAt: string };
type OwnerSection =
  | 'overview'
  | 'companies'
  | 'users'
  | 'subscriptions'
  | 'payments'
  | 'licenses'
  | 'plans'
  | 'feedbacks'
  | 'versions'
  | 'logs'
  | 'system'
  | 'settings';
type OwnerAccess = { isOwner: boolean; passwordConfigured: boolean };
type Row = Record<string, unknown>;

const ownerNav = [
  ['overview', 'Visão geral', LayoutDashboard],
  ['companies', 'Empresas', Building2],
  ['users', 'Usuários', Users],
  ['subscriptions', 'Assinaturas', CircleDollarSign],
  ['payments', 'Pagamentos', BadgeDollarSign],
  ['licenses', 'Licenças', TicketCheck],
  ['plans', 'Planos', PackageCheck],
  ['feedbacks', 'Feedbacks', LifeBuoy],
  ['versions', 'Versões', FileClock],
  ['logs', 'Logs', Activity],
  ['system', 'Sistema', ShieldCheck],
  ['settings', 'Configurações', Settings2],
] as const;

const sectionResource: Partial<Record<OwnerSection, string>> = {
  companies: 'companies',
  users: 'users',
  subscriptions: 'subscriptions',
  payments: 'payments',
  licenses: 'licenses',
  plans: 'plans',
  feedbacks: 'feedbacks',
  versions: 'versions',
  logs: 'logs',
  settings: 'settings',
};

const labels: Record<string, string> = {
  name: 'Nome',
  display_name: 'Nome',
  email: 'E-mail',
  company_name: 'Empresa',
  group_code: 'Código',
  owner_name: 'Proprietário',
  members: 'Membros',
  role: 'Cargo',
  plan_name: 'Plano',
  subscription_status: 'Assinatura',
  status: 'Status',
  period: 'Período',
  price_cents: 'Preço',
  code_hint: 'Código',
  license_type: 'Tipo',
  target_scope: 'Vínculo',
  uses_count: 'Usos',
  max_uses: 'Limite',
  category: 'Categoria',
  body: 'Mensagem',
  app_version: 'Versão',
  action: 'Ação',
  target_type: 'Alvo',
  version: 'Versão',
  channel: 'Canal',
  created_at: 'Criado em',
  last_seen_at: 'Último acesso',
  current_period_end: 'Validade',
  expires_at: 'Expira em',
  key: 'Parâmetro',
  value: 'Valor',
};

const preferredColumns: Record<string, string[]> = {
  companies: [
    'name',
    'code',
    'owner_name',
    'members',
    'plan_name',
    'subscription_status',
    'status',
    'created_at',
  ],
  users: [
    'display_name',
    'email',
    'company_name',
    'role',
    'plan_name',
    'status',
    'last_seen_at',
  ],
  subscriptions: [
    'company_name',
    'plan_name',
    'status',
    'price_cents',
    'started_at',
    'current_period_end',
    'source',
  ],
  payments: [
    'company_name',
    'amount_cents',
    'currency',
    'status',
    'payment_method',
    'provider_reference',
    'created_at',
  ],
  licenses: [
    'code_hint',
    'license_type',
    'plan_name',
    'status',
    'uses_count',
    'max_uses',
    'expires_at',
  ],
  plans: [
    'name',
    'period',
    'price_cents',
    'user_limit',
    'status',
    'created_at',
  ],
  feedbacks: [
    'display_name',
    'company_name',
    'category',
    'body',
    'app_version',
    'status',
    'created_at',
  ],
  versions: [
    'version',
    'channel',
    'status',
    'mandatory',
    'published_at',
    'download_url',
  ],
  logs: ['action', 'owner_name', 'target_type', 'target_id', 'created_at'],
  settings: ['key', 'value', 'description', 'updated_at'],
};

function formatCell(key: string, value: unknown) {
  if (value == null || value === '') return '—';
  if (key.endsWith('_at') || ['started_at', 'published_at'].includes(key)) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime()))
      return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
  }
  if (key === 'price_cents' || key === 'amount_cents')
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Number(value) / 100);
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
}) {
  return (
    <article className="owner-metric">
      <span>
        <Icon className="size-5" />
      </span>
      <strong>{value}</strong>
      <p>{label}</p>
    </article>
  );
}

export function OwnerConsole({
  access,
  ownerName,
  onExit,
}: {
  access: OwnerAccess;
  ownerName: string;
  onExit: () => void;
}) {
  const [ownerSession, setOwnerSession] = useState<OwnerSession | null>(null);
  const [section, setSection] = useState<OwnerSection>('overview');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dashboard, setDashboard] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [planOptions, setPlanOptions] = useState<Row[]>([]);
  const [companySubscription, setCompanySubscription] = useState<Row | null>(
    null,
  );
  const [versionOpen, setVersionOpen] = useState(false);
  const [settingEdit, setSettingEdit] = useState<Row | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const pageSize = 20;

  const rpcSession = useMemo(
    () =>
      ownerSession
        ? { p_session_id: ownerSession.id, p_session_token: ownerSession.token }
        : null,
    [ownerSession],
  );

  const loadDashboard = useCallback(async () => {
    if (!supabase || !rpcSession) return;
    const response = await supabase.rpc('taggi_owner_dashboard', rpcSession);
    if (response.error) throw response.error;
    setDashboard((response.data ?? {}) as Row);
  }, [rpcSession]);

  const loadRows = useCallback(async () => {
    const resource = sectionResource[section];
    if (!supabase || !rpcSession || !resource) {
      setRows([]);
      setTotal(0);
      return;
    }
    setBusy(true);
    const response = await supabase.rpc('taggi_owner_list', {
      p_resource: resource,
      p_search: search,
      p_status: status,
      p_offset: page * pageSize,
      p_limit: pageSize,
      ...rpcSession,
    });
    setBusy(false);
    if (response.error) {
      setMessage(readableError(response.error));
      return;
    }
    const data = (response.data ?? {}) as { items?: Row[]; total?: number };
    setRows(data.items ?? []);
    setTotal(Number(data.total ?? 0));
  }, [page, rpcSession, search, section, status]);

  useEffect(() => {
    if (!ownerSession) return;
    void loadDashboard().catch((error) => setMessage(readableError(error)));
  }, [loadDashboard, ownerSession]);
  useEffect(() => {
    if (!supabase || !rpcSession || (!licenseOpen && !companySubscription))
      return;
    void supabase
      .rpc('taggi_owner_list', {
        p_resource: 'plans',
        p_search: '',
        p_status: '',
        p_offset: 0,
        p_limit: 100,
        ...rpcSession,
      })
      .then(({ data, error }) => {
        if (error) setMessage(readableError(error));
        else setPlanOptions((data as { items?: Row[] })?.items ?? []);
      });
  }, [companySubscription, licenseOpen, rpcSession]);
  useEffect(() => {
    if (!ownerSession) return;
    const timer = window.setTimeout(() => void loadRows(), 180);
    return () => window.clearTimeout(timer);
  }, [loadRows, ownerSession]);
  useEffect(() => {
    setPage(0);
    setStatus('');
    setSearch('');
  }, [section]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function setupOwner(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (password.length < 10 || password !== confirmPassword) {
      setMessage('Use 10 ou mais caracteres e repita a mesma senha.');
      return;
    }
    setBusy(true);
    const response = await supabase.rpc('taggi_owner_setup_password', {
      p_password: password,
    });
    setBusy(false);
    if (response.error) {
      setMessage(readableError(response.error));
      return;
    }
    setMessage('Senha Owner criada. Entre para continuar.');
    setPassword('');
    setConfirmPassword('');
    window.location.reload();
  }
  async function unlockOwner(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !password) return;
    setBusy(true);
    const response = await supabase.rpc('taggi_owner_unlock', {
      p_password: password,
    });
    setBusy(false);
    const row = response.data?.[0];
    if (response.error || !row) {
      setMessage(readableError(response.error, 'Senha Owner incorreta.'));
      return;
    }
    setOwnerSession({
      id: row.session_id,
      token: row.session_token,
      expiresAt: row.expires_at,
    });
    setPassword('');
  }
  async function lockOwner() {
    if (supabase && rpcSession)
      await supabase.rpc('taggi_owner_lock', rpcSession);
    setOwnerSession(null);
    onExit();
  }

  async function runAction(
    action: string,
    targetId: string,
    payload: Row = {},
  ) {
    if (!supabase || !rpcSession) return;
    setBusy(true);
    const response = await supabase.rpc('taggi_owner_action', {
      p_action: action,
      p_target_id: targetId,
      p_payload: payload,
      ...rpcSession,
    });
    setBusy(false);
    if (response.error) {
      setMessage(readableError(response.error));
      return;
    }
    setMessage('Ação concluída com segurança.');
    await Promise.all([loadRows(), loadDashboard()]);
  }

  function requestAction(
    title: string,
    description: string,
    run: () => Promise<void>,
  ) {
    setConfirmAction({ title, description, run });
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !rpcSession) return;
    const form = new FormData(event.currentTarget);
    const response = await supabase.rpc('taggi_owner_save_plan', {
      p_plan_id: null,
      p_name: String(form.get('name') ?? ''),
      p_price_cents: Math.round(Number(form.get('price') ?? 0) * 100),
      p_period: String(form.get('period') ?? 'monthly'),
      p_features: String(form.get('features') ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      p_user_limit: Number(form.get('limit') ?? 25),
      p_status: 'active',
      ...rpcSession,
    });
    if (response.error) {
      setMessage(readableError(response.error));
      return;
    }
    setPlanOpen(false);
    setMessage('Plano criado.');
    await loadRows();
  }

  async function generateLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !rpcSession) return;
    const form = new FormData(event.currentTarget);
    const response = await supabase.rpc('taggi_owner_generate_license', {
      p_license_type: String(form.get('type') ?? 'lifetime'),
      p_plan_id: String(form.get('planId') ?? ''),
      p_target_scope: String(form.get('scope') ?? 'company'),
      p_max_uses: Number(form.get('uses') ?? 1),
      p_duration_days: null,
      p_expires_at: null,
      p_note: String(form.get('note') ?? ''),
      p_beneficiary_user_id: null,
      p_beneficiary_group_id: null,
      ...rpcSession,
    });
    const row = response.data?.[0];
    if (response.error || !row) {
      setMessage(readableError(response.error));
      return;
    }
    setGeneratedCode(row.license_code);
    setMessage('Licença criada. Copie o código agora.');
    await loadRows();
  }

  async function saveCompanySubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !rpcSession || !companySubscription) return;
    const form = new FormData(event.currentTarget);
    const validUntil = String(form.get('validUntil') ?? '').trim();
    const response = await supabase.rpc(
      'taggi_owner_set_company_subscription',
      {
        p_group_id: String(companySubscription.id),
        p_plan_id: String(form.get('planId') ?? ''),
        p_status: String(form.get('status') ?? 'active'),
        p_valid_until: validUntil ? new Date(validUntil).toISOString() : null,
        ...rpcSession,
      },
    );
    if (response.error) {
      setMessage(readableError(response.error));
      return;
    }
    setCompanySubscription(null);
    setMessage('Plano da empresa atualizado com segurança.');
    await Promise.all([loadRows(), loadDashboard()]);
  }

  async function saveVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !rpcSession) return;
    const form = new FormData(event.currentTarget);
    const response = await supabase.rpc('taggi_owner_save_version', {
      p_version: String(form.get('version') ?? ''),
      p_build_number: Number(form.get('buildNumber') ?? 1),
      p_channel: String(form.get('channel') ?? 'beta'),
      p_status: String(form.get('status') ?? 'DRAFT'),
      p_minimum_version: String(form.get('minimumVersion') ?? ''),
      p_release_notes: String(form.get('notes') ?? ''),
      p_download_url: String(form.get('downloadUrl') ?? ''),
      p_mandatory: form.get('mandatory') === 'on',
      ...rpcSession,
    });
    if (response.error) {
      setMessage(readableError(response.error));
      return;
    }
    setVersionOpen(false);
    setMessage('Versão registrada.');
    await loadRows();
  }

  async function saveSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !rpcSession || !settingEdit) return;
    const form = new FormData(event.currentTarget);
    let value: unknown;
    try {
      value = JSON.parse(String(form.get('value') ?? 'null'));
    } catch {
      setMessage('Informe um valor JSON válido, como true, 14 ou "texto".');
      return;
    }
    const response = await supabase.rpc('taggi_owner_update_setting', {
      p_key: String(settingEdit.key),
      p_value: value,
      ...rpcSession,
    });
    if (response.error) {
      setMessage(readableError(response.error));
      return;
    }
    setSettingEdit(null);
    setMessage('Configuração global atualizada.');
    await loadRows();
  }

  if (!access.isOwner) return null;
  if (!ownerSession) {
    return (
      <main className="owner-lock-screen">
        <section className="surface-panel owner-lock-card">
          <button className="owner-back" onClick={onExit}>
            <ChevronLeft className="size-4" />
            Voltar ao Tage
          </button>
          <img
            src="./taggi-app-icon.png"
            alt=""
            className="size-16 rounded-2xl"
          />
          <p className="owner-kicker">TAGE OWNER</p>
          <h1>Console privado</h1>
          <p>
            Infraestrutura, clientes, assinaturas e versões em uma área
            separada.
          </p>
          <form
            onSubmit={access.passwordConfigured ? unlockOwner : setupOwner}
            className="mt-7 space-y-3"
          >
            <Input
              type="password"
              className="taggi-control h-12"
              placeholder={
                access.passwordConfigured ? 'Senha Owner' : 'Crie a senha Owner'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!access.passwordConfigured ? (
              <Input
                type="password"
                className="taggi-control h-12"
                placeholder="Repita a senha Owner"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            ) : null}
            <Button
              className="taggi-button-primary h-12 w-full"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <LockKeyhole className="size-4" />
              )}
              {access.passwordConfigured
                ? 'Desbloquear Owner'
                : 'Proteger e continuar'}
            </Button>
          </form>
          {message ? (
            <p className="mt-4 text-sm text-amber-300">{message}</p>
          ) : null}
        </section>
      </main>
    );
  }

  const columns =
    preferredColumns[sectionResource[section] ?? ''] ??
    Object.keys(rows[0] ?? {}).slice(0, 7);
  return (
    <main className="owner-shell">
      <aside className="owner-sidebar">
        <div className="owner-brand">
          <img src="./taggi-app-icon.png" alt="" />
          <span>
            <strong>tage</strong>
            <small>OWNER</small>
          </span>
        </div>
        <nav>
          {ownerNav.map(([id, label, Icon]) => (
            <button
              key={id}
              data-active={section === id}
              onClick={() => setSection(id)}
            >
              <Icon className="size-4" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="owner-profile">
          <span>
            <strong>{ownerName}</strong>
            <small>System Owner</small>
          </span>
          <button aria-label="Sair do Owner" onClick={() => void lockOwner()}>
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>
      <section className="owner-main">
        <header>
          <div>
            <p>TAGE OWNER</p>
            <h1>{ownerNav.find(([id]) => id === section)?.[1]}</h1>
          </div>
          <Button
            variant="outline"
            className="taggi-button-subtle"
            onClick={() => void Promise.all([loadRows(), loadDashboard()])}
          >
            <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
            Atualizar
          </Button>
        </header>
        {section === 'overview' && dashboard ? (
          <>
            <div className="owner-metrics">
              <MetricCard
                label="Usuários"
                value={Number(dashboard.users ?? 0)}
                icon={Users}
              />
              <MetricCard
                label="Empresas"
                value={Number(dashboard.companies ?? 0)}
                icon={Building2}
              />
              <MetricCard
                label="Assinaturas ativas"
                value={Number(dashboard.activeSubscriptions ?? 0)}
                icon={CircleDollarSign}
              />
              <MetricCard
                label="Em teste"
                value={Number(dashboard.trials ?? 0)}
                icon={TicketCheck}
              />
              <MetricCard
                label="Licenças vitalícias"
                value={Number(dashboard.lifetime ?? 0)}
                icon={KeyRound}
              />
              <MetricCard
                label="Feedbacks pendentes"
                value={Number(dashboard.pendingFeedbacks ?? 0)}
                icon={LifeBuoy}
              />
              <MetricCard
                label="Novos usuários"
                value={Number(dashboard.newUsers ?? 0)}
                icon={Users}
              />
              <MetricCard
                label="Receita mensal"
                value={formatCell('price_cents', dashboard.mrrCents ?? 0)}
                icon={BadgeDollarSign}
              />
            </div>
            <section className="surface-panel owner-chart">
              <div>
                <h2>Crescimento dos últimos 30 dias</h2>
                <p>Novos usuários e empresas, sem excesso de informação.</p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={(dashboard.growth ?? []) as Row[]}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="day" hide />
                  <YAxis hide />
                  <Tooltip
                    cursor={false}
                    contentStyle={{
                      background: 'var(--surface-strong)',
                      border: '1px solid var(--line)',
                      borderRadius: 12,
                    }}
                  />
                  <Bar
                    dataKey="users"
                    fill="var(--app-accent)"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="companies"
                    fill="#22bd72"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </section>
          </>
        ) : null}
        {section === 'system' ? (
          <div className="owner-status-grid">
            {[
              ['Supabase', 'Operacional'],
              ['Autenticação', 'Operacional'],
              ['Banco de dados', 'Operacional'],
              ['Realtime', 'Operacional'],
              ['API', 'Operacional'],
              ['Pagamentos', 'Não configurado'],
            ].map(([name, state]) => (
              <article className="surface-panel" key={name}>
                <span
                  className={
                    state === 'Operacional'
                      ? 'status-dot ok'
                      : 'status-dot warn'
                  }
                />
                <h2>{name}</h2>
                <p>{state}</p>
              </article>
            ))}
          </div>
        ) : null}
        {sectionResource[section] ? (
          <>
            <div className="owner-toolbar">
              <label>
                <Search className="size-4" />
                <input
                  placeholder="Pesquisar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <NativeSelect
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <NativeSelectOption value="">
                  Todos os status
                </NativeSelectOption>
                <NativeSelectOption value="active">Ativo</NativeSelectOption>
                <NativeSelectOption value="blocked">
                  Bloqueado
                </NativeSelectOption>
                <NativeSelectOption value="new">Novo</NativeSelectOption>
                <NativeSelectOption value="resolved">
                  Resolvido
                </NativeSelectOption>
              </NativeSelect>
              {section === 'plans' ? (
                <Button
                  className="taggi-button-primary"
                  onClick={() => setPlanOpen(true)}
                >
                  <Plus className="size-4" />
                  Novo plano
                </Button>
              ) : null}
              {section === 'licenses' ? (
                <Button
                  className="taggi-button-primary"
                  onClick={() => setLicenseOpen(true)}
                >
                  <Plus className="size-4" />
                  Gerar licença
                </Button>
              ) : null}
              {section === 'versions' ? (
                <Button
                  className="taggi-button-primary"
                  onClick={() => setVersionOpen(true)}
                >
                  <Plus className="size-4" />
                  Registrar versão
                </Button>
              ) : null}
            </div>
            <section className="surface-panel owner-table-wrap">
              <table className="owner-table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c}>{labels[c] ?? c}</th>
                    ))}
                    {[
                      'users',
                      'companies',
                      'feedbacks',
                      'plans',
                      'subscriptions',
                      'licenses',
                      'versions',
                      'settings',
                    ].includes(section) ? (
                      <th>Ações</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={String(row.id ?? row.key ?? index)}>
                      {columns.map((c) => (
                        <td key={c} title={formatCell(c, row[c])}>
                          {formatCell(c, row[c])}
                        </td>
                      ))}
                      {section === 'users' ? (
                        <td>
                          <button
                            onClick={() =>
                              requestAction(
                                row.status === 'blocked'
                                  ? 'Desbloquear usuário'
                                  : 'Bloquear usuário',
                                'A permissão será validada no servidor.',
                                () =>
                                  runAction(
                                    row.status === 'blocked'
                                      ? 'unblock_user'
                                      : 'block_user',
                                    String(row.id),
                                  ),
                              )
                            }
                          >
                            {row.status === 'blocked'
                              ? 'Desbloquear'
                              : 'Bloquear'}
                          </button>
                        </td>
                      ) : null}
                      {section === 'companies' ? (
                        <td>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setCompanySubscription(row)}>
                              Alterar plano
                            </button>
                            <button
                              onClick={() =>
                                requestAction(
                                  row.status === 'blocked'
                                    ? 'Desbloquear empresa'
                                    : 'Bloquear empresa',
                                  'Os membros perderão acesso enquanto a empresa estiver bloqueada.',
                                  () =>
                                    runAction(
                                      row.status === 'blocked'
                                        ? 'unblock_company'
                                        : 'block_company',
                                      String(row.id),
                                    ),
                                )
                              }
                            >
                              {row.status === 'blocked'
                                ? 'Desbloquear'
                                : 'Bloquear'}
                            </button>
                          </div>
                        </td>
                      ) : null}
                      {section === 'feedbacks' ? (
                        <td>
                          <NativeSelect
                            value={String(row.status)}
                            onChange={(e) =>
                              void runAction(
                                'feedback_status',
                                String(row.id),
                                { status: e.target.value },
                              )
                            }
                          >
                            <NativeSelectOption value="new">
                              Novo
                            </NativeSelectOption>
                            <NativeSelectOption value="reviewing">
                              Analisando
                            </NativeSelectOption>
                            <NativeSelectOption value="planned">
                              Planejado
                            </NativeSelectOption>
                            <NativeSelectOption value="resolved">
                              Resolvido
                            </NativeSelectOption>
                            <NativeSelectOption value="discarded">
                              Descartado
                            </NativeSelectOption>
                          </NativeSelect>
                        </td>
                      ) : null}
                      {section === 'plans' ? (
                        <td>
                          <button
                            onClick={() =>
                              void runAction('plan_status', String(row.id), {
                                status:
                                  row.status === 'active'
                                    ? 'inactive'
                                    : 'active',
                              })
                            }
                          >
                            {row.status === 'active' ? 'Desativar' : 'Ativar'}
                          </button>
                        </td>
                      ) : null}
                      {section === 'subscriptions' ? (
                        <td>
                          <button
                            onClick={() =>
                              void runAction(
                                'subscription_status',
                                String(row.id),
                                {
                                  status:
                                    row.status === 'cancelled'
                                      ? 'active'
                                      : 'cancelled',
                                },
                              )
                            }
                          >
                            {row.status === 'cancelled'
                              ? 'Reativar'
                              : 'Cancelar'}
                          </button>
                        </td>
                      ) : null}
                      {section === 'licenses' ? (
                        <td>
                          <button
                            className="danger"
                            disabled={row.status === 'revoked'}
                            onClick={() =>
                              requestAction(
                                'Revogar licença',
                                'O código deixará de poder ser resgatado.',
                                async () => {
                                  if (!supabase || !rpcSession) return;
                                  const res = await supabase.rpc(
                                    'taggi_owner_revoke_license',
                                    { p_license_id: row.id, ...rpcSession },
                                  );
                                  if (res.error)
                                    setMessage(readableError(res.error));
                                  else {
                                    setMessage('Licença revogada.');
                                    await loadRows();
                                  }
                                },
                              )
                            }
                          >
                            Revogar
                          </button>
                        </td>
                      ) : null}
                      {section === 'versions' ? (
                        <td>
                          <button onClick={() => setVersionOpen(true)}>
                            Nova versão
                          </button>
                        </td>
                      ) : null}
                      {section === 'settings' ? (
                        <td>
                          <button onClick={() => setSettingEdit(row)}>
                            Editar
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {!rows.length && !busy ? (
                    <tr>
                      <td colSpan={columns.length + 1}>
                        <div className="owner-empty">
                          Nenhum registro encontrado.
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {busy ? (
                <div className="owner-loading">
                  <LoaderCircle className="size-5 animate-spin" />
                </div>
              ) : null}
            </section>
            <footer className="owner-pagination">
              <span>{total} registros</span>
              <div>
                <Button
                  variant="outline"
                  className="taggi-button-subtle"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span>Página {page + 1}</span>
                <Button
                  variant="outline"
                  className="taggi-button-subtle"
                  disabled={(page + 1) * pageSize >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </footer>
          </>
        ) : null}
      </section>
      {message ? <output className="owner-toast">{message}</output> : null}

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="taggi-dialog">
          <DialogHeader>
            <DialogTitle>Novo plano</DialogTitle>
            <DialogDescription>
              Cadastre preço, período, recursos e limite de usuários.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={savePlan}>
            <Input
              className="taggi-control"
              name="name"
              placeholder="Nome do plano"
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                className="taggi-control"
                name="price"
                type="number"
                min="0"
                step="0.01"
                placeholder="Preço em R$"
              />
              <NativeSelect name="period">
                <NativeSelectOption value="monthly">Mensal</NativeSelectOption>
                <NativeSelectOption value="quarterly">
                  Trimestral
                </NativeSelectOption>
                <NativeSelectOption value="semiannual">
                  Semestral
                </NativeSelectOption>
                <NativeSelectOption value="annual">Anual</NativeSelectOption>
                <NativeSelectOption value="lifetime">
                  Vitalício
                </NativeSelectOption>
                <NativeSelectOption value="promotional">
                  Promocional
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <Input
              className="taggi-control"
              name="features"
              placeholder="Recursos separados por vírgula"
            />
            <Input
              className="taggi-control"
              name="limit"
              type="number"
              min="1"
              defaultValue="25"
            />
            <Button className="taggi-button-primary w-full">Criar plano</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={licenseOpen}
        onOpenChange={(open) => {
          setLicenseOpen(open);
          if (!open) setGeneratedCode('');
        }}
      >
        <DialogContent className="taggi-dialog">
          <DialogHeader>
            <DialogTitle>Gerar licença</DialogTitle>
            <DialogDescription>
              O código completo aparece uma única vez após a criação.
            </DialogDescription>
          </DialogHeader>
          {generatedCode ? (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-5 text-center">
              <CheckCircle2 className="mx-auto size-7 text-emerald-400" />
              <p className="mt-3 font-mono text-lg tracking-wider">
                {generatedCode}
              </p>
              <Button
                className="taggi-button-primary mt-4"
                onClick={() =>
                  void navigator.clipboard.writeText(generatedCode)
                }
              >
                Copiar código
              </Button>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={generateLicense}>
              <NativeSelect name="type">
                <NativeSelectOption value="lifetime">
                  Vitalícia
                </NativeSelectOption>
                <NativeSelectOption value="monthly">Mensal</NativeSelectOption>
                <NativeSelectOption value="quarterly">
                  Trimestral
                </NativeSelectOption>
                <NativeSelectOption value="annual">Anual</NativeSelectOption>
                <NativeSelectOption value="promotional">
                  Promocional
                </NativeSelectOption>
                <NativeSelectOption value="partnership">
                  Parceria
                </NativeSelectOption>
                <NativeSelectOption value="trial">Teste</NativeSelectOption>
              </NativeSelect>
              <NativeSelect name="planId" required>
                <NativeSelectOption value="">
                  Selecione o plano
                </NativeSelectOption>
                {planOptions.map((plan) => (
                  <NativeSelectOption
                    key={String(plan.id)}
                    value={String(plan.id)}
                  >
                    {String(plan.name)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect name="scope">
                <NativeSelectOption value="company">Empresa</NativeSelectOption>
                <NativeSelectOption value="account">Conta</NativeSelectOption>
              </NativeSelect>
              <Input
                className="taggi-control"
                name="uses"
                type="number"
                min="1"
                defaultValue="1"
              />
              <Input
                className="taggi-control"
                name="note"
                placeholder="Observação opcional"
              />
              <Button className="taggi-button-primary w-full">
                Gerar licença
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(companySubscription)}
        onOpenChange={(open) => {
          if (!open) setCompanySubscription(null);
        }}
      >
        <DialogContent className="taggi-dialog">
          <DialogHeader>
            <DialogTitle>Plano da empresa</DialogTitle>
            <DialogDescription>
              {String(companySubscription?.name ?? '')} — o servidor passará a
              usar este plano para autorizar o acesso.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={saveCompanySubscription}>
            <NativeSelect name="planId" required>
              <NativeSelectOption value="">
                Selecione o plano
              </NativeSelectOption>
              {planOptions.map((plan) => (
                <NativeSelectOption
                  key={String(plan.id)}
                  value={String(plan.id)}
                >
                  {String(plan.name)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect name="status" defaultValue="active">
              <NativeSelectOption value="trial">
                Período de teste
              </NativeSelectOption>
              <NativeSelectOption value="active">Ativa</NativeSelectOption>
              <NativeSelectOption value="lifetime">
                Vitalícia
              </NativeSelectOption>
              <NativeSelectOption value="past_due">
                Pagamento pendente
              </NativeSelectOption>
              <NativeSelectOption value="expired">Expirada</NativeSelectOption>
              <NativeSelectOption value="cancelled">
                Cancelada
              </NativeSelectOption>
            </NativeSelect>
            <label className="block text-sm text-[var(--text-soft)]">
              Validade opcional
              <Input
                className="taggi-control mt-2"
                name="validUntil"
                type="datetime-local"
              />
            </label>
            <Button className="taggi-button-primary w-full">
              Salvar plano
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent className="taggi-dialog max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar versão do Tage</DialogTitle>
            <DialogDescription>
              Cadastre versão mínima, notas, canal e endereço do instalador.
              Isso não publica arquivos sozinho.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={saveVersion}>
            <div className="grid grid-cols-2 gap-3">
              <Input
                className="taggi-control"
                name="version"
                placeholder="1.1.0"
                required
              />
              <Input
                className="taggi-control"
                name="buildNumber"
                type="number"
                min="1"
                defaultValue="1"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NativeSelect name="channel" defaultValue="beta">
                <NativeSelectOption value="beta">Beta</NativeSelectOption>
                <NativeSelectOption value="stable">Stable</NativeSelectOption>
              </NativeSelect>
              <NativeSelect name="status" defaultValue="DRAFT">
                <NativeSelectOption value="DRAFT">Rascunho</NativeSelectOption>
                <NativeSelectOption value="BETA">
                  Beta publicada
                </NativeSelectOption>
                <NativeSelectOption value="STABLE">
                  Stable publicada
                </NativeSelectOption>
                <NativeSelectOption value="DEPRECATED">
                  Descontinuada
                </NativeSelectOption>
                <NativeSelectOption value="BLOCKED">
                  Bloqueada
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <Input
              className="taggi-control"
              name="minimumVersion"
              placeholder="Versão mínima, ex.: 1.0.0"
            />
            <Input
              className="taggi-control"
              name="downloadUrl"
              type="url"
              placeholder="Endereço público do instalador"
            />
            <textarea
              className="taggi-control min-h-28 w-full rounded-xl border p-3"
              name="notes"
              placeholder="O que mudou nesta versão"
            />
            <label className="flex items-center gap-2 text-sm text-[var(--text-soft)]">
              <input
                name="mandatory"
                type="checkbox"
                className="accent-[var(--app-accent)]"
              />
              Atualização obrigatória
            </label>
            <Button className="taggi-button-primary w-full">
              Registrar versão
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(settingEdit)}
        onOpenChange={(open) => {
          if (!open) setSettingEdit(null);
        }}
      >
        <DialogContent className="taggi-dialog">
          <DialogHeader>
            <DialogTitle>Configuração global</DialogTitle>
            <DialogDescription>
              {String(settingEdit?.description ?? settingEdit?.key ?? '')}
            </DialogDescription>
          </DialogHeader>
          {settingEdit ? (
            <form className="space-y-3" onSubmit={saveSetting}>
              <Input
                className="taggi-control"
                value={String(settingEdit.key)}
                disabled
              />
              <label className="block text-sm text-[var(--text-soft)]">
                Valor em JSON
                <textarea
                  className="taggi-control mt-2 min-h-28 w-full rounded-xl border p-3 font-mono text-xs"
                  name="value"
                  defaultValue={JSON.stringify(settingEdit.value, null, 2)}
                  required
                />
              </label>
              <Button className="taggi-button-primary w-full">
                Salvar configuração
              </Button>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <DialogContent className="taggi-dialog">
          <DialogHeader>
            <DialogTitle>{confirmAction?.title}</DialogTitle>
            <DialogDescription>{confirmAction?.description}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="taggi-button-subtle"
              onClick={() => setConfirmAction(null)}
            >
              Cancelar
            </Button>
            <Button
              className="bg-red-500 text-white"
              onClick={() => {
                const action = confirmAction;
                setConfirmAction(null);
                if (action) void action.run();
              }}
            >
              <XCircle className="size-4" />
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
