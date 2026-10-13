-- Apply only after the Edge functions have deployed. Provision these two
-- secrets using Supabase Vault's dashboard first (never commit their values):
-- study_market_cron_url: https://<project>.supabase.co/functions/v1/study-market-cron
-- study_market_cron_secret: exactly STUDY_MARKET_CRON_SECRET, random >=32 chars.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='study_market_cron_url' and decrypted_secret ~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/study-market-cron$')
     or not exists(select 1 from vault.decrypted_secrets where name='study_market_cron_secret' and length(decrypted_secret)>=32) then
    raise exception 'Configure study market Vault URL and cron secret before scheduling';
  end if;
end $$;
select cron.schedule('study-market-maintenance','*/5 * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='study_market_cron_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='study_market_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
-- Reapplying replaces this named job. Monitor cron.job_run_details plus the
-- returned HTTP status in net._http_response; a scheduled request is not proof
-- of a successful financial reconciliation. HTTP response bodies contain no PII.
