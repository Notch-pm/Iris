-- ============================================================================
-- Le texte de clôture destiné à l'usager devient FACULTATIF (décision PO,
-- 2026-08-28).
--
-- POURQUOI MAINTENANT : la résolution déclenche désormais un courriel à
-- l'usager (« Votre demande a été résolue positivement » / « Nous ne pouvons
-- répondre positivement à votre demande »), composé par le serveur et complet
-- sans commentaire. L'exigence d'origine servait à garantir qu'on dise QUELQUE
-- CHOSE à l'usager ; c'est maintenant l'avis de clôture qui s'en charge, et le
-- commentaire de l'agent n'y est plus qu'une précision. Continuer d'exiger un
-- texte reviendrait à faire écrire une phrase de politesse pour rien — et,
-- comme toujours dans ce cas, à en obtenir de mauvaises.
--
-- CE QUI NE CHANGE PAS : la colonne, son nom, sa promesse (« destiné à
-- l'usager », donc jamais une note interne), et le fait qu'elle est purgée à la
-- réouverture. Ni les motifs de clôture, qui restent obligatoires là où ils
-- l'étaient — eux classent le dossier pour le service, et ne sortent pas.
--
-- ⚠️ Cette migration RÉÉMET `requests_guard_write` en entier (une seule ligne
-- de différence : la levée retirée). C'est le prix d'une porte unique, assumé
-- lors de sa création. Le corps ci-dessous est copié à l'identique de
-- 20260822100700_policies_droits.sql, commentaires compris, pour que la
-- comparaison des deux fichiers montre exactement ce qui bouge.
-- ⚠️ `CREATE OR REPLACE` réaccorde EXECUTE à PUBLIC : la révocation est
-- rejouée juste après (règle du CLAUDE.md racine, piège vécu chez Clara).
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
    -- PAR LE SERVEUR (section « Effets » plus bas), jamais par le client.
    new.closed_at := old.closed_at;

    -- RM-13 — édition du dossier : droit d'instruction sur le couple ACTUEL.
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
    -- statut exigent aussi l'instruction.
    if new.status is not distinct from old.status
       and (new.closure_motif      is distinct from old.closure_motif
            or new.closure_text    is distinct from old.closure_text
            or new.master_request_id is distinct from old.master_request_id)
       and not public.user_has_request_right(
             v_uid, old.organization_id, old.socle_organization_id,
             old.socle_procedure_id, 'instruction') then
      raise exception 'Modifier la clôture de ce dossier exige le droit d''instruction sur cette démarche pour ce service.';
    end if;

    -- RM-16 — affectation : le DESTINATAIRE doit pouvoir instruire la demande.
    if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
      if not public.user_has_request_right(new.assigned_to, new.organization_id,
             new.socle_organization_id, new.socle_procedure_id, 'instruction') then
        raise exception 'Cet agent n''a pas de droit d''instruction sur cette démarche pour ce service.';
      end if;
    end if;

    -- RM-18 — requalification : instruction sur le couple ACTUEL et CIBLE.
    if new.socle_procedure_id is distinct from old.socle_procedure_id
       and not public.user_has_request_right(v_uid, new.organization_id,
             new.socle_organization_id, new.socle_procedure_id, 'instruction') then
      raise exception 'Requalification : vous devez détenir l''instruction sur la démarche cible.';
    end if;

    -- RM-19 — transfert : cible libre dans le sous-arbre Socle du tenant.
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

  -- Exigences de données.
  if old.status = 'a_traiter' and new.status = 'en_instruction' and new.assigned_to is null then
    raise exception 'Passage en instruction : un agent assigné est obligatoire.';
  end if;
  -- ⚠️ RETIRÉ le 2026-08-28 : le texte de clôture destiné à l'usager n'est plus
  -- exigé. L'avis de clôture envoyé à l'usager se tient sans commentaire ; le
  -- texte de l'agent n'y est qu'une précision. Voir l'en-tête de cette
  -- migration, et `_shared/email/cloture.ts`.
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

    -- RM-14 : les transitions terminales (et l'archivage/désarchivage).
    if new.status in ('annulee','resolue_positive','resolue_negative')
       or old.status in ('annulee','resolue_positive','resolue_negative','archivee')
       or new.status = 'archivee' then
      if not public.user_has_request_right(v_uid, old.organization_id,
             old.socle_organization_id, old.socle_procedure_id, 'cloture') then
        raise exception 'Cette transition exige le droit de clôture sur cette démarche pour ce service.';
      end if;
    end if;

    -- RM-21 — réouverture, archivage, désarchivage : administration EN PLUS.
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

comment on function public.requests_guard_write() is
  'Porte unique des écritures sur requests (ADR-07) : matrice de transitions, exigences de données, portes par droit, effets. Le texte de clôture destiné à l''usager n''est plus exigé depuis le 2026-08-28 (décision PO) — l''avis de clôture envoyé à l''usager se tient sans commentaire.';
