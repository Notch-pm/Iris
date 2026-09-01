-- ============================================================================
-- Transfert d'organisme : le geste passe par une RPC, plus par un UPDATE nu.
--
-- ⚠️ POURQUOI (constaté empiriquement le 2026-09-01, en base réelle) : un
-- UPDATE client de `socle_organization_id` vers un organisme où l'auteur n'a
-- AUCUN droit est refusé par le RLS — `42501 : new row violates row-level
-- security policy for table "requests"`. Trois sondes l'ont établi :
--
--   · un agent qui détient l'écriture sur la source ET la cible transfère ;
--   · le même agent, avec l'écriture sur la SEULE source, est refusé ;
--   · au moment du refus, le `WITH CHECK` que `pg_policy` affiche pour
--     `requests_update` — `is_org_member(organization_id)` — vaut pourtant
--     VRAI, et les modifications ordinaires (priorité, objet) passent.
--
-- Autrement dit, la ligne MISE À JOUR doit rester dans le périmètre de son
-- auteur. C'est précisément ce que RM-19 refuse d'exiger : « la cible peut être
-- HORS du périmètre de l'auteur — c'est le geste ». Le défaut ne se voyait pas
-- avec un administrateur de plateforme, que `is_platform_admin()` fait passer
-- partout : il ne se serait révélé qu'au premier vrai agent.
--
-- Deux sorties étaient possibles : élargir la policy, ou passer par une porte
-- de service. La seconde est retenue — la policy `requests_update` garde des
-- clients d'un tout autre genre (transitions, édition du dossier, affectation)
-- qu'on ne touche pas pour un seul geste, et le projet a déjà ce motif :
-- `qualify_request_attachment`, `attach_request_piece`. La RPC devient donc
-- l'UNIQUE porte du transfert.
--
-- ⚠️ Corollaire à ne jamais perdre de vue : en `SECURITY DEFINER`,
-- `is_service_context()` vaut TOUJOURS vrai (piège vérifié le 2026-08-22,
-- CLAUDE.md), donc `t11_requests_guard_write` NE GARDE PLUS RIEN ici. Les deux
-- contrôles qu'il portait pour ce geste — droit d'instruction sur le couple
-- ACTUEL, et appartenance de la cible au sous-arbre du tenant — sont donc
-- réécrits DANS cette fonction. Ce qui reste appliqué par ailleurs :
-- `t08` (libellé, désaffectation), `t10` (gel des archivées), `t12`
-- (activation de la démarche pour la cible), `t30`/`t40` (journal,
-- notifications) — tous `DEFINER` ou insensibles au contexte.
-- ============================================================================

create or replace function public.transfer_request(
  p_request_id uuid, p_socle_org_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_org        uuid;
  v_dest       uuid;
  v_proc       uuid;
  v_assigned   uuid;
  v_label      text;
  v_after      uuid;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select r.organization_id, r.socle_organization_id, r.socle_procedure_id, r.assigned_to
    into v_org, v_dest, v_proc, v_assigned
    from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'Demande introuvable.';
  end if;

  -- RM-19 — le droit porte sur le couple ACTUEL, jamais sur la cible.
  if not public.request_right_for(v_uid, v_org, v_dest, v_proc, 'instruction') then
    raise exception 'Transférer cette demande exige le droit d''instruction sur cette démarche pour ce service.';
  end if;

  if p_socle_org_id is null then
    raise exception 'Transfert : organisme cible obligatoire.';
  end if;

  -- La cible est libre DANS LE SOUS-ARBRE du tenant, et nulle part ailleurs :
  -- sans ce contrôle, la RPC déplacerait une demande vers un UUID quelconque.
  if not exists (
    select 1 from public.socle_organizations m
     where m.organization_id = v_org
       and m.socle_id = p_socle_org_id
       and m.obsoleted_at is null
  ) then
    raise exception 'Transfert : organisation destinataire inconnue du référentiel du tenant.';
  end if;

  -- Rien à faire, et surtout rien à journaliser : un transfert sur place n'est
  -- pas un événement.
  if p_socle_org_id is not distinct from v_dest then
    return jsonb_build_object('changed', false);
  end if;

  update public.requests set socle_organization_id = p_socle_org_id where id = p_request_id;

  -- On relit ce que le SERVEUR a décidé : le libellé vient du miroir (t08) et
  -- l'affectation a pu être retirée. L'écran annonce ce qui s'est passé, pas
  -- ce qu'il espérait.
  select r.socle_organization_label, r.assigned_to
    into v_label, v_after
    from public.requests r where r.id = p_request_id;

  return jsonb_build_object(
    'changed', true,
    'organisme', v_label,
    'unassigned', v_assigned is not null and v_after is null);
end;
$$;
comment on function public.transfer_request(uuid, uuid) is
  'Transfert d''une demande vers un autre organisme responsable (RM-19). UNIQUE porte : un UPDATE client est refusé par le RLS dès que la cible sort du périmètre de l''auteur. Vérifie le droit d''instruction sur le couple ACTUEL et l''appartenance de la cible au sous-arbre du tenant — t11 étant neutralisé par le contexte DEFINER.';
revoke execute on function public.transfer_request(uuid, uuid) from public, anon;
grant  execute on function public.transfer_request(uuid, uuid) to authenticated;
