-- ============================================================================
-- Rétention des journaux techniques — décision PO du 2026-09-23 (audit purge /
-- performance de la gamme, avant mise en production).
--
--   • notifications        : 90 jours, seulement celles dont tous les canaux
--     sont réglés (e-mail et push en sent / skipped / failed) ET qui ne sont
--     plus attendues dans la cloche (lues, ou jamais affichées : in_app = false).
--     Une notification non lue reste indéfiniment.
--   • integration_api_logs : 180 jours (enquête sur un incident partenaire).
--     Table immuable (t01_integration_api_logs_immutable) : la garde est levée
--     LE TEMPS du DELETE, dans la même transaction — geste conscient, motif
--     déjà employé par les migrations e2e_cleanup_*. Le verrou d'ALTER TABLE
--     n'est pris que s'il y a quelque chose à purger.
--   • storage_deletions    : 30 jours après done_at (l'objet est déjà retiré
--     du bucket ; la ligne n'est plus qu'une trace).
--
-- Hors périmètre : request_events / request_assignments / request_emails /
-- permission_audit_log sont des journaux légaux, rattachés à la purge RGPD
-- (phase 5, docs/data-model.md).
--
-- Cron SQL local (pas de pg_net) : n'ajoute rien à net._http_response.
-- ============================================================================

create or replace function public.purge_retention_journaux()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_notifications int := 0;
  v_api_logs      int := 0;
  v_deletions     int := 0;
begin
  delete from public.notifications
   where created_at < now() - interval '90 days'
     and email_status in ('sent', 'skipped', 'failed')
     and push_status  in ('sent', 'skipped', 'failed')
     and (read_at is not null or not in_app);
  get diagnostics v_notifications = row_count;

  if exists (select 1 from public.integration_api_logs
              where created_at < now() - interval '180 days') then
    alter table public.integration_api_logs disable trigger t01_integration_api_logs_immutable;
    delete from public.integration_api_logs
     where created_at < now() - interval '180 days';
    get diagnostics v_api_logs = row_count;
    alter table public.integration_api_logs enable trigger t01_integration_api_logs_immutable;
  end if;

  delete from public.storage_deletions
   where done_at < now() - interval '30 days';
  get diagnostics v_deletions = row_count;

  return jsonb_build_object(
    'ran_at', now(),
    'notifications', v_notifications,
    'integration_api_logs', v_api_logs,
    'storage_deletions', v_deletions
  );
end;
$$;
revoke execute on function public.purge_retention_journaux() from public, anon, authenticated;

select cron.schedule(
  'purge-retention-journaux',
  '30 3 * * *',
  $job$ select public.purge_retention_journaux(); $job$
);
