-- Every-minute queue worker for recruitflow, run by Supabase (free) instead of Vercel Cron
-- (Vercel Hobby only allows one run per day).
--
-- Run once in Supabase → SQL Editor, after replacing the two placeholders:
--   <APP_URL>      your deployed app, e.g. https://recruitflow-2cvt.vercel.app
--   <CRON_SECRET>  the same value as the CRON_SECRET environment variable in Vercel
--
-- The secret is kept in Supabase Vault (encrypted), not in the job definition.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET>', 'recruitflow_cron_secret');

select cron.schedule(
  'recruitflow-worker',
  '* * * * *',
  $$
  select net.http_get(
    url := '<APP_URL>/api/cron',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'recruitflow_cron_secret')
    ),
    timeout_milliseconds := 5000
  );
  $$
);

-- Check it's running (status 202 = the worker started):
--   select status_code, created from net._http_response order by created desc limit 5;
-- Pause / remove:
--   select cron.unschedule('recruitflow-worker');
-- Change the secret later:
--   select vault.update_secret((select id from vault.secrets where name = 'recruitflow_cron_secret'), '<NEW_SECRET>');
