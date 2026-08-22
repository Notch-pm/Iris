-- ============================================================================
-- Profils de droits — M3/9 : socle_scope_org_id (le couple d'évaluation est
-- MATÉRIALISÉ sur la demande, jamais recalculé par ligne dans le RLS).
-- Réf : spec-profils-droits.md RM-27, RM-28, RM-30 ·
-- architecture-profils-droits.md ADR-01.
-- Dépend de M2 (request_scope_org). Colonne NOT NULL posée dans CETTE
-- migration (backfill puis contrainte, même fichier — jamais deux migrations
-- séparées pour une NOT NULL sur une table déjà peuplée : fenêtre incohérente
-- sinon si M3 échoue à mi-chemin sur un autre projet).
-- ============================================================================

alter table public.requests add column if not exists socle_scope_org_id uuid;
comment on column public.requests.socle_scope_org_id is
  'Organisation Socle PORTEUSE DES DROITS : destinataire si connu du miroir du tenant (obsolète comprise), racine Socle du tenant sinon (destinataire NULL ou inconnu → anomalie destinataire_inconnu). Calculée par trigger, jamais par le client. Support du RLS par sous-arbre (M8).';

-- ----------------------------------------------------------------------------
-- requests_set_scope_org — calcule socle_scope_org_id + pose/purge l'anomalie
-- destinataire_inconnu (RM-28). DEFINER : lit socle_organizations hors RLS.
--
-- ⚠️ Correctif E-1 (revue de sécurité, 2026-08-22) : ce trigger tournait
-- auparavant en `BEFORE UPDATE OF socle_organization_id` — un client pouvait
-- donc écrire N'IMPORTE QUELLE valeur dans socle_scope_org_id (colonne
-- censée n'être posée QUE par ce trigger) simplement en omettant
-- socle_organization_id de la clause SET de son UPDATE : le trigger ne se
-- déclenchait pas, et rien d'autre ne protégeait cette colonne — un vecteur
-- d'escalade direct (déplacer une demande dans un périmètre RLS qu'on
-- maîtrise). Corrigé en deux temps :
--   1. Le trigger passe en `BEFORE UPDATE` SANS liste de colonnes : il
--      recalcule INCONDITIONNELLEMENT à CHAQUE UPDATE (idempotent — sans
--      effet si rien de pertinent n'a changé), donc AUCUNE valeur cliente
--      pour socle_scope_org_id ne peut jamais survivre jusqu'à t10/t11.
--   2. `anomalies` a le MÊME problème sur un autre axe : la version
--      précédente lisait/écrivait new.anomalies (ce que le client vient de
--      soumettre), donc un client pouvait glisser un tableau falsifié
--      (retirer une anomalie existante, en fabriquer une fausse) même sans
--      toucher socle_organization_id — le trigger n'ajoutait qu'UNE entrée
--      conditionnelle, il ne « possédait » pas toute la colonne. Ce trigger
--      repart désormais TOUJOURS de old.anomalies (jamais new.anomalies) en
--      UPDATE : toute valeur cliente pour anomalies est purement et
--      simplement ignorée, la colonne est intégralement reconstruite par le
--      serveur à chaque écriture. (En INSERT, il n'existe pas d'ancienne
--      valeur : new.anomalies à ce stade est celui posé par le serveur,
--      requests-api ou create_request_from_procedure — jamais un payload
--      client brut, cf. docs/data-model.md.)
-- ----------------------------------------------------------------------------
create or replace function public.requests_set_scope_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_known    boolean;
  v_base     jsonb := case when tg_op = 'UPDATE' then old.anomalies else new.anomalies end;
begin
  if new.socle_organization_id is not null then
    select true into v_known from public.socle_organizations m
     where m.organization_id = new.organization_id
       and m.socle_id = new.socle_organization_id;
  end if;
  if coalesce(v_known, false) then
    new.socle_scope_org_id := new.socle_organization_id;
    -- L'organisation est (redevenue) connue : purge une éventuelle anomalie
    -- destinataire_inconnu caduque (parité avec refresh_request_scope_org).
    new.anomalies := (
      select coalesce(jsonb_agg(a), '[]'::jsonb)
        from jsonb_array_elements(v_base) a
       where a ->> 'code' <> 'destinataire_inconnu'
    );
  else
    new.socle_scope_org_id := new.socle_root_org_id;
    if new.socle_organization_id is not null
       and not (v_base @> '[{"code":"destinataire_inconnu"}]'::jsonb) then
      new.anomalies := v_base
        || jsonb_build_array(jsonb_build_object('code','destinataire_inconnu',
                                                 'socle_organization_id', new.socle_organization_id));
    else
      new.anomalies := v_base;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_set_scope_org() from public, anon, authenticated;

-- INSERT : APRÈS t20 (socle_root_org_id y est dérivée du tenant) — ordre
-- alphabétique des noms de trigger = ordre d'exécution (convention du projet).
drop trigger if exists t21_requests_set_scope_org on public.requests;
create trigger t21_requests_set_scope_org
  before insert on public.requests
  for each row execute function public.requests_set_scope_org();

-- UPDATE : INCONDITIONNEL (correctif E-1, voir ci-dessus — abandon de
-- `OF socle_organization_id`), AVANT t10/t11 (le transfert d'organisation
-- RM-19 doit être reflété avant l'évaluation des gardes et de l'immuabilité).
drop trigger if exists t09_requests_set_scope_org on public.requests;
create trigger t09_requests_set_scope_org
  before update on public.requests
  for each row execute function public.requests_set_scope_org();

-- NB (application 2026-08-22) : le correctif C ci-dessous est posé AVANT le backfill —
-- une demande déjà archivée traverserait sinon l'ancien gel lors de l'UPDATE de reprise.
-- ----------------------------------------------------------------------------
-- Correctif C — requests_protect_immutable doit tolérer, en CONTEXTE DE
-- SERVICE UNIQUEMENT, une mise à jour d'une demande ARCHIVÉE qui ne touche QUE
-- socle_scope_org_id et/ou anomalies (statut inchangé). Sans cette dérogation,
-- refresh_request_scope_org lève 'Demande archivée : aucune modification
-- possible' dès qu'une demande close est archivée et qu'un sync Socle
-- ultérieur change son organisation destinataire dans le miroir — un scénario
-- normal (RM-31), pas une anomalie. Tout le reste du gel des archivées est
-- CONSERVÉ À L'IDENTIQUE (aucune autre colonne, aucun contexte client).
-- ----------------------------------------------------------------------------
create or replace function public.requests_protect_immutable()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_service           boolean := public.is_service_context();
  v_only_scope_refresh boolean;
begin
  -- F-7 (revue de sécurité, 2026-08-22) : id ajouté aux colonnes immuables —
  -- une clé primaire ne se réécrit jamais, y compris en contexte de service
  -- (aucune raison légitime, contrairement aux autres colonnes de cette
  -- liste qui elles restent volontairement figées pour tout le monde).
  if new.id                is distinct from old.id
     or new.reference         is distinct from old.reference
     or new.reference_year is distinct from old.reference_year
     or new.reference_seq  is distinct from old.reference_seq
     or new.organization_id   is distinct from old.organization_id
     or new.socle_root_org_id is distinct from old.socle_root_org_id
     or new.source          is distinct from old.source
     or new.external_ref    is distinct from old.external_ref
     or new.received_at     is distinct from old.received_at
     or new.created_at      is distinct from old.created_at
     or new.requester_snapshot is distinct from old.requester_snapshot then
    raise exception 'Colonne immuable : id, reference, organization_id, socle_root_org_id, source, external_ref, received_at, created_at et requester_snapshot ne changent jamais.';
  end if;

  if old.status = 'archivee' then
    v_only_scope_refresh :=
      v_service
      and new.status = 'archivee'
      and new.subject           is not distinct from old.subject
      and new.body              is not distinct from old.body
      and new.form_data         is not distinct from old.form_data
      and new.procedure_snapshot is not distinct from old.procedure_snapshot
      and new.closure_motif     is not distinct from old.closure_motif
      and new.closure_text      is not distinct from old.closure_text
      and new.assigned_to       is not distinct from old.assigned_to
      and new.priority          is not distinct from old.priority
      and new.socle_organization_id is not distinct from old.socle_organization_id
      and new.socle_procedure_id    is not distinct from old.socle_procedure_id
      and new.socle_contact_id      is not distinct from old.socle_contact_id
      and (new.socle_scope_org_id is distinct from old.socle_scope_org_id
           or new.anomalies is distinct from old.anomalies);

    if new.status = 'archivee' and not v_only_scope_refresh then
      raise exception 'Demande archivée : aucune modification possible (désarchiver d''abord).';
    end if;
    if new.status <> 'archivee'
       and (new.subject       is distinct from old.subject
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
         or new.socle_contact_id      is distinct from old.socle_contact_id) then
      raise exception 'Désarchivage : seul le statut peut changer.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_protect_immutable() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Backfill puis NOT NULL. Les 3 demandes ACCM existantes ont toutes un
-- socle_organization_id connu (adressées à la racine ou à un service du
-- miroir) → new_scope résolu directement, aucune anomalie posée.
-- ----------------------------------------------------------------------------
update public.requests
   set socle_scope_org_id = public.request_scope_org(organization_id, socle_organization_id)
 where socle_scope_org_id is null;

alter table public.requests alter column socle_scope_org_id set not null;

create index if not exists requests_org_scope_proc_idx
  on public.requests (organization_id, socle_scope_org_id, socle_procedure_id);

-- ----------------------------------------------------------------------------
-- refresh_request_scope_org — recalcul post-sync Socle (le miroir peut
-- révéler une organisation jusque-là inconnue, ou en faire disparaître une).
-- Recalcule scope ET anomalie destinataire_inconnu, symétriquement au trigger
-- d'INSERT/UPDATE. Ne touche QUE les lignes dont la valeur change réellement
-- (évite le bruit de version — docs/data-model.md, note ADR-01 : l'incrément
-- de version() est accepté tant que l'outbox n'est pas branchée).
-- Appelée par sync-socle-referentiel (edge, service_role) — M4 en dépend pour
-- rien, mais la correction du gel des archivées (ci-dessous) est nécessaire
-- pour que cet appel ne casse jamais sur une demande archivée (correctif C).
-- ----------------------------------------------------------------------------
create or replace function public.refresh_request_scope_org(p_org_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  with target as (
    select r.id, r.organization_id, r.socle_organization_id, r.anomalies,
           exists (
             select 1 from public.socle_organizations m
              where m.organization_id = r.organization_id
                and m.socle_id = r.socle_organization_id
           ) as v_known
      from public.requests r
     where (p_org_id is null or r.organization_id = p_org_id)
  ),
  recalced as (
    select t.id,
           case when t.v_known then t.socle_organization_id
                else (select o.socle_org_id from public.organizations o where o.id = t.organization_id)
           end as new_scope,
           case
             when t.v_known then
               (select coalesce(jsonb_agg(a), '[]'::jsonb)
                  from jsonb_array_elements(t.anomalies) a
                 where a ->> 'code' <> 'destinataire_inconnu')
             when t.socle_organization_id is not null
                  and not (t.anomalies @> '[{"code":"destinataire_inconnu"}]'::jsonb) then
               t.anomalies || jsonb_build_array(jsonb_build_object(
                 'code','destinataire_inconnu','socle_organization_id', t.socle_organization_id))
             else t.anomalies
           end as new_anomalies
      from target t
  )
  update public.requests r
     set socle_scope_org_id = rc.new_scope,
         anomalies = rc.new_anomalies
    from recalced rc
   where r.id = rc.id
     and (r.socle_scope_org_id is distinct from rc.new_scope
          or r.anomalies is distinct from rc.new_anomalies);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.refresh_request_scope_org(uuid) is
  'Recalcule socle_scope_org_id + anomalie destinataire_inconnu après une synchronisation Socle. service_role uniquement. Peut toucher des demandes archivées (correctif C ci-dessous) : seules ces deux colonnes changent, version suit.';
revoke execute on function public.refresh_request_scope_org(uuid) from public, anon, authenticated;


-- ============================================================================
-- can_read/write/process/admin_request — ENVELOPPES DEFINER en SQL pur.
-- Déplacées ici (et non M2) car elles lisent requests.socle_scope_org_id, qui
-- vient d'être créée : une fonction LANGUAGE SQL est analysée (comme une vue)
-- AU MOMENT de CREATE FUNCTION — contrairement à PL/pgSQL, dont le corps est
-- opaque jusqu'au premier appel — et échouerait plus tôt (colonne inexistante).
-- Réservées aux policies STORAGE et aux usages ponctuels (edge functions) —
-- ADR-05 : les policies des SATELLITES (M8) utilisent un EXISTS direct vers
-- requests, PAS ces fonctions, pour ne pas ré-énumérer les couples par ligne.
-- ============================================================================
-- ----------------------------------------------------------------------------
-- request_exists — existence BRUTE d'une demande, HORS RLS (correctif E-2 :
-- la branche « brouillon » des policies storage, M8, testait auparavant
-- `not exists (select 1 from public.requests where id = …)` — une requête
-- SQL ORDINAIRE, donc soumise au RLS de l'appelant ; une demande EXISTANTE
-- mais INVISIBLE pour lui semblait alors « ne pas exister » et retombait
-- dans la branche brouillon, où `owner_id = auth.uid()` suffisait à
-- conserver SELECT/DELETE — un ancien déposant gardait donc l'accès à des
-- pièces d'un dossier dont il a perdu tout droit. Cette fonction, SECURITY
-- DEFINER, répond « existe / n'existe pas » sans jamais consulter le RLS.
-- ----------------------------------------------------------------------------
create or replace function public.request_exists(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.requests where id = p_id);
$$;
comment on function public.request_exists(uuid) is
  'Existence brute d''une demande, hors RLS (correctif E-2). Distingue un VRAI brouillon (id inexistant) d''une demande existante mais invisible pour l''appelant.';
revoke execute on function public.request_exists(uuid) from public, anon;
grant  execute on function public.request_exists(uuid) to authenticated;

create or replace function public.can_read_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select public.is_platform_admin()) or exists (
    select 1 from public.requests r
     where r.id = p_request_id
       and (r.organization_id, r.socle_scope_org_id,
            coalesce(r.socle_procedure_id, public.nil_procedure()))
           in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                 from public.my_permission_pairs('consultation') s)
  );
$$;
comment on function public.can_read_request(uuid) is
  'Droit de consultation sur une demande (par son id). Réservée aux policies storage et aux usages ponctuels — les satellites (M8) utilisent un EXISTS direct pour ne pas dupliquer l''énumération.';
revoke execute on function public.can_read_request(uuid) from public, anon;
grant  execute on function public.can_read_request(uuid) to authenticated;

create or replace function public.can_write_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select public.is_platform_admin()) or exists (
    select 1 from public.requests r
     where r.id = p_request_id
       and (r.organization_id, r.socle_scope_org_id,
            coalesce(r.socle_procedure_id, public.nil_procedure()))
           in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                 from public.my_permission_pairs('ecriture') s)
  );
$$;
revoke execute on function public.can_write_request(uuid) from public, anon;
grant  execute on function public.can_write_request(uuid) to authenticated;

create or replace function public.can_process_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select public.is_platform_admin()) or exists (
    select 1 from public.requests r
     where r.id = p_request_id
       and (r.organization_id, r.socle_scope_org_id,
            coalesce(r.socle_procedure_id, public.nil_procedure()))
           in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
                 from public.my_permission_pairs('instruction') s)
  );
$$;
revoke execute on function public.can_process_request(uuid) from public, anon;
grant  execute on function public.can_process_request(uuid) to authenticated;

create or replace function public.can_admin_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
     where r.id = p_request_id
       and public.has_admin_scope(r.organization_id, r.socle_scope_org_id)
  );
$$;
comment on function public.can_admin_request(uuid) is
  'Administration effective sur l''organisation porteuse de la demande (has_admin_scope inclut déjà is_platform_admin).';
revoke execute on function public.can_admin_request(uuid) from public, anon;
grant  execute on function public.can_admin_request(uuid) to authenticated;
