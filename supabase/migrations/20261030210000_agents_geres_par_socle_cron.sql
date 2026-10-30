-- ============================================================================
-- Agents gérés par le Socle — planification de `sync-socle-users`.
-- ⚠️ À appliquer APRÈS le déploiement de la fonction et un premier passage à
-- blanc (`dry_run`) puis réel.
--   - chaque minute : lecture incrémentale (un accès ouvert ou retiré dans le
--     Socle prend effet en moins de deux minutes) ;
--   - chaque nuit (04:20 UTC, après la synchro du référentiel de 04:00) :
--     lecture complète (rattrape les suppressions en cascade côté Socle).
-- Secret lu dans le coffre (`cron_secret_iris`), comme `sync-socle-referentiel`.
-- ============================================================================
select cron.unschedule(jobname) from cron.job
 where jobname in ('sync-socle-users-every-minute', 'sync-socle-users-nightly');

select cron.schedule(
  'sync-socle-users-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/sync-socle-users',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_iris'), '')
    ),
    body := '{"mode":"incremental"}'::jsonb
  );
  $job$
);

select cron.schedule(
  'sync-socle-users-nightly',
  '20 4 * * *',
  $job$
  select net.http_post(
    url := 'https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/sync-socle-users',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_iris'), '')
    ),
    body := '{"mode":"full"}'::jsonb
  );
  $job$
);
