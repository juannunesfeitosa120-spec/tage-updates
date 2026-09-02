'use client';

import { type FormEvent, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { readableError } from '@/lib/taggi';

type TeamDeletionPanelProps = {
  groupId: string;
  groupName: string;
  adminSession: { id: string; token: string } | null;
  onDeleted: () => Promise<void>;
};

export function TeamDeletionPanel({
  groupId,
  groupName,
  adminSession,
  onDeleted,
}: TeamDeletionPanelProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    setConfirmation('');
    setPassword('');
    setError('');
  }

  async function deleteTeam(event: FormEvent) {
    event.preventDefault();
    if (busy || !supabase || !adminSession) return;
    if (confirmation.trim() !== groupName || !password) return;
    setBusy(true);
    setError('');
    try {
      const response = await supabase.rpc('taggi_delete_team', {
        p_group_id: groupId,
        p_session_id: adminSession.id,
        p_session_token: adminSession.token,
        p_admin_password: password,
        p_confirmation_name: confirmation.trim(),
      });
      if (response.error) throw response.error;
      if (response.data?.deleted_group_id !== groupId) {
        throw new Error('O servidor não confirmou a exclusão da equipe.');
      }
      setPassword('');
      await onDeleted();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 border-t border-red-500/20 pt-6">
      <h3 className="font-semibold">Excluir esta equipe</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-soft)]">
        Apaga a equipe e seus funcionários, plataformas, contagens, histórico,
        conversas e insumos para todos os computadores. Os anexos entram na
        limpeza automática. Seus outros grupos e seu perfil são preservados.
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-4 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
        disabled={!adminSession}
        onClick={() => changeOpen(true)}
      >
        <Trash2 className="size-4" />
        Excluir equipe
      </Button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="taggi-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Excluir “{groupName}” definitivamente?</DialogTitle>
            <DialogDescription>
              Todos perderão acesso a esta equipe. Esta ação não pode ser desfeita
              pelo aplicativo. Para recomeçar, você poderá criar outra equipe vazia.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={deleteTeam}>
            <div>
              <label htmlFor="delete-team-name" className="text-sm text-[var(--text-soft)]">
                Digite o nome da equipe: <strong>{groupName}</strong>
              </label>
              <Input
                id="delete-team-name"
                className="taggi-control mt-2"
                autoComplete="off"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="delete-team-password" className="text-sm text-[var(--text-soft)]">
                Confirme a senha da Administração
              </label>
              <Input
                id="delete-team-password"
                type="password"
                className="taggi-control mt-2"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-red-600 text-white hover:bg-red-500"
                disabled={busy || !adminSession || confirmation.trim() !== groupName || !password}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {busy ? 'Excluindo…' : 'Excluir definitivamente'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
