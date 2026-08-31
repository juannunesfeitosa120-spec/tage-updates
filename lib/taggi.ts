export type TaggiRole = 'employee' | 'administrative' | 'manager';

export type TaggiMembership = {
  groupId: string;
  groupCode: string;
  groupName: string;
  displayName: string;
  role: TaggiRole;
  lastSeenAt: string;
  tutorialCompletedAt: string | null;
  tutorialSkipped: boolean;
  chatRetentionNoticeSeen: boolean;
  adminPasswordConfigured: boolean;
};

export const roleLabels: Record<TaggiRole, string> = {
  employee: 'Funcionário',
  administrative: 'Administrativo',
  manager: 'Gestor',
};

export const roleLevel: Record<TaggiRole, number> = {
  employee: 1,
  administrative: 2,
  manager: 3,
};

export function normalizeGroupCode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^TG/, '');
  return compact.length ? `TG-${compact.slice(0, 5)}` : '';
}

export function readableError(error: unknown, fallback = 'Não foi possível concluir esta ação.') {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : fallback;

  if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (message.includes('Email not confirmed')) return 'Confirme o seu e-mail antes de entrar.';
  if (message.includes('User already registered')) return 'Este e-mail já possui uma conta. Use “Entrar”.';
  if (message.includes('Password should be')) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (message.includes('rate limit')) return 'Muitas tentativas seguidas. Aguarde um pouco e tente novamente.';
  if (message.includes('Failed to fetch')) return 'Sem conexão com o servidor. Verifique a internet.';
  return message || fallback;
}
