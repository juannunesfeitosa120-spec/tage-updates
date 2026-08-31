'use client';

import { type SyntheticEvent, useState } from 'react';
import { KeyRound, LoaderCircle, LogIn, ShieldCheck, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { readableError } from '@/lib/taggi';
import { useAuth } from '@/providers/auth-provider';

type AccessPanelProps = {
  embedded?: boolean;
  onComplete?: () => void;
};

export function AccessPanel({
  embedded = false,
  onComplete,
}: AccessPanelProps) {
  const {
    configured,
    session,
    refreshMemberships,
    accessNotice,
    clearAccessNotice,
  } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('operacao');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
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
    if (!password) {
      setError('Informe a senha da equipe.');
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

      const response = await supabase.rpc('taggi_join_default_team', {
        p_display_name: displayName.trim(),
        p_password: password,
      });
      if (response.error) throw response.error;
      const membership = response.data?.[0];
      if (!membership) {
        throw new Error('O servidor não confirmou o acesso à equipe.');
      }

      await refreshMemberships(membership.group_id);
      onComplete?.();
    } catch (caught) {
      const message = readableError(caught);
      setError(
        message.includes('Anonymous sign-ins are disabled')
          ? 'O acesso por dispositivo precisa ser ativado no servidor.'
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
        <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[.12em] text-blue-300">
          <ShieldCheck className="size-3.5" />
          Versão beta
        </span>
        <span className="text-xs text-[var(--text-muted)]">Acesso da operação</span>
      </div>

      <h2 className="text-[28px] font-semibold tracking-[-0.04em]">
        Entre na sua equipe
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
        Use o nome que aparecerá no Histórico, Chat e lançamentos.
      </p>

      <label className="mt-7 block text-sm text-[var(--text-soft)]">
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

      <label className="mt-4 block text-sm text-[var(--text-soft)]">
        Senha
        <span className="taggi-control mt-2 flex h-12 items-center gap-3 rounded-xl border px-3">
          <KeyRound className="size-4" aria-hidden="true" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[var(--text-main)] outline-none"
            type="password"
            autoComplete="current-password"
            aria-describedby="team-password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </span>
      </label>
      <p id="team-password-hint" className="mt-2 text-xs text-[var(--text-muted)]">
        A senha padrão da operação já está preenchida.
      </p>

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
        {busy ? 'Entrando...' : 'Entrar no Tage'}
      </Button>
    </form>
  );
}
