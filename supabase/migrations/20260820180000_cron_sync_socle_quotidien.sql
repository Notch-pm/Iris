-- ============================================================================
-- Planification quotidienne de la sync du référentiel Socle (04h00 UTC).
-- Le secret est lu DANS LE COFFRE (vault, entrée « cron_secret_iris ») au
-- moment de l'exécution — jamais stocké dans une migration. Tant que l'entrée
-- Vault n'existe pas, l'appel part sans secret et la fonction répond 401
-- (sans effet) : le job est inoffensif à vide.
-- Pose du secret (une fois, SQL editor du dashboard — jamais versionné) :
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret_iris');
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('sync-socle-referentiel')
 where exists (select 1 from cron.job where jobname = 'sync-socle-referentiel');

select cron.schedule(
  'sync-socle-referentiel',
  '0 4 * * *',
  $job$
  select net.http_post(
    url := 'https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/sync-socle-referentiel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_iris'), '')
    ),
    body := '{}'::jsonb
  );
  $job$
);
