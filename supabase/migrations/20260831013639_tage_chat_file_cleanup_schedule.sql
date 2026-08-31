-- Projeto Supabase Tage: remove do Storage os anexos enfileirados quando as
-- mensagens do dia anterior são apagadas.
select cron.schedule(
  'taggi-chat-file-cleanup-every-15-minutes',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := 'https://mndlnamnfukknqhswkiu.supabase.co/functions/v1/taggi-chat-retention',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-taggi-retention-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'taggi_chat_retention_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $cron$
);
