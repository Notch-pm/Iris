-- ============================================================================
-- Rollback — profils de droits (lot 1, migrations 20260822100000 à
-- 20260822100800). NE VIT PAS SOUS supabase/migrations/ : ce script n'est
-- PAS une migration à appliquer par défaut, c'est un filet d'urgence à
-- exécuter manuellement (apply_migration en échec volontaire final, ou SQL
-- editor) si le lot doit être abandonné après déploiement.
--
-- Portée : restaure À L'IDENTIQUE le comportement des policies/gardes de
-- requests, de ses satellites et du storage, tels qu'ils étaient AVANT ce
-- lot (donc après 20260820220000_rpc_create_request_from_procedure.sql,
-- la dernière migration de la vague précédente). Restaure is_org_writer et
-- is_org_admin (version rôle). NE TOUCHE PAS :
--   • aux 5 tables de profils (permission_profiles et satellites) ni à
--     permission_audit_log — laissées en place, INERTES (plus aucune
--     policy de requests/satellites/storage ne les consulte après ce
--     rollback) ;
--   • à la colonne requests.socle_scope_org_id — laissée en place, INERTE
--     (calculée par t21/t09 en temps normal, mais ces triggers sont
--     supprimés ci-dessous : la colonne cesse simplement d'être tenue à
--     jour, sans casser quoi que ce soit puisque plus aucune policy ne la
--     lit) ;
--   • aux RPC de M5 (save_permission_profile, etc.) — laissées en place,
--     inertes (plus aucune policy ne consomme leurs effets).
-- Un ré-déploiement ultérieur du lot peut donc repartir de ces objets
-- inertes sans purge préalable.
--
-- Ordre d'exécution : sans importance entre les blocs (chaque bloc est une
-- CREATE OR REPLACE / DROP TRIGGER indépendante), mais présenté dans
-- l'ordre inverse du déploiement (M8 → M7 → M3 → M2/M1) pour lisibilité.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. requests — policies et garde de transition d'origine.
-- ----------------------------------------------------------------------------

-- 1.a is_org_writer — restaurée (dernière version pré-lot, 20260820160000).
create or replace function public.is_org_writer(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
      or public.member_role(p_org_id) in ('administrateur', 'agent');
$$;
revoke execute on function public.is_org_writer(uuid) from public, anon;
grant  execute on function public.is_org_writer(uuid) to authenticated;

-- 1.b is_org_admin — restaurée (dernière version pré-lot, 20260820160000 —
-- fondée sur le rôle organization_members.role, plus sur has_admin_scope).
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or public.member_role(p_org_id) = 'administrateur';
$$;
revoke execute on function public.is_org_admin(uuid) from public, anon;
grant  execute on function public.is_org_admin(uuid) to authenticated;

-- 1.c requests_guard_transition — restaurée (dernière version pré-lot,
-- 20260820160000, gardes par RÔLE plutôt que par droits effectifs).
create or replace function public.requests_guard_transition()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_service boolean := public.is_service_context();
  v_role    text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (
       (old.status = 'a_traiter'      and new.status in ('en_instruction','resolue_negative','annulee'))
    or (old.status = 'en_instruction' and new.status in ('en_attente','resolue_positive','resolue_negative','annulee','a_traiter'))
    or (old.status = 'en_attente'     and new.status in ('en_instruction','annulee'))
    or (old.status in ('annulee','resolue_positive','resolue_negative')
                                      and new.status in ('en_instruction','archivee'))
    or (old.status = 'archivee'       and new.status in ('annulee','resolue_positive','resolue_negative'))
  ) then
    raise exception 'Transition de statut interdite : % → %.', old.status, new.status;
  end if;

  if old.status = 'a_traiter' and new.status = 'en_instruction' and new.assigned_to is null then
    raise exception 'Passage en instruction : un agent assigné est obligatoire.';
  end if;
  if new.status in ('resolue_positive','resolue_negative') and old.status <> 'archivee'
     and (new.closure_text is null or btrim(new.closure_text) = '') then
    raise exception 'Résolution : le texte de clôture destiné à l''usager est obligatoire.';
  end if;
  if old.status = 'a_traiter' and new.status = 'resolue_negative'
     and coalesce(new.closure_motif, '') not in ('irrecevable','doublon','reorientation') then
    raise exception 'Clôture négative sans instruction : motif irrecevable, doublon ou reorientation obligatoire.';
  end if;
  if new.status = 'annulee'
     and coalesce(new.closure_motif, '') not in ('abandon','retrait_usager') then
    raise exception 'Annulation : motif abandon ou retrait_usager obligatoire.';
  end if;

  if not v_service then
    v_role := public.member_role(new.organization_id);
    if old.status in ('annulee','resolue_positive','resolue_negative') and new.status = 'en_instruction'
       and coalesce(v_role, '') <> 'administrateur' and not public.is_platform_admin() then
      raise exception 'Réouverture réservée à l''administrateur.';
    end if;
    if (new.status = 'archivee' or old.status = 'archivee')
       and coalesce(v_role, '') <> 'administrateur' and not public.is_platform_admin() then
      raise exception 'Archivage et désarchivage réservés à l''administrateur.';
    end if;
  end if;

  if new.status in ('annulee','resolue_positive','resolue_negative')
     and old.status in ('a_traiter','en_instruction','en_attente') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  if old.status in ('annulee','resolue_positive','resolue_negative') and new.status = 'en_instruction' then
    new.closed_at := null;
    new.closure_motif := null;
    new.closure_text := null;
    new.master_request_id := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_guard_transition() from public, anon, authenticated;

drop trigger if exists t11_requests_guard_write on public.requests;
drop trigger if exists t11_requests_guard_transition on public.requests;
create trigger t11_requests_guard_transition
  before update on public.requests
  for each row execute function public.requests_guard_transition();

-- 1.d requests_before_insert_guard — restaurée SANS le contrôle RM-16 (M-1,
-- lot profils de droits) : redevient la version d'origine (fondations,
-- 20260820100100), qui ne connaît QUE le statut de naissance.
create or replace function public.requests_before_insert_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_service_context() then
    if new.status <> 'a_traiter' then
      raise exception 'Une demande naît toujours au statut a_traiter (reçu : %).', new.status;
    end if;
  end if;
  new.version := 1;
  return new;
end;
$$;
revoke execute on function public.requests_before_insert_guard() from public, anon, authenticated;

-- 1.e requests_protect_immutable — restaurée à la version pré-lot
-- (20260820190000 : reference/organization_id/socle_root_org_id/source/
-- external_ref/received_at/created_at/requester_snapshot — SANS id, ajoutée
-- par le correctif F-7 du lot profils de droits, et sans la tolérance
-- service-only du correctif C pour socle_scope_org_id/anomalies, colonnes
-- qui n'existaient pas encore à cette date).
create or replace function public.requests_protect_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reference         is distinct from old.reference
     or new.reference_year is distinct from old.reference_year
     or new.reference_seq  is distinct from old.reference_seq
     or new.organization_id   is distinct from old.organization_id
     or new.socle_root_org_id is distinct from old.socle_root_org_id
     or new.source          is distinct from old.source
     or new.external_ref    is distinct from old.external_ref
     or new.received_at     is distinct from old.received_at
     or new.created_at      is distinct from old.created_at
     or new.requester_snapshot is distinct from old.requester_snapshot then
    raise exception 'Colonne immuable : reference, organization_id, socle_root_org_id, source, external_ref, received_at, created_at et requester_snapshot ne changent jamais.';
  end if;

  if old.status = 'archivee' then
    if new.status = 'archivee' then
      raise exception 'Demande archivée : aucune modification possible (désarchiver d''abord).';
    end if;
    if new.subject       is distinct from old.subject
       or new.body       is distinct from old.body
       or new.form_data  is distinct from old.form_data
       or new.procedure_snapshot is distinct from old.procedure_snapshot
       or new.closure_motif is distinct from old.closure_motif
       or new.closure_text  is distinct from old.closure_text
       or new.assigned_to   is distinct from old.assigned_to
       or new.priority      is distinct from old.priority
       or new.anomalies     is distinct from old.anomalies
       or new.socle_organization_id is distinct from old.socle_organization_id
       or new.socle_procedure_id    is distinct from old.socle_procedure_id
       or new.socle_contact_id      is distinct from old.socle_contact_id then
      raise exception 'Désarchivage : seul le statut peut changer.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_protect_immutable() from public, anon, authenticated;

-- 1.f policies requests — restaurées (is_org_member / is_org_writer, plus
-- aucune référence à socle_scope_org_id/my_permission_pairs).
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests
  for insert to authenticated
  with check (public.is_org_writer(organization_id) and source = 'iris');

drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests
  for update to authenticated
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ----------------------------------------------------------------------------
-- 2. Satellites — policies et trigger de périmètre d'origine (20260820100200).
-- ----------------------------------------------------------------------------

drop policy if exists request_events_select on public.request_events;
create policy request_events_select on public.request_events
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists request_assignments_select on public.request_assignments;
create policy request_assignments_select on public.request_assignments
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists request_messages_select on public.request_messages;
create policy request_messages_select on public.request_messages
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists request_messages_insert on public.request_messages;
create policy request_messages_insert on public.request_messages
  for insert to authenticated
  with check (public.is_org_writer(organization_id) and author_id = auth.uid());
drop policy if exists request_messages_update on public.request_messages;
create policy request_messages_update on public.request_messages
  for update to authenticated
  using ((author_id = auth.uid() and public.is_org_writer(organization_id))
         or public.is_org_admin(organization_id))
  with check ((author_id = auth.uid() and public.is_org_writer(organization_id))
              or public.is_org_admin(organization_id));
drop policy if exists request_messages_delete on public.request_messages;
create policy request_messages_delete on public.request_messages
  for delete to authenticated
  using ((author_id = auth.uid() and public.is_org_writer(organization_id))
         or public.is_org_admin(organization_id));

drop policy if exists request_attachments_select on public.request_attachments;
create policy request_attachments_select on public.request_attachments
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists request_attachments_insert on public.request_attachments;
create policy request_attachments_insert on public.request_attachments
  for insert to authenticated
  with check (public.is_org_writer(organization_id) and uploaded_by = auth.uid());
drop policy if exists request_attachments_delete on public.request_attachments;
create policy request_attachments_delete on public.request_attachments
  for delete to authenticated using (public.is_org_admin(organization_id));

drop policy if exists request_links_select on public.request_links;
create policy request_links_select on public.request_links
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists request_links_insert on public.request_links;
create policy request_links_insert on public.request_links
  for insert to authenticated with check (public.is_org_writer(organization_id));
drop policy if exists request_links_delete on public.request_links;
create policy request_links_delete on public.request_links
  for delete to authenticated using (public.is_org_admin(organization_id));

-- request_links_check_scope — restaurée SANS l'extension RM-17 (cible
-- lisible par l'auteur) : redevient la version d'origine, tenant seulement.
create or replace function public.request_links_check_scope()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_org uuid;
begin
  select r.organization_id into v_org from public.requests r where r.id = new.request_id;
  if v_org is null or v_org is distinct from new.organization_id then
    raise exception 'Lien : demande source introuvable ou hors tenant.';
  end if;
  if new.target_request_id is not null then
    select r.organization_id into v_org from public.requests r where r.id = new.target_request_id;
    if v_org is null or v_org is distinct from new.organization_id then
      raise exception 'Lien : demande cible introuvable ou hors tenant.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.request_links_check_scope() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Storage — policies d'origine (20260820100300).
-- ----------------------------------------------------------------------------

drop policy if exists "request_attachments_storage_select" on storage.objects;
create policy "request_attachments_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "request_attachments_storage_insert" on storage.objects;
create policy "request_attachments_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'request-attachments'
    and public.is_org_writer(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "request_attachments_storage_delete" on storage.objects;
create policy "request_attachments_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'request-attachments'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

-- ----------------------------------------------------------------------------
-- 4. Retrait des triggers propres au lot profils de droits (M3/M4/M7) sur
-- des tables PRÉ-EXISTANTES (requests, organization_members) — leurs
-- fonctions sous-jacentes (requests_set_scope_org, member_role_derived,
-- organization_members_force_role, refresh_member_roles,
-- organization_members_protect_last_admin…) restent en place, INERTES
-- (aucun trigger ne les appelle plus), pour un ré-déploiement sans perte.
-- ----------------------------------------------------------------------------
drop trigger if exists t21_requests_set_scope_org on public.requests;
drop trigger if exists t09_requests_set_scope_org on public.requests;
drop trigger if exists t05_organization_members_protect_last_admin on public.organization_members;
drop trigger if exists t95_permission_profiles_refresh_roles on public.permission_profiles;
drop trigger if exists t95_permission_profile_assignments_refresh_roles on public.permission_profile_assignments;
drop trigger if exists t01_organization_members_role_derived on public.organization_members;

-- organization_members.role redevient une colonne ORDINAIRE, éditable par
-- un client (policy organization_members_update, inchangée depuis les
-- fondations, gouverne déjà qui peut l'écrire — is_org_admin, restaurée en
-- version rôle au bloc 1.b ci-dessus).

-- ----------------------------------------------------------------------------
-- 5. Tables et RPC du lot profils de droits — VOLONTAIREMENT CONSERVÉES,
-- inertes (voir en-tête). Rien à faire ici.
-- ----------------------------------------------------------------------------
