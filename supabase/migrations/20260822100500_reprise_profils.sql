-- ============================================================================
-- Profils de droits — M6/9 : reprise des données existantes (RM-48 à RM-51).
-- Réf : spec-profils-droits.md §3.H · architecture-profils-droits.md ADR-13.
-- Exécutée en CONTEXTE DE SERVICE (postgres, applicateur des migrations) :
-- les tables de profils n'ont aucune policy d'écriture cliente (M9) — cette
-- migration, du code revu (pas une entrée utilisateur), écrit directement,
-- sans passer par les RPC de M5 ni leurs gardes (M4).
-- IMPÉRATIF D'ORDRE : cette migration DOIT s'appliquer AVANT M8 (bascule des
-- policies) — sans elle, la bascule prive tout le monde de droits (aucun
-- profil attribué ⇒ aucune demande visible pour personne).
-- Idempotente : rejouable sans dupliquer profils, périmètres ni attributions
-- (ON CONFLICT DO NOTHING partout), le journal n'écrit qu'à la première pose.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- M-4 (revue de sécurité, 2026-08-22) — garde-fou PRÉALABLE : la reprise
-- attribue le profil « Administrateur » à tout membre role='administrateur'
-- ; si un tenant n'en compte AUCUN, il naît sans administrateur du tout,
-- verrouillé dès la bascule (RM-42 ne peut plus jamais être satisfait sans
-- passer par l'admin plateforme). Fail LOUDLY ici plutôt que de laisser un
-- tel tenant se créer silencieusement — à ce jour (2026-08-22), les 3
-- tenants existants (ACCM, [TEST], Test 2) ont tous au moins un
-- administrateur (le compte fondateur).
-- ----------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(o.name, ', ') into v_missing
    from public.organizations o
   where not exists (
     select 1 from public.organization_members m
      where m.organization_id = o.id and m.role = 'administrateur'
   );
  if v_missing is not null then
    raise exception 'Reprise impossible : tenant(s) sans aucun membre role=administrateur avant bascule : %. Un tenant né verrouillé ne pourrait plus être administré (RM-42) — corriger organization_members avant de rejouer cette migration.', v_missing;
  end if;
end;
$$;

do $$
declare
  v_org        record;
  v_admin_id   uuid;
  v_agent_id   uuid;
  v_member     record;
  v_granted_id uuid;
begin
  for v_org in select id, socle_org_id, name from public.organizations loop

    -- 1. Racine Socle dans le miroir (garde-fou RM-05 : un tenant sans racine
    --    dans socle_organizations ne peut porter aucun profil valide — la
    --    sync-socle-referentiel l'a déjà peuplée pour ACCM/[TEST]/Test 2,
    --    cette ligne est un filet, pas la source de vérité).
    insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name, status)
    values (v_org.id, v_org.socle_org_id, null, v_org.name, 'active')
    on conflict (organization_id, socle_id) do nothing;

    -- 2. Profil « Administrateur » — is_admin, racine, matrice vide, défaut =
    --    les quatre droits (RM-48 : équivalence stricte avec l'ancien rôle
    --    administrateur, qui voyait et pouvait tout faire).
    insert into public.permission_profiles (
      organization_id, name, description, is_admin,
      default_view, default_create, default_process, default_close,
      created_by, updated_by
    ) values (
      v_org.id, 'Administrateur',
      'Profil de reprise (RM-48) : équivalent au rôle administrateur avant les profils de droits — administration + tous droits sur toutes les démarches, présentes et futures.',
      true, true, true, true, true, null, null
    )
    on conflict (organization_id, lower(btrim(name))) do nothing
    returning id into v_admin_id;

    if v_admin_id is not null then
      insert into public.permission_audit_log
        (organization_id, actor_id, action, profile_id, profile_name, before, after)
      values (v_org.id, null, 'profile_created', v_admin_id, 'Administrateur', null,
              jsonb_build_object('is_admin', true,
                'default_rights', public.rights_array(true, true, true, true),
                'organizations', jsonb_build_array(v_org.socle_org_id)));
    else
      select id into v_admin_id from public.permission_profiles
       where organization_id = v_org.id and lower(btrim(name)) = 'administrateur';
    end if;

    insert into public.permission_profile_organizations (profile_id, socle_org_id)
    values (v_admin_id, v_org.socle_org_id)
    on conflict (profile_id, socle_org_id) do nothing;

    -- 3. Profil « Agent » — non-admin, racine, matrice vide, défaut = les
    --    quatre droits (RM-48/RM-50 : un agent voyait et instruisait tout,
    --    sauf paramètres/réouverture/archivage).
    insert into public.permission_profiles (
      organization_id, name, description, is_admin,
      default_view, default_create, default_process, default_close,
      created_by, updated_by
    ) values (
      v_org.id, 'Agent',
      'Profil de reprise (RM-48) : équivalent au rôle agent avant les profils de droits — tous droits sur toutes les démarches, présentes et futures, sans administration.',
      false, true, true, true, true, null, null
    )
    on conflict (organization_id, lower(btrim(name))) do nothing
    returning id into v_agent_id;

    if v_agent_id is not null then
      insert into public.permission_audit_log
        (organization_id, actor_id, action, profile_id, profile_name, before, after)
      values (v_org.id, null, 'profile_created', v_agent_id, 'Agent', null,
              jsonb_build_object('is_admin', false,
                'default_rights', public.rights_array(true, true, true, true),
                'organizations', jsonb_build_array(v_org.socle_org_id)));
    else
      select id into v_agent_id from public.permission_profiles
       where organization_id = v_org.id and lower(btrim(name)) = 'agent';
    end if;

    insert into public.permission_profile_organizations (profile_id, socle_org_id)
    values (v_agent_id, v_org.socle_org_id)
    on conflict (profile_id, socle_org_id) do nothing;

    -- 4. Attribution selon organization_members.role — lue AVANT sa dérivation
    --    (M7 la redéfinit ensuite en colonne calculée à partir des profils).
    for v_member in
      select user_id, role from public.organization_members where organization_id = v_org.id
    loop
      insert into public.permission_profile_assignments (organization_id, profile_id, user_id, created_by)
      values (
        v_org.id,
        case when v_member.role = 'administrateur' then v_admin_id else v_agent_id end,
        v_member.user_id, null
      )
      on conflict (profile_id, user_id) do nothing
      returning profile_id into v_granted_id;

      if v_granted_id is not null then
        insert into public.permission_audit_log
          (organization_id, actor_id, action, profile_id, profile_name, target_user_id, before, after)
        values (
          v_org.id, null, 'assignment_granted', v_granted_id,
          case when v_member.role = 'administrateur' then 'Administrateur' else 'Agent' end,
          v_member.user_id, null,
          jsonb_build_object('profile_id', v_granted_id, 'user_id', v_member.user_id)
        );
      end if;
    end loop;

  end loop;
end;
$$;
