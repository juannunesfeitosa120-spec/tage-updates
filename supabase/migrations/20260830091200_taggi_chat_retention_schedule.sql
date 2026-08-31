-- A limpeza dos registros é feita no próprio banco. O agendamento da Edge
-- Function de anexos é configurado somente depois do deploy, usando a URL do
-- projeto atual e um segredo do Vault.

create extension if not exists pg_net with schema extensions;
