-- ============================================================================
-- Transfert d'une demande vers un autre ORGANISME RESPONSABLE (décision PO
-- 2026-09-01). Le geste existait déjà en creux — RM-19 autorise depuis les
-- profils de droits le changement de `socle_organization_id`, et la cible peut
-- légitimement être HORS du périmètre de l'auteur : se dessaisir, c'est
-- justement confier à quelqu'un d'autre. Cette migration en fait un geste
-- COMPLET, avec ses quatre conséquences, toutes portées par le serveur :
--
--   1. Le LIBELLÉ suit l'identifiant, et vient du miroir — jamais du
--      navigateur (`requests_apply_transfer`, t08).
--   2. L'AFFECTATION ne survit pas au transfert quand l'agent affecté ne peut
--      pas instruire la demande là où elle arrive (RM-16 sur le couple retenu).
--      On la retire, on ne refuse pas le transfert.
--   3. L'organisme cible doit AVOIR LA DÉMARCHE ACTIVÉE
--      (`requests_transfer_procedure_active`, t12) — extension à l'UPDATE de la
--      règle « masque ET refuse » posée par t18 sur l'INSERT le 2026-08-31.
--   4. L'organisme cible est PRÉVENU : journal (`transferred`) et notification
--      `transferred_in` aux agents qui détiennent l'instruction sur le couple
--      d'arrivée — même moteur de fan-out que `new_request_in_scope`.
--
-- ⚠️ Le DROIT de transférer n'est pas touché : il reste celui de
-- `requests_guard_write` (instruction sur le couple ACTUEL, via `v_edited`, +
-- appartenance de la cible au sous-arbre Socle du tenant). Un agent sans aucun
-- droit dans l'organisme cible transfère donc parfaitement — et perd la
-- demande de vue juste après. C'est le geste, pas un effet de bord.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. t08_requests_apply_transfer — les EFFETS serveur du transfert.
--
-- BEFORE UPDATE, nommé t08 pour passer AVANT t09 (scope), t10 (immuabilité) et
-- t11 (gardes) : ce que cette fonction pose doit être vu par les gardes, et
-- non l'inverse. DEFINER — elle lit le miroir des organisations et le moteur
-- de droits hors RLS.
--
-- ⚠️ Aucun `is_service_context()` ici : la fonction est DEFINER, où ce test
-- vaut TOUJOURS vrai (piège vérifié le 2026-08-22, cf. CLAUDE.md). Ce n'est
-- pas une perte — la règle vaut pour tout le monde, y compris l'ingestion :
-- un libellé qui ment et un affectataire sans droit n'ont de sens dans aucun
-- contexte.
-- ----------------------------------------------------------------------------
create or replace function public.requests_apply_transfer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_label text;
begin
  if new.socle_organization_id is not distinct from old.socle_organization_id then
    return new;
  end if;

  -- Le libellé est un CACHE d'affichage : il se relit dans le miroir, il ne se
  -- soumet pas. Sans cela, un client pourrait transférer à la Voirie en
  -- écrivant « CCAS » dans le libellé, et toute la lecture humaine (liste,
  -- tableau, e-mails de notification) mentirait de concert. Le miroir muet
  -- (organisation inconnue) laisse la valeur soumise : t11 refuse déjà ce
  -- transfert-là côté client, et l'ingestion garde sa latitude.
  if new.socle_organization_id is not null then
    select m.name into v_label
      from public.socle_organizations m
     where m.organization_id = new.organization_id
       and m.socle_id = new.socle_organization_id
       and m.obsoleted_at is null;
    new.socle_organization_label := coalesce(v_label, new.socle_organization_label);
  end if;

  -- RM-16 dit que l'affectataire doit détenir l'instruction sur le couple
  -- RETENU. Au transfert, deux lectures étaient possibles : refuser le
  -- transfert, ou retirer l'affectation. La seconde a été retenue (décision PO
  -- 2026-09-01) — le service qui se dessaisit n'a pas à connaître les droits
  -- de l'agent qu'il quitte, et une demande sans affectataire est un état
  -- normal du workflow, alors qu'un transfert refusé est une impasse.
  -- ⚠️ `request_right_for` et NON `can_process_request_for` : cette dernière,
  -- créée par la migration des notifications, a été généralisée depuis (un
  -- droit en paramètre) et n'existe plus sous ce nom en base. Le miroir de
  -- migration du dépôt est resté en arrière sur ce point — vérifié dans le
  -- catalogue live le 2026-09-01, après qu'un trigger l'appelant a échoué.
  if new.assigned_to is not null
     and not public.request_right_for(
           new.assigned_to, new.organization_id,
           new.socle_organization_id, new.socle_procedure_id, 'instruction') then
    new.assigned_to := null;
  end if;

  return new;
end;
$$;
comment on function public.requests_apply_transfer() is
  'Effets serveur d''un transfert d''organisme : libellé relu dans le miroir (jamais soumis), affectation retirée si l''agent ne peut pas instruire le couple d''arrivée (RM-16). Interne, aucune EXECUTE cliente.';
revoke execute on function public.requests_apply_transfer() from public, anon, authenticated;

drop trigger if exists t08_requests_apply_transfer on public.requests;
create trigger t08_requests_apply_transfer
  before update on public.requests
  for each row execute function public.requests_apply_transfer();

-- ----------------------------------------------------------------------------
-- 1bis. Reprise — les demandes déjà transférées portent un libellé FAUX.
--
-- Entre la livraison de l'écran et celle de cette migration, un transfert
-- écrivait l'identifiant sans que rien ne réécrive le libellé (le navigateur
-- n'envoie que l'identifiant, par construction). Ces demandes sont donc à la
-- bonne organisation et affichées sous l'ancienne, partout où un agent les lit
-- — liste, tableau, fiche, kanban. Constaté sur DEM-2026-000033 le 2026-09-01.
--
-- ⚠️ Les demandes ARCHIVÉES sont exclues : `t10_requests_protect_immutable` les
-- gèle, et sa seule dérogation de service ne couvre que `socle_scope_org_id` /
-- `anomalies`. Une archivée au libellé faux se corrigera au désarchivage — le
-- cas est théorique (on n'archive pas une demande qu'on vient de transférer) et
-- ne vaut pas d'élargir un gel.
-- Colonne d'AFFICHAGE seulement : aucun identifiant ne bouge, donc ni journal
-- ni notification (`t30`/`t40` ne regardent que le changement d'organisation).
-- ----------------------------------------------------------------------------
update public.requests r
   set socle_organization_label = m.name
  from public.socle_organizations m
 where m.organization_id = r.organization_id
   and m.socle_id = r.socle_organization_id
   and m.obsoleted_at is null
   and r.status <> 'archivee'
   and r.socle_organization_label is distinct from m.name;

-- ----------------------------------------------------------------------------
-- 2. t12_requests_transfer_procedure_active — l'activation MASQUE ET REFUSE,
--    au transfert comme au dépôt.
--
-- t18 ne garde que l'INSERT, et c'est voulu : une démarche désactivée après
-- coup ne doit pas geler les demandes déjà déposées. Mais un TRANSFERT est un
-- dépôt d'un autre nom — il choisit un organisme aujourd'hui. « Cet organisme
-- ne l'assure pas » vaut donc exactement comme à la création, service_role
-- compris.
--
-- Deux échappatoires assumées, symétriques de t18 : une demande HISTORIQUE
-- sans démarche (`socle_procedure_id` nul) n'a aucune activation à vérifier,
-- et une demande sans organisme désigné retombe sur la racine du tenant.
-- ----------------------------------------------------------------------------
create or replace function public.requests_transfer_procedure_active()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if new.socle_organization_id is not distinct from old.socle_organization_id then
    return new;
  end if;
  if new.socle_procedure_id is null then
    return new;  -- demande antérieure à l'obligation de démarche
  end if;
  v_org := coalesce(new.socle_organization_id, new.socle_root_org_id);
  if v_org is null then
    return new;
  end if;
  if not exists (
    select 1
      from public.socle_procedure_organizations
     where organization_id    = new.organization_id
       and socle_procedure_id = new.socle_procedure_id
       and socle_org_id       = v_org
       and obsoleted_at is null
  ) then
    raise exception 'Transfert : cette démarche n''est pas activée pour l''organisme cible dans le référentiel Socle.';
  end if;
  return new;
end;
$$;
comment on function public.requests_transfer_procedure_active() is
  'Refuse un transfert vers un organisme qui n''assure pas la démarche (miroir socle_procedure_organizations). Jumeau UPDATE de t18. Interne, aucune EXECUTE cliente.';
revoke execute on function public.requests_transfer_procedure_active() from public, anon, authenticated;

drop trigger if exists t12_requests_transfer_procedure_active on public.requests;
create trigger t12_requests_transfer_procedure_active
  before update on public.requests
  for each row execute function public.requests_transfer_procedure_active();

-- ----------------------------------------------------------------------------
-- 3. Journal — `transferred`.
--
-- L'événement porte les DEUX libellés en plus des identifiants : le journal est
-- immuable et doit rester lisible quand une organisation est renommée ou sort
-- du référentiel. `unassigned` dit si le transfert a emporté l'affectation —
-- l'événement `assigned` (to = null) posé juste après le dit aussi, mais depuis
-- l'autre bout : ici c'est la CAUSE, là c'est la conséquence.
-- ----------------------------------------------------------------------------
create or replace function public.requests_log_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status,
                               'motif', new.closure_motif, 'version', new.version),
            auth.uid());
  end if;
  if new.socle_organization_id is distinct from old.socle_organization_id then
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'transferred',
            jsonb_build_object(
              'from', old.socle_organization_id, 'to', new.socle_organization_id,
              'from_label', old.socle_organization_label,
              'to_label', new.socle_organization_label,
              'unassigned', old.assigned_to is not null and new.assigned_to is null),
            auth.uid());
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.request_assignments (organization_id, request_id, assigned_to, assigned_by)
    values (new.organization_id, new.id, new.assigned_to, auth.uid());
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'assigned',
            jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to), auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_log_update() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Notification `transferred_in` — l'organisme cible apprend qu'il hérite.
--
-- « Vers l'organisme cible » se lit ici comme « vers les agents qui
-- l'instruisent » : Iris ne miroite AUCUNE adresse e-mail d'organisation (le
-- miroir Socle porte id, parent, nom, statut — rien d'autre), et le droit par
-- couple (organisation, démarche) est précisément ce qui désigne les bonnes
-- personnes. Même fan-out que `new_request_in_scope`, même respect des
-- préférences, même boîte d'envoi drainée par `notifications-mailer`.
-- ----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned','unassigned','status_changed','note_added',
                  'new_request_in_scope','mentioned','transferred_in'));

alter table public.notification_preferences drop constraint if exists notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('*','assigned','unassigned','status_changed','note_added',
                  'new_request_in_scope','mentioned','transferred_in'));

create or replace function public.requests_notify_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Le transfert est INDÉPENDANT de la chaîne affectation/statut ci-dessous :
  -- il peut emporter l'affectation (l'ancien affectataire reçoit alors
  -- « unassigned ») sans que cela retire quoi que ce soit à l'organisme
  -- d'arrivée, qui doit apprendre l'arrivée du dossier dans tous les cas.
  if new.socle_organization_id is distinct from old.socle_organization_id then
    insert into public.notifications (organization_id, user_id, request_id, kind, actor_id,
                                      payload, in_app, email_status)
    select new.organization_id, m.user_id, new.id, 'transferred_in', v_actor,
           jsonb_build_object(
             'reference', new.reference, 'subject', new.subject,
             'actor_name', public.user_display_name(v_actor),
             'status', new.status,
             'procedure', new.socle_procedure_label,
             'destinataire', new.socle_organization_label,
             'from_destinataire', old.socle_organization_label,
             'received_at', new.received_at),
           ch.use_in_app,
           case when ch.use_email then 'pending' else 'skipped' end
      from public.organization_members m
      cross join lateral public.notification_channels_for(m.user_id, 'transferred_in') ch
     where m.organization_id = new.organization_id
       and m.user_id is distinct from v_actor
       and (ch.use_in_app or ch.use_email)
       and public.request_right_for(
             m.user_id, new.organization_id, new.socle_organization_id,
             new.socle_procedure_id, 'instruction');
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform public.push_notification(
      new.assigned_to, v_actor, new.organization_id, new.id, 'assigned',
      new.reference, new.subject, jsonb_build_object('status', new.status));
    perform public.push_notification(
      old.assigned_to, v_actor, new.organization_id, new.id, 'unassigned',
      new.reference, new.subject,
      jsonb_build_object('status', new.status, 'reassigned', new.assigned_to is not null));
  elsif new.status is distinct from old.status then
    perform public.push_notification(
      new.assigned_to, v_actor, new.organization_id, new.id, 'status_changed',
      new.reference, new.subject,
      jsonb_build_object('from', old.status, 'to', new.status, 'motif', new.closure_motif));
  end if;
  return null;
end;
$$;
revoke execute on function public.requests_notify_update() from public, anon, authenticated;
