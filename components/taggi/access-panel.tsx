'use client';

import { type SyntheticEvent, useState } from 'react';
import {
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogIn,
  Plus,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { normalizeGroupCode, readableError } from '@/lib/taggi';
import { useAuth } from '@/providers/auth-provider';

type AccessPanelProps = {
  embedded?: boolean;
  onComplete?: () => void;
};

type AccessMode = 'create' | 'join';

export function AccessPanel({
  embedded = false,
  onComplete,
}: AccessPanelProps) {
  const {
    configured,
    session,
    memberships,
    refreshMemberships,
    accessNotice,
    clearAccessNotice,
  } = useAuth();
  const [mode, setMode] = useState<AccessMode>('create');
  const [displayName, setDisplayName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [memberPassword, setMemberPassword] = useState('');
  const [showMemberPassword, setShowMemberPassword] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const savedMemberships = session ? memberships : [];

  async function resumeSavedAccess(groupId: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await refreshMemberships(groupId);
      onComplete?.();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError('');
    clearAccessNotice();

    if (!configured || !supabase) {
      setError('A conexão compartilhada ainda não está configurada.');
      return;
    }
    if (displayName.trim().length < 2) {
      setError('Informe o seu nome na equipe.');
      return;
    }
    if (mode === 'create' && teamName.trim().length < 2) {
      setError('Informe o nome da sua equipe ou empresa.');
      return;
    }
    if (mode === 'join' && !accessCode.trim()) {
      setError('Informe o código da equipe.');
      return;
    }
    if (memberPassword.length < 8) {
      setError('A senha pessoal precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (mode === 'create' && adminPassword.length < 8) {
      setError('A senha da Administração precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (mode === 'create' && adminPassword !== adminPasswordConfirm) {
      setError('As senhas da Administração precisam ser iguais.');
      return;
    }

    setBusy(true);
    try {
      if (!session) {
        const anonymous = await supabase.auth.signInAnonymously({
          options: {
            data: {
              display_name: displayName.trim(),
              app: 'tage',
              access_type: 'team_device',
            },
          },
        });
        if (anonymous.error) throw anonymous.error;
        if (!anonymous.data.session) {
          throw new Error('Não foi possível identificar este dispositivo.');
        }
      }

      const response =
        mode === 'create'
          ? await supabase.rpc('taggi_create_team_secure', {
              p_display_name: displayName.trim(),
              p_team_name: teamName.trim(),
              p_member_password: memberPassword,
              p_admin_password: adminPassword,
            })
          : await supabase.rpc('taggi_join_team_secure', {
              p_display_name: displayName.trim(),
              p_team_code: accessCode.trim().toUpperCase(),
              p_member_password: memberPassword,
            });
      if (response.error) throw response.error;
      const membership = response.data?.[0];
      if (!membership) {
        throw new Error('O servidor não confirmou o acesso à equipe.');
      }

      await refreshMemberships(membership.group_id);
      setAccessCode('');
      setTeamName('');
      setMemberPassword('');
      setAdminPassword('');
      setAdminPasswordConfirm('');
      onComplete?.();
    } catch (caught) {
      const message = readableError(caught);
      setError(
        message.includes('Anonymous sign-ins are disabled')
          ? 'O acesso por dispositivo precisa ser ativado no servidor.'
          : message.includes('Equipe não encontrada')
            ? 'Código de equipe inválido ou inativo.'
            : message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={embedded ? 'w-full' : 'mx-auto w-full max-w-md'}
      onSubmit={submit}
      noValidate
    >
      <div className="mb-7 flex items-center justify-between gap-4">
        <span className="taggi-beta-badge inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[.12em]">
          <ShieldCheck className="size-3.5" />
          Versão beta
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          Acesso da operação
        </span>
      </div>

      <h2 className="text-[28px] font-semibold tracking-[-0.04em]">
        Acesse sua operação
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
        Crie uma equipe nova ou conecte este computador a uma equipe existente.
      </p>

      {savedMemberships.length > 0 ? (
        <div className="mt-6 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs text-[var(--text-muted)]">Suas equipes neste computador</p>
          {savedMemberships.map((savedMembership) => (
          <button
            key={savedMembership.groupId}
            type="button"
            className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-[var(--surface-hover)]"
            onClick={() => void resumeSavedAccess(savedMembership.groupId)}
            disabled={busy}
          >
            <span>
              <strong className="block text-sm text-[var(--text-main)]">
                Continuar como {savedMembership.displayName}
              </strong>
              <small className="mt-1 block text-xs text-[var(--text-soft)]">
                {savedMembership.groupName} · sem criar outro funcionário
              </small>
            </span>
            {busy ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin" />
            ) : (
              <LogIn className="size-4 shrink-0 text-[var(--app-accent)]" />
            )}
          </button>
          ))}
          <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
            Criar outra equipe começa uma operação vazia e não apaga as anteriores.
            Para excluir uma equipe, entre nela e abra Administração → Segurança.
          </p>
        </div>
      ) : null}

      <div
        className="mt-6 grid grid-cols-2 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-1"
        role="tablist"
        aria-label="Tipo de acesso"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'create'}
          className="flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition"
          style={{
            background:
              mode === 'create' ? 'var(--surface-hover)' : 'transparent',
            color:
              mode === 'create'
                ? 'var(--text-main)'
                : 'var(--text-muted)',
          }}
          onClick={() => {
            setMode('create');
            setError('');
          }}
        >
          <Plus className="size-4" />
          Criar equipe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'join'}
          className="flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition"
          style={{
            background:
              mode === 'join' ? 'var(--surface-hover)' : 'transparent',
            color:
              mode === 'join' ? 'var(--text-main)' : 'var(--text-muted)',
          }}
          onClick={() => {
            setMode('join');
            setError('');
          }}
        >
          <UsersRound className="size-4" />
          Entrar com código
        </button>
      </div>

      <label className="mt-6 block text-sm text-[var(--text-soft)]">
        Seu nome na equipe
        <span className="taggi-control mt-2 flex h-12 items-center gap-3 rounded-xl border px-3">
          <UserRound className="size-4" aria-hidden="true" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[var(--text-main)] outline-none"
            autoComplete="name"
            placeholder="Ex.: Juan Nunes"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </span>
      </label>

      {mode === 'create' ? (
        <label className="mt-4 block text-sm text-[var(--text-soft)]">
          Nome da equipe ou empresa
          <span className="taggi-control mt-2 flex h-12 items-center gap-3 rounded-xl border px-3">
            <Building2 className="size-4" aria-hidden="true" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[var(--text-main)] outline-none"
              autoComplete="organization"
              placeholder="Ex.: Operação São Paulo"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
            />
          </span>
        </label>
      ) : (
        <div className="mt-4 text-sm text-[var(--text-soft)]">
          <label htmlFor="team-access-code">Código da equipe</label>
          <span className="taggi-control mt-2 flex h-12 items-center gap-3 rounded-xl border px-3">
            <KeyRound className="size-4" aria-hidden="true" />
            <input
              id="team-access-code"
              className="min-w-0 flex-1 bg-transparent text-[var(--text-main)] outline-none"
              type={showAccessCode ? 'text' : 'password'}
              autoComplete="off"
              value={accessCode}
              placeholder="TG-XXXXX"
              maxLength={8}
              onChange={(event) =>
                setAccessCode(normalizeGroupCode(event.target.value))
              }
            />
            <button
              type="button"
              className="taggi-password-toggle"
              aria-label={showAccessCode ? 'Ocultar código' : 'Mostrar código'}
              aria-pressed={showAccessCode}
              onClick={() => setShowAccessCode((visible) => !visible)}
            >
              {showAccessCode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </span>
        </div>
      )}

      <div className="mt-4 text-sm text-[var(--text-soft)]">
        <label htmlFor="member-password">Sua senha pessoal</label>
        <span className="taggi-control mt-2 flex h-12 items-center gap-3 rounded-xl border px-3">
          <KeyRound className="size-4" aria-hidden="true" />
          <input
            id="member-password"
            className="min-w-0 flex-1 bg-transparent text-[var(--text-main)] outline-none"
            type={showMemberPassword ? 'text' : 'password'}
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={memberPassword}
            placeholder="Mínimo de 8 caracteres"
            onChange={(event) => setMemberPassword(event.target.value)}
          />
          <button
            type="button"
            className="taggi-password-toggle"
            aria-label={showMemberPassword ? 'Ocultar senha pessoal' : 'Mostrar senha pessoal'}
            aria-pressed={showMemberPassword}
            onClick={() => setShowMemberPassword((visible) => !visible)}
          >
            {showMemberPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Esta senha permite reconectar o seu usuário à equipe neste computador.
        </p>
      </div>

      {mode === 'create' ? (
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-3">
          <p className="text-sm font-medium text-[var(--text-main)]">
            Senha da Administração
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            Você definirá a senha que libera a área administrativa. Não existe senha padrão.
          </p>
          <span className="taggi-control mt-3 flex h-12 items-center gap-3 rounded-xl border px-3">
            <ShieldCheck className="size-4" aria-hidden="true" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[var(--text-main)] outline-none"
              type={showAdminPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={adminPassword}
              placeholder="Crie a senha da Administração"
              onChange={(event) => setAdminPassword(event.target.value)}
            />
            <button
              type="button"
              className="taggi-password-toggle"
              aria-label={showAdminPassword ? 'Ocultar senha da Administração' : 'Mostrar senha da Administração'}
              aria-pressed={showAdminPassword}
              onClick={() => setShowAdminPassword((visible) => !visible)}
            >
              {showAdminPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </span>
          <span className="taggi-control mt-2 flex h-12 items-center gap-3 rounded-xl border px-3">
            <ShieldCheck className="size-4" aria-hidden="true" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[var(--text-main)] outline-none"
              type={showAdminPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={adminPasswordConfirm}
              placeholder="Confirme a senha da Administração"
              onChange={(event) => setAdminPasswordConfirm(event.target.value)}
            />
          </span>
        </div>
      ) : null}

      {mode === 'create' ? (
        <p className="mt-3 rounded-xl border border-blue-400/20 bg-blue-400/5 px-3 py-2.5 text-xs leading-5 text-[var(--text-soft)]">
          Você entrará como <strong className="text-[var(--text-main)]">Gestor</strong>.
          O Tage gerará um código exclusivo para convidar seus funcionários e usará a senha da Administração criada acima.
        </p>
      ) : null}

      {error || accessNotice ? (
        <p
          className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-400"
          role="alert"
        >
          {error || accessNotice}
        </p>
      ) : null}

      <Button
        type="submit"
        className="taggi-button-primary mt-6 h-12 w-full rounded-xl"
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <LogIn className="size-4" />
        )}
        {busy
          ? mode === 'create'
            ? 'Criando equipe...'
            : 'Entrando...'
          : mode === 'create'
            ? 'Criar equipe e abrir o Tage'
            : 'Entrar no Tage'}
      </Button>
    </form>
  );
}
