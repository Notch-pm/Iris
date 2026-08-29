-- ============================================================================
-- Plafond d'utilisation IA — balayage des réservations orphelines.
--
-- ⚠️ CE JOB N'A BESOIN D'AUCUN SECRET. Les deux autres jobs du projet
-- (20260820180000 sync Socle, 20260824110000 facteur des notifications) font
-- un `net.http_post` vers une edge function et lisent `cron_secret_iris` dans
-- le Vault. Celui-ci est du SQL PUR : il appelle une fonction locale. Inutile
-- d'aller chercher un secret, il n'y en a pas.
--
-- Toutes les 5 minutes, une réservation de plus de 15 minutes est soldée en
-- `timeout` : la réservation est libérée, `used_tokens` n'est jamais touché.
-- C'est le filet du cas « l'edge function est morte entre reserve et settle »
-- (déploiement en cours, timeout de plateforme). Sans lui, la réservation
-- rognerait le plafond jusqu'à la fin du mois.
--
-- Rejouable : le `unschedule` conditionnel précède la planification.
-- ============================================================================
create extension if not exists pg_cron;

select cron.unschedule('release-stale-ai-reservations')
 where exists (select 1 from cron.job where jobname = 'release-stale-ai-reservations');

select cron.schedule(
  'release-stale-ai-reservations',
  '*/5 * * * *',
  $job$ select public.release_stale_ai_reservations(15); $job$
);
