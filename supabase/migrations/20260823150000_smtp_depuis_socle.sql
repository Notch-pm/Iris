-- ============================================================================
-- Le serveur d'envoi VIENT DU SOCLE — il ne se saisit plus dans Iris.
-- Décision PO du 2026-08-23 (rectification de la livraison du matin, qui avait
-- doublonné dans Iris la saisie du SMTP, comme le fait Clara).
--
-- Invariant de la gamme : « Socle est la source de vérité ». Le relais de
-- messagerie d'une collectivité est défini UNE fois, dans le Socle, à
-- l'organisation principale (onglet « Emails (SMTP) », visible sur la seule
-- racine). Iris n'en garde qu'un MIROIR, rafraîchi à chaque synchronisation du
-- référentiel (`sync-socle-referentiel`) — au même titre que le miroir des
-- organisations et le cache des démarches.
--
-- Ce que cette migration défait (livré le matin même) :
--   • `save_smtp_settings` / `delete_smtp_settings` — la saisie dans Iris ;
--   • la lecture cliente de `smtp_settings` (l'écran Paramètres › Messagerie
--     disparaît) ;
--   • `is_tenant_root_admin` / `is_tenant_root_admin_for` — gardes créées pour
--     réserver cette saisie à la racine ; sans saisie, elles n'ont plus d'objet.
--
-- Ce qu'elle pose : deux RPC de SERVICE, unique porte d'écriture du miroir.
-- Le mot de passe continue de vivre au VAULT Postgres — Iris ne réplique pas la
-- dette « mot de passe SMTP en clair » (que Socle et Clara portent encore) : il
-- traverse le réseau, il ne se pose pas en clair dans une colonne.
--
-- La ligne déjà saisie à la main dans l'écran (tenant ACCM) est CONSERVÉE : les
-- mails continuent de partir jusqu'à la première synchronisation, qui la
-- remplacera par ce que déclare le Socle. `socle_org_id` et `socle_updated_at`
-- restent nuls tant que cette synchronisation n'a pas eu lieu — c'est le signe
-- d'une ligne d'origine manuelle.
--
-- Rejouable : IF EXISTS / OR REPLACE partout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Retrait de la saisie dans Iris
-- ----------------------------------------------------------------------------
drop function if exists public.save_smtp_settings(uuid, text, integer, text, text, text, text, boolean);
drop function if exists public.delete_smtp_settings(uuid);
drop function if exists public.is_tenant_root_admin(uuid);
drop function if exists public.is_tenant_root_admin_for(uuid, uuid);

-- Plus aucune lecture cliente : l'écran Messagerie n'existe plus, et ce qui
-- n'est pas exposé ne peut pas fuir. La configuration se consulte dans le
-- Socle, qui la détient.
drop policy if exists smtp_settings_select_admin on public.smtp_settings;
revoke all on table public.smtp_settings from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. La table devient un miroir : provenance et fraîcheur, plus d'auteur
-- ----------------------------------------------------------------------------
alter table public.smtp_settings
  drop column if exists updated_by,
  drop column if exists updated_at,
  add  column if not exists socle_org_id     uuid,
  add  column if not exists socle_updated_at timestamptz,
  add  column if not exists synced_at        timestamptz not null default now();

comment on table public.smtp_settings is
  'MIROIR du serveur d''envoi défini dans le Socle pour l''organisation principale du tenant. Écrit uniquement par sync_smtp_settings_from_socle (synchronisation du référentiel) — aucune saisie dans Iris.';
comment on column public.smtp_settings.socle_org_id is
  'Organisation Socle (racine du tenant) d''où vient cette configuration.';
comment on column public.smtp_settings.socle_updated_at is
  'Date de dernière modification côté Socle, telle que servie par son API — sert au diagnostic.';
comment on column public.smtp_settings.synced_at is
  'Date de la synchronisation qui a écrit cette ligne.';
comment on column public.smtp_settings.password_secret_id is
  'Identifiant du secret Vault portant le mot de passe SMTP reçu du Socle. JAMAIS lisible par un client — déchiffré côté service seulement.';

-- ----------------------------------------------------------------------------
-- 3. sync_smtp_settings_from_socle — unique porte d'écriture (SERVICE).
--
-- Miroir STRICT : ce que le Socle sert fait foi, y compris l'absence de mot de
-- passe (relais sans authentification) — le secret Vault est alors supprimé.
-- C'est la différence avec l'ancienne RPC de saisie, où un champ vide valait
-- « inchangé » : ici il n'y a pas un utilisateur qui omet, il y a une source
-- qui déclare.
--
-- ⚠️ Ne teste pas `is_service_context()` : dans une fonction DEFINER,
--    `current_user` vaut toujours le propriétaire (piège vérifié le
--    2026-08-22, CLAUDE.md). La garde est le GRANT : service_role seul.
-- ----------------------------------------------------------------------------
create or replace function public.sync_smtp_settings_from_socle(
  p_org_id           uuid,
  p_socle_org_id     uuid,
  p_host             text,
  p_port             integer,
  p_username         text,
  p_password         text,
  p_from_email       text,
  p_from_name        text,
  p_use_tls          boolean,
  p_socle_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_existing_secret uuid;
  v_secret_id       uuid;
  v_host            text    := btrim(coalesce(p_host, ''));
  v_from            text    := lower(btrim(coalesce(p_from_email, '')));
  v_port            integer := coalesce(p_port, 587);
  v_password        text    := coalesce(p_password, '');
begin
  if v_host = '' or v_from = '' then
    raise exception 'Serveur d''envoi incomplet : hôte et adresse d''expédition requis.'
      using errcode = '22023';
  end if;
  if v_port < 1 or v_port > 65535 then
    v_port := 587;
  end if;

  select s.password_secret_id into v_existing_secret
    from public.smtp_settings s where s.organization_id = p_org_id;

  if v_password <> '' then
    if v_existing_secret is null then
      v_secret_id := vault.create_secret(
        v_password,
        'iris_smtp_' || p_org_id::text,
        'Mot de passe SMTP du tenant Iris ' || p_org_id::text || ' (miroir du Socle)'
      );
    else
      perform vault.update_secret(v_existing_secret, v_password);
      v_secret_id := v_existing_secret;
    end if;
  else
    -- Le Socle ne déclare aucun mot de passe : le miroir n'en garde pas non plus.
    v_secret_id := null;
    if v_existing_secret is not null then
      delete from vault.secrets v where v.id = v_existing_secret;
    end if;
  end if;

  insert into public.smtp_settings (
    organization_id, socle_org_id, host, port, username, password_secret_id,
    from_email, from_name, use_tls, socle_updated_at, synced_at
  ) values (
    p_org_id, p_socle_org_id, v_host, v_port,
    nullif(btrim(coalesce(p_username, '')), ''),
    v_secret_id, v_from,
    nullif(btrim(coalesce(p_from_name, '')), ''),
    coalesce(p_use_tls, true), p_socle_updated_at, now()
  )
  on conflict (organization_id) do update set
    socle_org_id       = excluded.socle_org_id,
    host               = excluded.host,
    port               = excluded.port,
    username           = excluded.username,
    password_secret_id = excluded.password_secret_id,
    from_email         = excluded.from_email,
    from_name          = excluded.from_name,
    use_tls            = excluded.use_tls,
    socle_updated_at   = excluded.socle_updated_at,
    synced_at          = now();
end $fn$;

comment on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz) is
  'Écrit le miroir du serveur d''envoi d''un tenant depuis le Socle — SERVICE UNIQUEMENT (synchronisation du référentiel).';
revoke execute on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant  execute on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz) to service_role;

-- ----------------------------------------------------------------------------
-- 4. clear_smtp_settings_from_socle — le Socle ne déclare plus de relais.
-- L'envoi retombe alors sur le relais de plateforme (`IRIS_SMTP_*`), jamais sur
-- une configuration périmée : un miroir qui survit à sa source ment.
-- ----------------------------------------------------------------------------
create or replace function public.clear_smtp_settings_from_socle(p_org_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $fn$
declare
  v_secret_id uuid;
  v_found     boolean := false;
begin
  delete from public.smtp_settings s
   where s.organization_id = p_org_id
   returning s.password_secret_id into v_secret_id;
  v_found := found;

  if v_secret_id is not null then
    delete from vault.secrets v where v.id = v_secret_id;
  end if;
  return v_found;
end $fn$;

comment on function public.clear_smtp_settings_from_socle(uuid) is
  'Retire le miroir du serveur d''envoi d''un tenant (le Socle n''en déclare plus) — SERVICE UNIQUEMENT. Renvoie vrai si une ligne existait.';
revoke execute on function public.clear_smtp_settings_from_socle(uuid) from public, anon, authenticated;
grant  execute on function public.clear_smtp_settings_from_socle(uuid) to service_role;
