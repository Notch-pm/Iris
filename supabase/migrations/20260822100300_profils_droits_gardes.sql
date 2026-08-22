-- ============================================================================
-- Profils de droits — M4/9 : fonctions de garde d'intégrité (RM-05, RM-06,
-- RM-42). Réf : spec-profils-droits.md §3.A, §3.F ·
-- architecture-profils-droits.md ADR-03/08/09 + correctifs A et B — CE
-- FICHIER REMPLACE la partie « constraint triggers différés » de ces ADR.
-- Deux vagues de redesign successives (2026-08-22, relecture + vérification
-- empirique, PUIS revue de sécurité indépendante) :
--
-- VAGUE 1 — abandon des constraint triggers différés. Piège SECURITY DEFINER
-- / current_user (vérifié empiriquement, transaction annulée) :
--   • À l'intérieur d'une fonction SECURITY DEFINER, current_user devient le
--     PROPRIÉTAIRE de la fonction (ex. postgres) — y compris en cascade
--     depuis une AUTRE fonction SECURITY DEFINER : le changement n'est PAS
--     « ré-empilé » par appelant, il s'applique dès qu'on entre dans LA
--     PREMIÈRE fonction DEFINER de la pile d'appel.
--   • is_service_context() teste current_user — appelée depuis une fonction
--     DEFINER, elle vaut donc TOUJOURS true, même pour un vrai client
--     authentifié passé par une RPC de M5 (elles sont toutes DEFINER).
--   • Même corrigé : un trigger DIFFÉRÉ s'exécute au COMMIT, APRÈS le retour
--     de la fonction DEFINER — current_user y est REVENU à authenticated,
--     qui n'a pas l'EXECUTE sur les fonctions de garde (révoqué) →
--     « permission denied » sur chaque écriture en production.
-- DÉCISION 1 : aucun constraint trigger différé. Les 5 tables de profils
-- n'ont AUCUNE policy d'écriture cliente (M9) : les RPC de M5 sont l'unique
-- chemin d'écriture non-service (même posture que t16_requests_require_procedure).
--
-- VAGUE 2 — abandon de l'exclusion post-mutation pour la non-escalade
-- (RM-38). Problème découvert : un administrateur dont l'UNIQUE profil est
-- celui édité (ex. le fondateur, dont le seul profil est « Administrateur »
-- de reprise, RM-51) avait, une fois ce profil EXCLU de ses propres droits,
-- un ensemble de droits VIDE — tout renommage ou rétrécissement de son
-- propre profil échouait à tort. DÉCISION 2 : remplacer l'exclusion
-- post-mutation par une PRÉ-IMAGE des droits de l'éditeur, capturée AVANT
-- toute mutation (donc reflétant fidèlement ce qu'il détenait avant CET
-- appel, profil édité compris) — comparée à l'état du profil APRÈS mutation.
-- Cette logique vit désormais DIRECTEMENT dans save_permission_profile (M5),
-- pas dans une fonction séparée : assert_profile_within_editor_rights et le
-- paramètre d'exclusion de my_permission_pairs/has_admin_scope (M2) ont été
-- SUPPRIMÉS (moins de surface — ils n'avaient plus qu'un seul appelant,
-- devenu incorrect). RM-39 (périmètre admin) n'a besoin d'AUCUNE
-- revalidation post-mutation séparée : le pré-contrôle has_admin_scope sur
-- le périmètre PROPOSÉ (déjà en place dans save_permission_profile, état
-- pré-image, sans exclusion) suffit et est correct — le périmètre écrit EST
-- le périmètre proposé, déjà vérifié avant l'écriture.
--
-- Les deux fonctions restantes sont des fonctions PURES appelables
-- EXPLICITEMENT par les RPC de M5, à l'endroit qui convient :
--   • validate_permission_profile_shape — RM-05/06, POST-mutation dans
--     save_permission_profile (filet : la RPC valide déjà les données
--     PROPOSÉES avant écriture, correctif B).
--   • assert_tenant_keeps_root_admin — RM-42, POST-mutation dans
--     save_permission_profile / set_permission_profile_status /
--     revoke_permission_profile. S'applique À TOUT LE MONDE, admin
--     plateforme compris (RM-24 ne dispense pas de cet invariant : un admin
--     plateforme qui retire le dernier administrateur racine sans en ajouter
--     un autre casserait quand même la propriété que l'invariant garantit).
-- Ni l'une ni l'autre n'appelle is_service_context() ni is_platform_admin()
-- elle-même : le contournement RM-24 (admin plateforme) est décidé PAR
-- L'APPELANT (M5), au cas par cas, JAMAIS à l'intérieur d'une fonction
-- DEFINER — leçon de la vague 1, applicable à tout le projet.
--
-- L'autorité complète RM-38/39/40 sur les opérations qui NE CHANGENT PAS le
-- contenu d'un profil (statut, suppression, attribution, révocation) reste
-- assert_editor_can_manage_profile (M5, pré-mutation, sans exclusion — voir
-- ce fichier).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- validate_permission_profile_shape — RM-05 (≥ 1 organisation) et RM-06
-- (≥ 1 droit OU administration=oui). Appelée par save_permission_profile
-- (M5) immédiatement APRÈS la mutation (elle lit l'état committed-in-
-- transaction du profil) — la RPC valide déjà la même chose sur les données
-- PROPOSÉES avant d'écrire (message clair, correctif B) ; cet appel est le
-- filet qui garantit que ce qui a été ÉCRIT correspond à ce qui a été
-- validé, quelle que soit l'évolution future de la RPC.
-- ----------------------------------------------------------------------------
create or replace function public.validate_permission_profile_shape(p_profile_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_is_admin     boolean;
  v_default_view boolean;
  v_has_org      boolean;
  v_has_right    boolean;
begin
  select is_admin, default_view into v_is_admin, v_default_view
    from public.permission_profiles where id = p_profile_id;
  if v_is_admin is null then
    return;  -- profil introuvable (supprimé dans la même transaction) : rien à valider
  end if;

  select exists(select 1 from public.permission_profile_organizations where profile_id = p_profile_id)
    into v_has_org;
  if not v_has_org then
    raise exception 'Sélectionnez au moins une organisation.';
  end if;

  select v_default_view or exists (
    select 1 from public.permission_profile_procedures pp
     where pp.profile_id = p_profile_id and pp.right_view
  ) into v_has_right;
  if not v_is_admin and not v_has_right then
    raise exception 'Ce profil n''accorderait aucun droit.';
  end if;
end;
$$;
comment on function public.validate_permission_profile_shape(uuid) is
  'RM-05/RM-06 : au moins une organisation ; au moins un droit de consultation (défaut ou matrice) sauf si administration=oui. Appelée par save_permission_profile (M5) après la mutation.';
revoke execute on function public.validate_permission_profile_shape(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- assert_tenant_keeps_root_admin — RM-42, invariant du dernier administrateur.
-- Appelée par save_permission_profile, set_permission_profile_status et
-- revoke_permission_profile (M5), TOUJOURS après la mutation concernée,
-- SANS AUCUN contournement (RM-24 ne s'applique pas à cet invariant : voir
-- l'en-tête du fichier).
-- ----------------------------------------------------------------------------
create or replace function public.assert_tenant_keeps_root_admin(p_org_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_root uuid;
begin
  select socle_org_id into v_root from public.organizations where id = p_org_id;
  if v_root is null then
    return;  -- tenant supprimé dans la même transaction
  end if;
  if not exists (
    select 1
      from public.permission_profile_assignments a
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_admin
      join public.permission_profile_organizations po
        on po.profile_id = p.id and po.socle_org_id = v_root
     where a.organization_id = p_org_id
  ) then
    raise exception 'Le tenant doit conserver au moins un administrateur sur l''organisation racine.';
  end if;
end;
$$;
comment on function public.assert_tenant_keeps_root_admin(uuid) is
  'RM-42 : au moins un utilisateur détenant administration sur la racine Socle du tenant, en permanence. Aucun contournement, admin plateforme compris.';
revoke execute on function public.assert_tenant_keeps_root_admin(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Fonction retirée dans cette migration (rejouable) : assert_profile_within_editor_rights
-- n'a plus d'appelant (vague 2, voir en-tête) — DROP explicite pour ne pas
-- laisser une fonction DEFINER orpheline, potentiellement trompeuse pour une
-- relecture future.
-- ----------------------------------------------------------------------------
drop function if exists public.assert_profile_within_editor_rights(uuid, boolean);
