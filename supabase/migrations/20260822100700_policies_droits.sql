-- ============================================================================
-- Profils de droits — M8/9 : BASCULE des policies vers les droits effectifs.
-- Réf : spec-profils-droits.md §3.B, §3.D, RM-58 à RM-61 ·
-- architecture-profils-droits.md ADR-04 à ADR-08 + correctifs D, E, F, G, O.
-- IMPÉRATIF D'ORDRE : M6 (reprise) DOIT avoir tourné avant cette migration —
-- sans profils attribués, la bascule prive tout le monde de droits. Aucune
-- inversion possible avec l'ordre de dépôt des fichiers (M1 → M9).
-- ============================================================================

-- ============================================================================
-- 1. requests_guard_write — fusion de l'ancienne requests_guard_transition et
--    des nouveaux contrôles d'édition (ADR-07). Porte unique : évite un ordre
--    de trigger fragile entre garde de transition et garde d'édition. Le
--    contournement is_service_context() est conservé intégralement.
-- ============================================================================
create or replace function public.requests_guard_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_service boolean := public.is_service_context();
  v_uid     uuid    := auth.uid();
  v_edited  boolean;
begin
  if not v_service then
    -- Correctif E-1 (revue de sécurité, 2026-08-22) : closed_at est POSÉE
    -- PAR LE SERVEUR (section « Effets » plus bas), jamais par le client —
    -- y compris quand celui-ci soumet une transition légitime en même
    -- temps. Sans cette ligne, un client pourrait glisser une date de
    -- clôture arbitraire (antidater une résolution) dans la MÊME requête
    -- qu'une transition qu'il a par ailleurs le droit de faire : le
    -- `coalesce(new.closed_at, now())` de la section Effets aurait alors
    -- conservé sa valeur falsifiée au lieu de calculer now(). On neutralise
    -- ICI, avant tout le reste, toute valeur transmise par le client ; les
    -- Effets, plus bas, restent la SEULE autorité qui la fait évoluer.
    -- (socle_scope_org_id et anomalies n'ont pas besoin d'un traitement
    -- équivalent ici : t09_requests_set_scope_org, INCONDITIONNEL depuis le
    -- correctif E-1 côté M3, les recalcule entièrement AVANT ce trigger et
    -- ignore déjà toute valeur cliente — voir 20260822100200_requests_scope_org.sql.
    -- id est protégée par requests_protect_immutable, t10, qui s'exécute
    -- avant ce trigger et bloque déjà toute tentative, contexte de service
    -- compris — inutile de la revérifier ici.)
    new.closed_at := old.closed_at;

    -- RM-13 — édition du dossier : droit d'instruction sur le couple ACTUEL.
    -- v_edited = TOUTE colonne hors status, closure_motif, closure_text,
    -- closed_at, master_request_id, version, updated_at, socle_scope_org_id,
    -- anomalies (correctif F — liste exhaustive, pas seulement les colonnes
    -- « métier » habituelles : une colonne oubliée serait modifiable sans
    -- aucun droit).
    v_edited :=
         new.reference                is distinct from old.reference
      or new.reference_year           is distinct from old.reference_year
      or new.reference_seq            is distinct from old.reference_seq
      or new.organization_id          is distinct from old.organization_id
      or new.socle_root_org_id        is distinct from old.socle_root_org_id
      or new.socle_organization_id    is distinct from old.socle_organization_id
      or new.socle_organization_label is distinct from old.socle_organization_label
      or new.socle_procedure_id       is distinct from old.socle_procedure_id
      or new.socle_procedure_label    is distinct from old.socle_procedure_label
      or new.socle_category_label     is distinct from old.socle_category_label
      or new.socle_contact_id         is distinct from old.socle_contact_id
      or new.procedure_snapshot       is distinct from old.procedure_snapshot
      or new.requester_snapshot       is distinct from old.requester_snapshot
      or new.identity_status          is distinct from old.identity_status
      or new.source                   is distinct from old.source
      or new.external_ref             is distinct from old.external_ref
      or new.external_url             is distinct from old.external_url
      or new.channel                  is distinct from old.channel
      or new.received_at              is distinct from old.received_at
      or new.subject                  is distinct from old.subject
      or new.body                     is distinct from old.body
      or new.form_data                is distinct from old.form_data
      or new.priority                 is distinct from old.priority
      or new.assigned_to              is distinct from old.assigned_to
      or new.due_at                   is distinct from old.due_at
      or new.retention_until          is distinct from old.retention_until
      or new.purged_at                is distinct from old.purged_at
      or new.created_at               is distinct from old.created_at
      or new.idempotency_key          is distinct from old.idempotency_key
      or new.ingest_fingerprint       is distinct from old.ingest_fingerprint;

    if v_edited and not public.user_has_request_right(
         v_uid, old.organization_id, old.socle_organization_id,
         old.socle_procedure_id, 'instruction') then
      raise exception 'Modifier ce dossier exige le droit d''instruction sur cette démarche pour ce service.';
    end if;

    -- Correctif F : closure_*/master_request_id modifiés SANS changement de
    -- statut (correction a posteriori d'une clôture déjà posée) exigent
    -- aussi l'instruction — ces colonnes sont exclues de v_edited ci-dessus
    -- car la matrice de transition (plus bas) les modifie légitimement en
    -- même temps qu'un changement de statut ; ici, on couvre le cas où
    -- SEULES elles changent.
    if new.status is not distinct from old.status
       and (new.closure_motif      is distinct from old.closure_motif
            or new.closure_text    is distinct from old.closure_text
            or new.master_request_id is distinct from old.master_request_id)
       and not public.user_has_request_right(
             v_uid, old.organization_id, old.socle_organization_id,
             old.socle_procedure_id, 'instruction') then
      raise exception 'Modifier la clôture de ce dossier exige le droit d''instruction sur cette démarche pour ce service.';
    end if;

    -- RM-16 — affectation : le DESTINATAIRE doit pouvoir instruire la demande
    -- sur le couple RETENU (après un éventuel transfert/requalification
    -- simultanés — new.socle_organization_id/new.socle_procedure_id).
    if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
      if not public.user_has_request_right(new.assigned_to, new.organization_id,
             new.socle_organization_id, new.socle_procedure_id, 'instruction') then
        raise exception 'Cet agent n''a pas de droit d''instruction sur cette démarche pour ce service.';
      end if;
    end if;

    -- RM-18 — requalification : instruction sur le couple ACTUEL (déjà exigée
    -- ci-dessus via v_edited) ET sur le couple CIBLE.
    if new.socle_procedure_id is distinct from old.socle_procedure_id
       and not public.user_has_request_right(v_uid, new.organization_id,
             new.socle_organization_id, new.socle_procedure_id, 'instruction') then
      raise exception 'Requalification : vous devez détenir l''instruction sur la démarche cible.';
    end if;

    -- RM-19 — transfert : la cible peut être HORS du périmètre de l'auteur
    -- (c'est le geste), mais doit appartenir au sous-arbre Socle du tenant.
    if new.socle_organization_id is distinct from old.socle_organization_id
       and new.socle_organization_id is not null
       and not exists (select 1 from public.socle_organizations m
                        where m.organization_id = new.organization_id
                          and m.socle_id = new.socle_organization_id) then
      raise exception 'Transfert : organisation destinataire inconnue du référentiel du tenant.';
    end if;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Matrice fixe des transitions autorisées — INCHANGÉE.
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

  -- Exigences de données — INCHANGÉES.
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

  -- Portes par DROIT (contournées en contexte de service, tracé par ailleurs).
  if not v_service then
    -- RM-13 : les transitions d'instruction courante.
    if new.status in ('en_instruction','en_attente','a_traiter')
       and old.status in ('a_traiter','en_instruction','en_attente') then
      if not public.user_has_request_right(v_uid, old.organization_id,
             old.socle_organization_id, old.socle_procedure_id, 'instruction') then
        raise exception 'Cette transition exige le droit d''instruction sur cette démarche pour ce service.';
      end if;
    end if;

    -- RM-14 : les transitions terminales (et l'archivage/désarchivage) —
    -- droit de clôture.
    if new.status in ('annulee','resolue_positive','resolue_negative')
       or old.status in ('annulee','resolue_positive','resolue_negative','archivee')
       or new.status = 'archivee' then
      if not public.user_has_request_right(v_uid, old.organization_id,
             old.socle_organization_id, old.socle_procedure_id, 'cloture') then
        raise exception 'Cette transition exige le droit de clôture sur cette démarche pour ce service.';
      end if;
    end if;

    -- RM-21 — réouverture, archivage, désarchivage : administration SUR
    -- L'ORGANISATION DE LA DEMANDE, EN PLUS du droit de clôture ci-dessus
    -- (« qui rouvre doit pouvoir reclore »).
    if (old.status in ('annulee','resolue_positive','resolue_negative') and new.status = 'en_instruction')
       or new.status = 'archivee' or old.status = 'archivee' then
      if not public.has_admin_scope(old.organization_id, old.socle_scope_org_id) then
        raise exception 'Réouverture, archivage et désarchivage exigent l''administration sur ce service.';
      end if;
    end if;
  end if;

  -- Effets — INCHANGÉS.
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
revoke execute on function public.requests_guard_write() from public, anon, authenticated;

drop trigger if exists t11_requests_guard_transition on public.requests;
drop trigger if exists t11_requests_guard_write on public.requests;
create trigger t11_requests_guard_write
  before update on public.requests
  for each row execute function public.requests_guard_write();

-- Fonction précédente devenue orpheline (remplacée par requests_guard_write ;
-- son trigger a déjà été supprimé ci-dessus).
drop function if exists public.requests_guard_transition();

-- ============================================================================
-- 1bis. requests_before_insert_guard (M-1, revue de sécurité 2026-08-22) —
--    RM-16 s'appliquait déjà à l'AFFECTATION en cours d'instruction
--    (requests_guard_write, RM-16 ci-dessus) mais pas à une demande NÉE
--    directement affectée (assigned_to fourni dès l'INSERT, chemin
--    théoriquement ouvert par la policy requests_insert cliente) : un agent
--    pouvait donc affecter, à la création, un collègue sans aucun droit
--    d'instruction sur le couple — la même garde manque simplement à
--    l'insertion. Fonction déjà INVOKER (fondations, 20260820100100) :
--    aucun piège DEFINER/current_user ici, is_service_context() y reste
--    fiable — le trigger existant t10_requests_before_insert_guard reprend
--    automatiquement ce nouveau corps (CREATE OR REPLACE, même nom).
-- ============================================================================
create or replace function public.requests_before_insert_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_service_context() then
    if new.status <> 'a_traiter' then
      raise exception 'Une demande naît toujours au statut a_traiter (reçu : %).', new.status;
    end if;
    if new.assigned_to is not null
       and not public.user_has_request_right(new.assigned_to, new.organization_id,
             new.socle_organization_id, new.socle_procedure_id, 'instruction') then
      raise exception 'Cet agent n''a pas de droit d''instruction sur cette démarche pour ce service.';
    end if;
  end if;
  new.version := 1;
  return new;
end;
$$;
revoke execute on function public.requests_before_insert_guard() from public, anon, authenticated;

-- ============================================================================
-- 2. requests — policies par couple (organisation, démarche), ADR-04.
--    (select public.is_platform_admin()) : InitPlan, une évaluation par
--    requête plutôt qu'une par ligne (correctif O).
-- ============================================================================
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests
  for select to authenticated
  using (
    (select public.is_platform_admin())
    or (organization_id, socle_scope_org_id, coalesce(socle_procedure_id, public.nil_procedure()))
       in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
             from public.my_permission_pairs('consultation') s)
  );

drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests
  for insert to authenticated
  with check (
    source = 'iris'
    and ((select public.is_platform_admin())
         or (organization_id, socle_scope_org_id, coalesce(socle_procedure_id, public.nil_procedure()))
            in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                  from public.my_permission_pairs('creation') s))
  );

-- USING = droit d'écriture sur le couple ACTUEL (consultation seule → refus,
-- CA-06). WITH CHECK volontairement limité à l'appartenance : le transfert
-- d'organisation (RM-19) sort légitimement du périmètre de l'auteur ; la
-- finesse (RM-13/14/18/21) vit dans requests_guard_write, seule à voir OLD ET
-- NEW simultanément.
drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests
  for update to authenticated
  using (
    (select public.is_platform_admin())
    or (organization_id, socle_scope_org_id, coalesce(socle_procedure_id, public.nil_procedure()))
       in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
             from public.my_permission_pairs('ecriture') s)
  )
  with check (public.is_org_member(organization_id));

-- ============================================================================
-- 3. Satellites — EXISTS DIRECT vers requests (ADR-05, correctif E) : le RLS
--    de requests (déjà évalué via IN non corrélé) fait le filtrage de
--    LECTURE sans seconde implémentation. Les ÉCRITURES vérifient le droit
--    'ecriture'/'instruction' sur le couple porté par la demande, avec repli
--    (select is_platform_admin()) explicite — my_permission_pairs seul
--    laisserait un admin plateforme SANS PROFIL bloqué (RM-24).
-- ============================================================================

-- request_events (lecture seule, aucune écriture cliente).
drop policy if exists request_events_select on public.request_events;
create policy request_events_select on public.request_events
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_events.request_id));

-- request_assignments (lecture seule, aucune écriture cliente).
drop policy if exists request_assignments_select on public.request_assignments;
create policy request_assignments_select on public.request_assignments
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_assignments.request_id));

-- request_messages — RM-10 (consultation = notes internes comprises),
-- RM-15 (écriture = au moins un droit d'écriture ; modification/suppression
-- = auteur avec ce droit OU administration sur l'organisation de la demande).
drop policy if exists request_messages_select on public.request_messages;
create policy request_messages_select on public.request_messages
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_messages.request_id));

drop policy if exists request_messages_insert on public.request_messages;
create policy request_messages_insert on public.request_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      (select public.is_platform_admin())
      or exists (
        select 1 from public.requests r
         where r.id = request_messages.request_id
           and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
               in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                     from public.my_permission_pairs('ecriture') s)
      )
    )
  );

drop policy if exists request_messages_update on public.request_messages;
create policy request_messages_update on public.request_messages
  for update to authenticated
  using (
    (select public.is_platform_admin())
    or (
      author_id = auth.uid()
      and exists (
        select 1 from public.requests r
         where r.id = request_messages.request_id
           and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
               in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                     from public.my_permission_pairs('ecriture') s)
      )
    )
    or exists (
      select 1 from public.requests r
       where r.id = request_messages.request_id
         and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
    )
  )
  with check (
    (select public.is_platform_admin())
    or (
      author_id = auth.uid()
      and exists (
        select 1 from public.requests r
         where r.id = request_messages.request_id
           and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
               in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                     from public.my_permission_pairs('ecriture') s)
      )
    )
    or exists (
      select 1 from public.requests r
       where r.id = request_messages.request_id
         and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
    )
  );

drop policy if exists request_messages_delete on public.request_messages;
create policy request_messages_delete on public.request_messages
  for delete to authenticated
  using (
    (select public.is_platform_admin())
    or (
      author_id = auth.uid()
      and exists (
        select 1 from public.requests r
         where r.id = request_messages.request_id
           and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
               in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                     from public.my_permission_pairs('ecriture') s)
      )
    )
    or exists (
      select 1 from public.requests r
       where r.id = request_messages.request_id
         and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
    )
  );

-- request_attachments — RM-13 (ajout de pièces hors formulaire = instruction).
drop policy if exists request_attachments_select on public.request_attachments;
create policy request_attachments_select on public.request_attachments
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_attachments.request_id));

drop policy if exists request_attachments_insert on public.request_attachments;
create policy request_attachments_insert on public.request_attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      (select public.is_platform_admin())
      or exists (
        select 1 from public.requests r
         where r.id = request_attachments.request_id
           and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
               in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                     from public.my_permission_pairs('instruction') s)
      )
    )
  );

drop policy if exists request_attachments_delete on public.request_attachments;
create policy request_attachments_delete on public.request_attachments
  for delete to authenticated
  using (
    (select public.is_platform_admin())
    or exists (
      select 1 from public.requests r
       where r.id = request_attachments.request_id
         and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
    )
  );
-- Pas d'UPDATE client (copy_status géré par les workers service_role) — inchangé.

-- request_links — RM-17 (écriture ≥ création sur la SOURCE ; la CIBLE est
-- vérifiée par le trigger request_links_check_scope étendu ci-dessous).
drop policy if exists request_links_select on public.request_links;
create policy request_links_select on public.request_links
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_links.request_id));

drop policy if exists request_links_insert on public.request_links;
create policy request_links_insert on public.request_links
  for insert to authenticated
  with check (
    (select public.is_platform_admin())
    or exists (
      select 1 from public.requests r
       where r.id = request_links.request_id
         and (r.organization_id, r.socle_scope_org_id, coalesce(r.socle_procedure_id, public.nil_procedure()))
             in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                   from public.my_permission_pairs('ecriture') s)
    )
  );

drop policy if exists request_links_delete on public.request_links;
create policy request_links_delete on public.request_links
  for delete to authenticated
  using (
    (select public.is_platform_admin())
    or exists (
      select 1 from public.requests r
       where r.id = request_links.request_id
         and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
    )
  );

-- Correctif G / RM-17 : la CIBLE d'un lien doit être au moins consultable par
-- l'auteur, hors contexte de service (l'ingestion et les scripts internes ne
-- sont pas soumis aux droits d'un utilisateur — comportement déjà établi pour
-- les autres gardes de ce projet).
create or replace function public.request_links_check_scope()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
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
    if not public.is_service_context() and not public.can_read_request(new.target_request_id) then
      raise exception 'Lien : demande cible non accessible.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.request_links_check_scope() from public, anon, authenticated;

-- ============================================================================
-- 4. Storage — correctif D (owner_id texte, owner uuid déprécié — les deux en
--    OR) et uuid_or_null sur LES DEUX segments du chemin (correctif D).
--
-- ⚠️ Correctif E-2/M-2 (revue de sécurité, 2026-08-22) : les branches
-- « brouillon » ci-dessous testaient `not exists (select 1 from
-- public.requests where id = …)` — une requête ORDINAIRE, donc soumise au
-- RLS de l'APPELANT (pas service_role) : une demande EXISTANTE mais
-- INVISIBLE pour lui (droits révoqués, transférée hors de son périmètre…)
-- semblait alors « ne pas exister » et retombait dans la branche brouillon,
-- où `owner_id = auth.uid()` suffisait à conserver SELECT/DELETE — un
-- ancien déposant gardait donc indéfiniment l'accès aux pièces d'un dossier
-- qu'il ne peut plus voir par ailleurs. Remplacé par public.request_exists
-- (M3), SECURITY DEFINER, qui répond hors RLS. INSERT durci en plus (M-2) :
-- déposer une pièce SOUS LE CHEMIN D'UNE DEMANDE DÉJÀ EXISTANTE exige
-- désormais l'instruction (can_process_request), pas la seule création —
-- le dépôt initial du brouillon reste couvert (la demande n'existe pas
-- encore au moment du dépôt, create_request_from_procedure l'insère APRÈS).
-- ============================================================================
drop policy if exists "request_attachments_storage_select" on storage.objects;
create policy "request_attachments_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and (
      public.can_read_request(public.uuid_or_null((storage.foldername(name))[2]))
      or (
        (owner_id = auth.uid()::text or owner = auth.uid())
        and not public.request_exists(public.uuid_or_null((storage.foldername(name))[2]))
      )
    )
  );

drop policy if exists "request_attachments_storage_insert" on storage.objects;
create policy "request_attachments_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'request-attachments'
    and public.has_any_creation_right(public.uuid_or_null((storage.foldername(name))[1]))
    and (
      not public.request_exists(public.uuid_or_null((storage.foldername(name))[2]))
      or public.can_process_request(public.uuid_or_null((storage.foldername(name))[2]))
    )
  );

drop policy if exists "request_attachments_storage_delete" on storage.objects;
create policy "request_attachments_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'request-attachments'
    and (
      public.can_admin_request(public.uuid_or_null((storage.foldername(name))[2]))
      or (
        (owner_id = auth.uid()::text or owner = auth.uid())
        and not public.request_exists(public.uuid_or_null((storage.foldername(name))[2]))
      )
    )
  );
-- Pas d'UPDATE (inchangé : un objet se remplace par suppression + nouvel envoi).

-- ============================================================================
-- 5. is_org_writer — RETRAIT (RM-43/Q6). Tous ses appelants ont été remplacés
--    ci-dessus (requests_insert/_update, request_messages_insert/_update/
--    _delete, request_attachments_insert, request_links_insert, storage
--    insert) DANS CETTE MÊME MIGRATION : aucune fenêtre où la fonction
--    existe sans appelant restant, ni où un appelant subsiste sans elle.
-- ============================================================================
drop function if exists public.is_org_writer(uuid);
