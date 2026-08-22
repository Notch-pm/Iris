-- ============================================================================
-- Profils de droits — M5/9 : RPC d'écriture (ADR-03) et d'exposition
-- (ADR-11), seule porte d'entrée cliente sur les 5 tables de M1 (aucune
-- policy d'écriture, M9 ne pose que des SELECT).
-- Réf : spec-profils-droits.md §3.C, §3.F à §3.K · correctif K de la relecture.
-- Convention d'appel PostgREST : paramètres nommés p_… ; save_permission_profile
-- prend un objet p jsonb unique et renvoie { id, version }.
-- Toutes SECURITY DEFINER, search_path = '', EXECUTE révoqué de PUBLIC/anon,
-- accordé à authenticated (RPC exposées) sauf le helper interne
-- assert_editor_can_manage_profile.
--
-- ⚠️ REDESIGN — deux vagues (2026-08-22), voir l'en-tête de
-- 20260822100300_profils_droits_gardes.sql pour le détail complet :
--
-- VAGUE 1 : les invariants RM-05/06/38/39/42 étaient portés par des
-- constraint triggers DIFFÉRÉS (M4, version précédente) — abandonnés après
-- vérification empirique : à l'intérieur d'une fonction SECURITY DEFINER
-- (TOUTES les RPC de ce fichier le sont), current_user devient le
-- PROPRIÉTAIRE de la fonction, y compris en profondeur derrière plusieurs
-- DEFINER imbriqués. is_service_context() (basée sur current_user) y est
-- donc TOUJOURS vraie, même pour un vrai client authentifié — les gardes
-- étaient intégralement court-circuitées ; et même corrigé, un trigger
-- DIFFÉRÉ s'exécute au COMMIT, APRÈS le retour de la RPC DEFINER, où
-- current_user est REVENU à authenticated (pas d'EXECUTE sur les fonctions
-- de garde, révoqué) → « permission denied » en production. Conséquence :
-- AUCUN constraint trigger différé ; les validations de M4 sont appelées
-- EXPLICITEMENT, IMMÉDIATEMENT, par les RPC ci-dessous. Ce piège s'applique
-- à TOUTE garde posée dans une fonction SECURITY DEFINER : ne jamais y
-- tester is_service_context() — utiliser is_platform_admin() (fondé sur
-- auth.uid(), lu depuis le GUC request.jwt.claims, insensible au
-- changement de current_user) pour un contournement RM-24, ou
-- current_setting('role', true) (reflète le rôle POSITIONNÉ PAR POSTGREST
-- POUR LA REQUÊTE, lui aussi insensible à SECURITY DEFINER — voir
-- user_has_request_right, M2) pour distinguer un appel client d'un appel
-- service_role.
--
-- VAGUE 2 : la non-escalade (RM-38) de save_permission_profile comparait
-- l'état POST-mutation aux droits de l'éditeur EXCLUANT le profil édité —
-- cassait RM-51 pour le cas ordinaire (un administrateur dont l'UNIQUE
-- profil est celui édité, ex. le fondateur avec son profil « Administrateur »
-- de reprise, n'avait plus AUCUN droit une fois ce profil exclu : impossible
-- de renommer ou de rétrécir son propre profil). Remplacé par une PRÉ-IMAGE
-- des droits de l'éditeur, capturée AVANT toute mutation (v_pre, voir
-- save_permission_profile) — jamais besoin d'exclure quoi que ce soit,
-- puisqu'on ne compare jamais un profil à sa propre version après édition.
-- assert_profile_within_editor_rights et les paramètres d'exclusion de
-- my_permission_pairs/has_admin_scope (M2) ont été SUPPRIMÉS en conséquence.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- assert_editor_can_manage_profile — RM-23/38/39/40 : le périmètre ET les
-- droits de l'éditeur bornent tout ce qu'il peut paramétrer. Vérifie
-- is_org_admin_anywhere (accès à la zone), PUIS has_admin_scope sur CHAQUE
-- organisation du périmètre ACTUEL du profil (RM-39), PUIS l'inclusion des
-- droits couple par couple (RM-38) — TOUJOURS sur l'état PRÉ-image (avant
-- toute mutation), SANS exclusion (aucune circularité possible : rien n'a
-- encore changé). Utilisée par :
--   • set_permission_profile_status / delete_permission_profile /
--     assign_permission_profile / revoke_permission_profile — ces
--     opérations NE CHANGENT PAS le périmètre/la matrice du profil
--     lui-même (seulement son statut ou qui le détient) ;
--   • save_permission_profile, EN TÊTE de la branche édition (p.profile_id
--     présent), AVANT toute mutation — c'est l'autorité sur le profil
--     EXISTANT : sans ce contrôle, un administrateur de sous-arbre pourrait
--     réécrire le profil « Administrateur » racine d'AUTRUI avec son propre
--     périmètre étroit (aucune autre garde ne protège spécifiquement le
--     profil CIBLE d'une édition — le pré-contrôle sur le périmètre
--     PROPOSÉ, déjà présent dans save_permission_profile, ne dit rien du
--     profil qu'on s'apprête à écraser).
-- La non-escalade sur le CONTENU proposé (RM-38 après édition) est portée
-- séparément par la pré-image de save_permission_profile (vague 2) — CETTE
-- fonction-ci ne regarde que l'état ACTUEL du profil visé, jamais ce qui est
-- proposé.
--
-- Contournement RM-24 : is_platform_admin() (JAMAIS is_service_context(),
-- voir l'en-tête du fichier) — un admin plateforme sans aucun profil doit
-- pouvoir dépanner un tenant verrouillé.
-- ----------------------------------------------------------------------------
create or replace function public.assert_editor_can_manage_profile(p_org_id uuid, p_profile_id uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_socle_org uuid; v_right text;
begin
  if public.is_platform_admin() then
    return;
  end if;
  if not public.is_org_admin_anywhere(p_org_id) then
    raise exception 'Accès réservé aux administrateurs.';
  end if;
  if p_profile_id is not null then
    for v_socle_org in
      select socle_org_id from public.permission_profile_organizations where profile_id = p_profile_id
    loop
      if not public.has_admin_scope(p_org_id, v_socle_org) then
        raise exception 'Votre périmètre d''administration ne couvre pas l''organisation %.',
          coalesce((select m.name from public.socle_organizations m
                     where m.organization_id = p_org_id and m.socle_id = v_socle_org),
                   v_socle_org::text);
      end if;
    end loop;

    foreach v_right in array array['consultation','creation','instruction','cloture'] loop
      if exists (
        select 1
          from public.permission_pairs_of(array[p_profile_id], v_right, p_org_id) x
         where not exists (
           select 1 from public.my_permission_pairs(v_right) y
            where y.organization_id = x.organization_id
              and y.socle_org_id = x.socle_org_id
              and y.socle_procedure_id = x.socle_procedure_id)
      ) then
        raise exception 'Ce profil porte le droit « % » que vous ne détenez pas vous-même sur tout son périmètre.', v_right;
      end if;
    end loop;
  end if;
end;
$$;
revoke execute on function public.assert_editor_can_manage_profile(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- save_permission_profile(p jsonb) — création OU édition (p.profile_id
-- présent). p = {
--   profile_id?: uuid, organization_id: uuid, name: text, description?: text,
--   is_admin: bool, default_rights: text[], organizations: uuid[],
--   procedures: [{ id: uuid, rights: text[] }], expected_version?: int
-- } → { id, version }
-- Étapes : 1) is_org_admin_anywhere + has_admin_scope sur le périmètre
-- PROPOSÉ (RM-23/39, immédiat, pré-mutation — message clair, correctif K) ;
-- 2) RM-05/06 immédiat (correctif B) ; 3) branche ÉDITION : autorité sur le
-- profil EXISTANT (assert_editor_can_manage_profile — RM-38/39/40, sans quoi
-- un admin de sous-arbre pourrait réécrire le profil racine d'autrui avec
-- son propre périmètre), PUIS verrou optimiste (RM-56) ; 4) PRÉ-IMAGE des
-- droits de l'éditeur (v_pre), capturée ICI, AVANT toute mutation (vague 2,
-- voir en-tête du fichier) ; 5) upsert en-tête, version+1 ; 6) delete/insert
-- périmètre et matrice ; 7) RE-VALIDATION POST-mutation (plus de trigger
-- différé) : validate_permission_profile_shape (RM-05/06 sur l'état
-- réellement écrit) ; RM-38 anti-escalade COUPLE PAR COUPLE en comparant le
-- profil ÉCRIT à v_pre (contournée UNIQUEMENT si is_platform_admin(),
-- RM-24) ; assert_tenant_keeps_root_admin (RM-42, sans AUCUN contournement)
-- — RM-39 n'est PAS revalidée ici : le pré-contrôle sur le périmètre
-- PROPOSÉ (étape 1) suffit, le périmètre écrit EST le périmètre proposé ;
-- 8) journal (RM-57) ; 9) refresh_member_roles. Toute exception après la
-- mutation annule l'INTÉGRALITÉ de l'appel (aucune insertion partielle : la
-- RPC est l'unique statement de la transaction implicite PostgREST).
-- ----------------------------------------------------------------------------
create or replace function public.save_permission_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id               uuid := nullif(p ->> 'profile_id', '')::uuid;
  v_org              uuid := (p ->> 'organization_id')::uuid;
  v_name             text := btrim(coalesce(p ->> 'name', ''));
  v_description      text := nullif(p ->> 'description', '');
  v_is_admin         boolean := coalesce((p ->> 'is_admin')::boolean, false);
  v_default_rights   text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'default_rights', '[]'::jsonb))), '{}');
  v_organizations    uuid[] := coalesce(array(select (jsonb_array_elements_text(coalesce(p -> 'organizations', '[]'::jsonb)))::uuid), '{}');
  v_procedures       jsonb  := coalesce(p -> 'procedures', '[]'::jsonb);
  v_expected_version int    := nullif(p ->> 'expected_version', '')::int;
  v_current_version  int;
  v_default_view boolean; v_default_create boolean; v_default_process boolean; v_default_close boolean;
  v_has_right   boolean;
  v_before jsonb; v_after jsonb; v_action text;
  v_item jsonb; v_rights text[]; v_view boolean; v_create boolean; v_process boolean; v_close boolean;
  v_socle_org uuid; v_right text;
  -- Pré-image des droits de l'éditeur (vague 2, item 1) : capturée AVANT
  -- toute mutation, dans le DECLARE — garantit qu'AUCUN statement du corps
  -- n'a pu s'exécuter avant ce calcul. Encodage plat « droit|org|scope|proc »
  -- (pas de table temporaire) pour une comparaison par égalité de texte.
  v_pre text[] := array(
    select r.code || '|' || y.organization_id || '|' || y.socle_org_id || '|' || y.socle_procedure_id
      from unnest(array['consultation','creation','instruction','cloture']) r(code),
      lateral public.my_permission_pairs(r.code) y
  );
begin
  if v_org is null then
    raise exception 'organization_id manquant.';
  end if;
  if v_name = '' then
    raise exception 'Le nom du profil est obligatoire.';
  end if;
  if array_length(v_organizations, 1) is null or array_length(v_organizations, 1) = 0 then
    raise exception 'Sélectionnez au moins une organisation.';
  end if;

  -- RM-23/39 immédiat, sur le périmètre PROPOSÉ (organisations seulement —
  -- pas les droits par couple, RM-38, qui exigent l'état RÉELLEMENT écrit,
  -- revalidés plus bas via la pré-image v_pre). Pré-mutation : le périmètre
  -- actuel du profil n'a pas encore changé, aucune circularité possible.
  if not public.is_org_admin_anywhere(v_org) then
    raise exception 'Accès réservé aux administrateurs.';
  end if;
  foreach v_socle_org in array v_organizations loop
    if not public.has_admin_scope(v_org, v_socle_org) then
      raise exception 'Votre périmètre d''administration ne couvre pas l''organisation %.',
        coalesce((select m.name from public.socle_organizations m
                   where m.organization_id = v_org and m.socle_id = v_socle_org),
                 v_socle_org::text);
    end if;
  end loop;

  v_default_view    := coalesce(array_length(v_default_rights, 1), 0) > 0;
  v_default_create  := 'creation'    = any(v_default_rights);
  v_default_process := 'instruction' = any(v_default_rights);
  v_default_close   := 'cloture'     = any(v_default_rights);

  -- RM-06 immédiat (correctif B) : au moins un droit de consultation quelque
  -- part (défaut ou une ligne de matrice), sauf profil d'administration pure.
  select v_default_view or exists (
    select 1 from jsonb_array_elements(v_procedures) e
     where jsonb_array_length(coalesce(e -> 'rights', '[]'::jsonb)) > 0
  ) into v_has_right;
  if not v_is_admin and not v_has_right then
    raise exception 'Ce profil n''accorderait aucun droit.';
  end if;

  if v_id is not null then
    select version, jsonb_build_object(
             'name', name, 'description', description, 'is_admin', is_admin, 'status', status,
             'default_rights', public.rights_array(default_view, default_create, default_process, default_close),
             'organizations', (select coalesce(jsonb_agg(socle_org_id), '[]'::jsonb)
                                  from public.permission_profile_organizations where profile_id = v_id),
             'procedures', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', socle_procedure_id,
                                'rights', public.rights_array(right_view, right_create, right_process, right_close))), '[]'::jsonb)
                               from public.permission_profile_procedures where profile_id = v_id))
      into v_current_version, v_before
      from public.permission_profiles where id = v_id and organization_id = v_org;
    if v_current_version is null then
      raise exception 'Profil de droits introuvable.';
    end if;

    -- Autorité sur le profil EXISTANT (item 1.a) : état pré-image, sans
    -- exclusion — voir assert_editor_can_manage_profile ci-dessus. Empêche
    -- un admin de sous-arbre de réécrire le profil racine d'un tiers avec
    -- son propre périmètre.
    perform public.assert_editor_can_manage_profile(v_org, v_id);

    if v_expected_version is null or v_expected_version <> v_current_version then
      raise exception 'Ce profil a été modifié entre-temps par quelqu''un d''autre ; rechargez avant de réessayer.';
    end if;

    update public.permission_profiles
       set name = v_name, description = v_description, is_admin = v_is_admin,
           default_view = v_default_view, default_create = v_default_create,
           default_process = v_default_process, default_close = v_default_close,
           version = version + 1, updated_at = now(), updated_by = auth.uid()
     where id = v_id
     returning version into v_current_version;

    delete from public.permission_profile_organizations where profile_id = v_id;
    delete from public.permission_profile_procedures where profile_id = v_id;
    v_action := 'profile_updated';
  else
    insert into public.permission_profiles (
      organization_id, name, description, is_admin,
      default_view, default_create, default_process, default_close,
      created_by, updated_by
    ) values (
      v_org, v_name, v_description, v_is_admin,
      v_default_view, v_default_create, v_default_process, v_default_close,
      auth.uid(), auth.uid()
    ) returning id, version into v_id, v_current_version;
    v_before := null;
    v_action := 'profile_created';
  end if;

  insert into public.permission_profile_organizations (profile_id, socle_org_id)
  select distinct v_id, x from unnest(v_organizations) as x;

  for v_item in select * from jsonb_array_elements(v_procedures) loop
    v_rights  := array(select jsonb_array_elements_text(coalesce(v_item -> 'rights', '[]'::jsonb)));
    v_view    := coalesce(array_length(v_rights, 1), 0) > 0;
    v_create  := 'creation'    = any(v_rights);
    v_process := 'instruction' = any(v_rights);
    v_close   := 'cloture'     = any(v_rights);
    insert into public.permission_profile_procedures
      (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values
      (v_id, (v_item ->> 'id')::uuid, v_view, v_create, v_process, v_close)
    on conflict (profile_id, socle_procedure_id) do update
      set right_view = excluded.right_view, right_create = excluded.right_create,
          right_process = excluded.right_process, right_close = excluded.right_close;
  end loop;

  -- Re-validation POST-mutation (plus de trigger différé) — voir en-tête.
  perform public.validate_permission_profile_shape(v_id);

  -- RM-38 anti-escalade par PRÉ-IMAGE (item 1, vague 2) : le profil ÉCRIT
  -- (permission_pairs_of sur v_id, l'état RÉEL après mutation) ne doit
  -- accorder AUCUN couple absent de v_pre (les droits de l'éditeur AVANT
  -- cette édition). Remplace l'exclusion post-mutation (cassait RM-51 pour
  -- l'éditeur dont l'unique profil est celui édité — voir en-tête du
  -- fichier). Contournée UNIQUEMENT si is_platform_admin() (RM-24).
  if not public.is_platform_admin() then
    foreach v_right in array array['consultation','creation','instruction','cloture'] loop
      if exists (
        select 1 from public.permission_pairs_of(array[v_id], v_right, v_org) x
         where not ((v_right || '|' || x.organization_id || '|' || x.socle_org_id || '|' || x.socle_procedure_id) = any(v_pre))
      ) then
        raise exception 'Ce profil accorderait le droit « % » que vous ne détenez pas vous-même sur tout son périmètre.', v_right;
      end if;
    end loop;
  end if;

  -- RM-42, sans contournement — voir l'en-tête du fichier de garde (M4).
  -- Pas de revalidation RM-39 ici : le pré-contrôle sur le périmètre
  -- PROPOSÉ (plus haut) suffit, le périmètre écrit EST le périmètre proposé.
  perform public.assert_tenant_keeps_root_admin(v_org);

  v_after := jsonb_build_object(
    'name', v_name, 'description', v_description, 'is_admin', v_is_admin,
    'default_rights', public.rights_array(v_default_view, v_default_create, v_default_process, v_default_close),
    'organizations', to_jsonb(v_organizations),
    'procedures', v_procedures
  );
  insert into public.permission_audit_log
    (organization_id, actor_id, action, profile_id, profile_name, before, after)
  values (v_org, auth.uid(), v_action, v_id, v_name, v_before, v_after);

  perform public.refresh_member_roles(v_org);

  return jsonb_build_object('id', v_id, 'version', v_current_version);
end;
$$;
comment on function public.save_permission_profile(jsonb) is
  'Création/édition atomique d''un profil de droits (en-tête + périmètre + matrice). Pré-contrôles RM-05/06/23/39 immédiats ; en édition, autorité sur le profil EXISTANT (assert_editor_can_manage_profile) ; RM-38 (couple par couple, pré-image v_pre) et RM-42 revalidés IMMÉDIATEMENT après la mutation (plus de trigger différé — piège DEFINER/current_user, voir en-tête du fichier).';
revoke execute on function public.save_permission_profile(jsonb) from public, anon;
grant  execute on function public.save_permission_profile(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- set_permission_profile_status(p_profile_id, p_status, p_expected_version)
-- Activation/désactivation (RM-52). Pré-contrôle assert_editor_can_manage_profile
-- (RM-38/39/40, pré-mutation, sans exclusion). RM-42 revalidé IMMÉDIATEMENT
-- après l'UPDATE (assert_tenant_keeps_root_admin, sans contournement) si
-- p_status='inactive' désactive le dernier profil admin racine — plus de
-- trigger différé, voir l'en-tête du fichier.
-- ----------------------------------------------------------------------------
create or replace function public.set_permission_profile_status(
  p_profile_id uuid, p_status text, p_expected_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_current_version int; v_before jsonb;
begin
  if p_status not in ('active', 'inactive') then
    raise exception 'Statut invalide : %.', p_status;
  end if;

  select organization_id, name, version into v_org, v_name, v_current_version
    from public.permission_profiles where id = p_profile_id;
  if v_org is null then
    raise exception 'Profil de droits introuvable.';
  end if;
  perform public.assert_editor_can_manage_profile(v_org, p_profile_id);
  if p_expected_version is null or p_expected_version <> v_current_version then
    raise exception 'Ce profil a été modifié entre-temps par quelqu''un d''autre ; rechargez avant de réessayer.';
  end if;

  v_before := jsonb_build_object('status',
    (select status from public.permission_profiles where id = p_profile_id));

  update public.permission_profiles
     set status = p_status, version = version + 1, updated_at = now(), updated_by = auth.uid()
   where id = p_profile_id
   returning version into v_current_version;

  perform public.assert_tenant_keeps_root_admin(v_org);

  insert into public.permission_audit_log
    (organization_id, actor_id, action, profile_id, profile_name, before, after)
  values (v_org, auth.uid(),
          case when p_status = 'active' then 'profile_activated' else 'profile_deactivated' end,
          p_profile_id, v_name, v_before, jsonb_build_object('status', p_status));

  perform public.refresh_member_roles(v_org);
  return jsonb_build_object('id', p_profile_id, 'version', v_current_version);
end;
$$;
revoke execute on function public.set_permission_profile_status(uuid, text, int) from public, anon;
grant  execute on function public.set_permission_profile_status(uuid, text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- delete_permission_profile(p_profile_id, p_expected_version) — RM-52 : refuse
-- s'il reste des attributions (désactiver plutôt que supprimer). Aucun appel
-- à assert_tenant_keeps_root_admin ici : zéro attribution ⇒ zéro admin actif
-- retiré, l'invariant ne peut pas être cassé par cette RPC.
-- ----------------------------------------------------------------------------
create or replace function public.delete_permission_profile(p_profile_id uuid, p_expected_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_current_version int; v_before jsonb;
begin
  select organization_id, name, version into v_org, v_name, v_current_version
    from public.permission_profiles where id = p_profile_id;
  if v_org is null then
    raise exception 'Profil de droits introuvable.';
  end if;
  perform public.assert_editor_can_manage_profile(v_org, p_profile_id);
  if p_expected_version is null or p_expected_version <> v_current_version then
    raise exception 'Ce profil a été modifié entre-temps par quelqu''un d''autre ; rechargez avant de réessayer.';
  end if;
  if exists (select 1 from public.permission_profile_assignments where profile_id = p_profile_id) then
    raise exception 'Ce profil est attribué à au moins un utilisateur : désactivez-le plutôt que de le supprimer.';
  end if;

  v_before := jsonb_build_object(
    'name', v_name,
    'organizations', (select coalesce(jsonb_agg(socle_org_id), '[]'::jsonb)
                         from public.permission_profile_organizations where profile_id = p_profile_id));

  delete from public.permission_profiles where id = p_profile_id;

  insert into public.permission_audit_log
    (organization_id, actor_id, action, profile_id, profile_name, before, after)
  values (v_org, auth.uid(), 'profile_deleted', p_profile_id, v_name, v_before, null);

  perform public.refresh_member_roles(v_org);
  return jsonb_build_object('id', p_profile_id);
end;
$$;
revoke execute on function public.delete_permission_profile(uuid, int) from public, anon;
grant  execute on function public.delete_permission_profile(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- assign_permission_profile / revoke_permission_profile — RM-40. Idempotentes
-- (attribuer/retirer deux fois de suite ne lève pas d'erreur) ; le message
-- « pas membre du tenant » est donné AVANT l'insertion pour ne pas dépendre
-- du texte générique d'une violation de FK composite. assign : pré-contrôle
-- assert_editor_can_manage_profile suffit (RM-40 complet, y compris contre
-- l'auto-attribution d'un profil plus large, CL-15b) — une attribution ne
-- peut jamais réduire la couverture admin du tenant, donc aucun appel à
-- assert_tenant_keeps_root_admin après. revoke : le même pré-contrôle, PUIS
-- assert_tenant_keeps_root_admin IMMÉDIATEMENT après le DELETE (RM-42, sans
-- contournement) — plus de trigger différé, voir l'en-tête du fichier.
-- ----------------------------------------------------------------------------
create or replace function public.assign_permission_profile(p_profile_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_inserted_id uuid;
begin
  select organization_id, name into v_org, v_name
    from public.permission_profiles where id = p_profile_id;
  if v_org is null then
    raise exception 'Profil de droits introuvable.';
  end if;
  perform public.assert_editor_can_manage_profile(v_org, p_profile_id);
  if not exists (select 1 from public.organization_members
                  where organization_id = v_org and user_id = p_user_id) then
    raise exception 'Cet utilisateur n''est pas membre de ce tenant.';
  end if;

  insert into public.permission_profile_assignments (organization_id, profile_id, user_id, created_by)
  values (v_org, p_profile_id, p_user_id, auth.uid())
  on conflict (profile_id, user_id) do nothing
  returning profile_id into v_inserted_id;

  if v_inserted_id is not null then
    insert into public.permission_audit_log
      (organization_id, actor_id, action, profile_id, profile_name, target_user_id, before, after)
    values (v_org, auth.uid(), 'assignment_granted', p_profile_id, v_name, p_user_id, null,
            jsonb_build_object('profile_id', p_profile_id, 'user_id', p_user_id));
    perform public.refresh_member_roles(v_org);
  end if;
  return jsonb_build_object('profile_id', p_profile_id, 'user_id', p_user_id);
end;
$$;
revoke execute on function public.assign_permission_profile(uuid, uuid) from public, anon;
grant  execute on function public.assign_permission_profile(uuid, uuid) to authenticated;

create or replace function public.revoke_permission_profile(p_profile_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_deleted_id uuid;
begin
  select organization_id, name into v_org, v_name
    from public.permission_profiles where id = p_profile_id;
  if v_org is null then
    raise exception 'Profil de droits introuvable.';
  end if;
  perform public.assert_editor_can_manage_profile(v_org, p_profile_id);

  delete from public.permission_profile_assignments
   where profile_id = p_profile_id and user_id = p_user_id
  returning profile_id into v_deleted_id;

  if v_deleted_id is not null then
    perform public.assert_tenant_keeps_root_admin(v_org);

    insert into public.permission_audit_log
      (organization_id, actor_id, action, profile_id, profile_name, target_user_id, before, after)
    values (v_org, auth.uid(), 'assignment_revoked', p_profile_id, v_name, p_user_id,
            jsonb_build_object('profile_id', p_profile_id, 'user_id', p_user_id), null);
    perform public.refresh_member_roles(v_org);
  end if;
  return jsonb_build_object('profile_id', p_profile_id, 'user_id', p_user_id);
end;
$$;
revoke execute on function public.revoke_permission_profile(uuid, uuid) from public, anon;
grant  execute on function public.revoke_permission_profile(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- my_rights(p_org_id) — ADR-11, correctif H : PAS de organization_ids
-- (redondant) ; scope_organization_ids = périmètre EXPANSÉ (indépendant des
-- droits) ; procedures = objet {socle_procedure_id: [droits]} ; default =
-- [droits] ; is_admin/status/id/name par profil ; is_admin racine =
-- is_org_admin_anywhere. Libellés de droits : consultation|creation|
-- instruction|cloture (H).
-- ----------------------------------------------------------------------------
create or replace function public.my_rights(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'Ressource introuvable.';
  end if;
  select jsonb_build_object(
    'organization_id', p_org_id,
    'is_platform_admin', public.is_platform_admin(),
    'is_admin', public.is_org_admin_anywhere(p_org_id),
    'no_procedure_id', public.nil_procedure(),
    'profiles', coalesce(jsonb_agg(x.profile order by x.name), '[]'::jsonb)
  ) into v
  from (
    select p.name, jsonb_build_object(
      'id', p.id, 'name', p.name, 'status', p.status, 'is_admin', p.is_admin,
      'scope_organization_ids', (
        select coalesce(jsonb_agg(distinct t.socle_org_id), '[]'::jsonb)
          from public.permission_profile_scope(p.id) t),
      'procedures', (
        select coalesce(jsonb_object_agg(pp.socle_procedure_id, public.rights_array(
                 pp.right_view, pp.right_create, pp.right_process, pp.right_close)), '{}'::jsonb)
          from public.permission_profile_procedures pp where pp.profile_id = p.id),
      'default', public.rights_array(p.default_view, p.default_create,
                                     p.default_process, p.default_close)
    ) as profile
    from public.permission_profiles p
    join public.permission_profile_assignments a on a.profile_id = p.id and a.user_id = auth.uid()
   where p.organization_id = p_org_id
  ) x;
  return v;
end;
$$;
comment on function public.my_rights(uuid) is
  'Profils de l''appelant dans un tenant, périmètre déjà expansé côté serveur. Miroir exact attendu côté front : src/features/rights/rights.ts (RM-46).';
revoke execute on function public.my_rights(uuid) from public, anon;
grant  execute on function public.my_rights(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- eligible_assignees(p_request_id) — RM-16 : l'UI ne calcule jamais les
-- droits d'autrui. Exige can_read_request par l'APPELANT.
-- ----------------------------------------------------------------------------
create or replace function public.eligible_assignees(p_request_id uuid)
returns table (user_id uuid, display_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_dest uuid; v_proc uuid;
begin
  if not public.can_read_request(p_request_id) then
    raise exception 'Demande introuvable.';
  end if;
  select r.organization_id, r.socle_organization_id, r.socle_procedure_id
    into v_org, v_dest, v_proc
    from public.requests r where r.id = p_request_id;

  return query
    select m.user_id,
           coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email),
           u.email
      from public.organization_members m
      join public.users u on u.id = m.user_id
     where m.organization_id = v_org
       and public.user_has_request_right(m.user_id, v_org, v_dest, v_proc, 'instruction')
     order by 2;
end;
$$;
comment on function public.eligible_assignees(uuid) is
  'Membres du tenant détenant instruction sur le couple de la demande (RM-16). Alimente le sélecteur d''affectation — n''expose jamais les droits d''un membre inéligible.';
revoke execute on function public.eligible_assignees(uuid) from public, anon;
grant  execute on function public.eligible_assignees(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- permission_coverage_report(p_org_id) — RM-62. HORS RLS par construction
-- (SECURITY DEFINER + requête directe sur requests, PAS une vue
-- security_invoker qui appliquerait le RLS de l'appelant et compterait zéro
-- demande précisément là où il y en a). Exige is_org_admin_anywhere.
-- ----------------------------------------------------------------------------
create or replace function public.permission_coverage_report(p_org_id uuid)
returns table (
  socle_org_id uuid, org_name text,
  socle_procedure_id uuid, procedure_name text,
  open_requests int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_org_admin_anywhere(p_org_id) then
    raise exception 'Accès réservé aux administrateurs.';
  end if;
  return query
    with covered as (
      select distinct s.socle_org_id, s.socle_procedure_id
        from public.permission_pairs_of(
               array(select a.profile_id
                       from public.permission_profile_assignments a
                       join public.permission_profiles p on p.id = a.profile_id
                      where p.organization_id = p_org_id and p.status = 'active'),
               'instruction', p_org_id) s
    ),
    pairs as (
      select m.socle_id as p_socle_org_id, m.name as p_org_name,
             c.socle_id as p_socle_procedure_id, c.name as p_procedure_name
        from public.socle_organizations m
        cross join public.socle_procedure_cache c
       where m.organization_id = p_org_id and m.obsoleted_at is null
         and c.organization_id = p_org_id and c.obsoleted_at is null
    )
    select pr.p_socle_org_id, pr.p_org_name, pr.p_socle_procedure_id, pr.p_procedure_name,
           (select count(*)::int from public.requests r
              where r.organization_id = p_org_id
                and r.socle_scope_org_id = pr.p_socle_org_id
                and r.socle_procedure_id = pr.p_socle_procedure_id
                and r.status not in ('annulee','resolue_positive','resolue_negative','archivee')
           )
      from pairs pr
     where not exists (select 1 from covered cv
                         where cv.socle_org_id = pr.p_socle_org_id
                           and cv.socle_procedure_id = pr.p_socle_procedure_id);
end;
$$;
comment on function public.permission_coverage_report(uuid) is
  'RM-62 : couples (organisation × démarche active) qu''aucun profil actif ET attribué ne couvre au niveau instruction, avec le nombre de demandes non terminales concernées. Garde-fou du fail closed.';
revoke execute on function public.permission_coverage_report(uuid) from public, anon;
grant  execute on function public.permission_coverage_report(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- members_without_profile(p_org_id) — RM-63.
-- ----------------------------------------------------------------------------
create or replace function public.members_without_profile(p_org_id uuid)
returns table (user_id uuid, display_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_org_admin_anywhere(p_org_id) then
    raise exception 'Accès réservé aux administrateurs.';
  end if;
  return query
    select m.user_id,
           coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email),
           u.email
      from public.organization_members m
      join public.users u on u.id = m.user_id
     where m.organization_id = p_org_id
       and not exists (
         select 1 from public.permission_profile_assignments a
           join public.permission_profiles p on p.id = a.profile_id and p.status = 'active'
          where a.organization_id = p_org_id and a.user_id = m.user_id
       )
     order by 2;
end;
$$;
comment on function public.members_without_profile(uuid) is
  'RM-63 : membres du tenant sans aucune attribution active. Affichée en tête des Paramètres.';
revoke execute on function public.members_without_profile(uuid) from public, anon;
grant  execute on function public.members_without_profile(uuid) to authenticated;
