-- Ménage de la plomberie pg_cron / pg_net.
--
-- Constat du 2026-09-23 : `cron.job_run_details` pesait 54 Mo pour 63 142 lignes
-- (73 % d'une base de 74 Mo), jamais purgée depuis le 2026-08-21. Deux jobs à la
-- minute (`notifications-mailer`, `notifications-push`) + `attachments-maintenance`
-- (10 min) y écrivent ~3 000 lignes/jour. Supabase ne purge pas cette table.
--
-- `net._http_response` est bornée en lignes par le TTL natif de pg_net (6 h), mais
-- l'espace libéré n'est rendu que par un VACUUM : c'est ce qui a fait monter Clara à
-- 82 Mo de tas pour 252 lignes (incident du 2026-09-22). `ALTER TABLE … SET
-- (autovacuum_*)` est refusé (le schéma `net` appartient à `supabase_admin`), d'où le
-- VACUUM planifié explicite.
--
-- Même paire de jobs que Clara (docs/deployment.md de Clara, lot du 2026-09-22).
-- Rejouable : `cron.schedule` sur un nom existant met à jour la commande.

select cron.schedule(
  'purge-cron-history',
  '15 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '7 days' $job$
);

select cron.schedule(
  'vacuum-net-http-response',
  '45 3 * * *',
  $job$ vacuum (analyze) net._http_response $job$
);
