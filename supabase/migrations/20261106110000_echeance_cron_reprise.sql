-- ============================================================================
-- B16 — reprise des échéances et passage quotidien des alertes.
--
-- À appliquer APRÈS le redéploiement de `sync-socle-referentiel` et une
-- synchronisation : le calcul lit les délais du cache des démarches.
--
-- 1. Recalcul de TOUTES les demandes (les valeurs posées à la main des jeux de
--    démonstration comprises) par la même règle que t22. Le trigger
--    d'immuabilité est coupé le temps de l'UPDATE — c'est la seule écriture de
--    `due_at` qui ne passe pas par l'insertion — et `requests_touch` aussi, pour
--    ne pas faire passer 232 demandes pour « modifiées aujourd'hui ».
-- 2. Les alertes que le premier passage enverrait d'un coup pour des demandes
--    DÉJÀ en retard ou urgentes au moment de la reprise (139 + 1 le 2026-11-06,
--    jeux de démonstration, destinataires réels) sont marquées comme émises :
--    seules les échéances qui approchent ou passent APRÈS la reprise alertent.
--    Pour forcer une alerte : supprimer sa ligne de `request_deadline_alerts`.
-- 3. Passage quotidien à 05:00 UTC (06:00 / 07:00 à Paris).
-- ============================================================================

alter table public.requests disable trigger t10_requests_protect_immutable;
alter table public.requests disable trigger t19_requests_touch;

update public.requests q
   set due_at = public.request_due_at(
         q.received_at,
         (select c.processing_time_value from public.socle_procedure_cache c
           where c.socle_id = q.socle_procedure_id and c.organization_id = q.organization_id),
         (select c.processing_time_unit from public.socle_procedure_cache c
           where c.socle_id = q.socle_procedure_id and c.organization_id = q.organization_id),
         (select o.default_due_days from public.organizations o where o.id = q.organization_id));

alter table public.requests enable trigger t19_requests_touch;
alter table public.requests enable trigger t10_requests_protect_immutable;

insert into public.request_deadline_alerts (request_id, kind)
select q.id,
       case when (q.due_at at time zone 'Europe/Paris')::date < (now() at time zone 'Europe/Paris')::date
            then 'deadline_overdue' else 'deadline_soon' end
  from public.requests q
 where q.status in ('a_traiter', 'en_instruction', 'en_attente')
   and (q.due_at at time zone 'Europe/Paris')::date <= (now() at time zone 'Europe/Paris')::date + 3
on conflict do nothing;

select cron.schedule(
  'notify-request-deadlines',
  '0 5 * * *',
  $job$ select public.notify_request_deadlines(); $job$
);
