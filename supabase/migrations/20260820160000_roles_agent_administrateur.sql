-- ============================================================================
-- Simplification des rôles (décision PO 2026-08-20) : deux rôles seulement —
-- « agent » (instruit, ne voit pas les paramètres) et « administrateur »
-- (voit tout : paramètres, réouverture, archivage, membres).
-- Migration des données : admin/superviseur → administrateur ; lecteur → agent.
-- ============================================================================

alter table public.organization_members drop constraint if exists organization_members_role_check;

update public.organization_members
   set role = case when role in ('admin', 'superviseur') then 'administrateur' else 'agent' end
 where role not in ('agent', 'administrateur');

alter table public.organization_members
  add constraint organization_members_role_check check (role in ('agent', 'administrateur'));

comment on column public.organization_members.role is
  'administrateur : paramètres, membres, réouverture, archivage · agent : instruction (pas de paramètres).';

-- Helpers alignés (CREATE OR REPLACE conserve les ACL ; on re-révoque par principe).
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or public.member_role(p_org_id) = 'administrateur';
$$;

create or replace function public.is_org_writer(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
      or public.member_role(p_org_id) in ('administrateur', 'agent');
$$;

-- Garde des transitions : les portes par rôle passent à « administrateur »
-- (réouverture ET archivage/désarchivage).
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
