-- ============================================================================
-- Messagerie sortante par tenant — `smtp_settings` + porte RPC.
-- Réf : CLAUDE.md « Jamais de clé d'un autre projet dans le navigateur »,
--       docs/droits.md (administration = attribut de profil, RM-20).
--
-- Motif Clara (smtp_settings par organisation), MOINS sa dette : chez Clara le
-- mot de passe SMTP est stocké en clair et lisible par l'administrateur
-- (docs/technical-debt.md §1). Ici :
--   • le mot de passe ne vit PAS dans la table — seulement un identifiant de
--     secret Supabase Vault (chiffré au repos) ;
--   • aucune policy d'écriture cliente : `save_smtp_settings` /
--     `delete_smtp_settings` sont l'unique porte (motif des tables
--     permission_*) ;
--   • la lecture cliente est bornée COLONNE par COLONNE : l'administrateur
--     voit l'hôte, le port, l'expéditeur — jamais `password_secret_id` ;
--   • le déchiffrement n'existe que pour le service : `smtp_config_for_org` et
--     `mail_context_for_user` sont révoquées de tout rôle client.
--
-- Rejouable : IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS partout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table
-- ----------------------------------------------------------------------------
create table if not exists public.smtp_settings (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  host                text    not null,
  port                integer not null default 587 check (port between 1 and 65535),
  username            text,
  -- Identifiant du secret Vault (vault.secrets.id). Pas de FK : le schéma
  -- `vault` appartient à supabase_admin — le ménage est fait par les RPC.
  password_secret_id  uuid,
  has_password        boolean generated always as (password_secret_id is not null) stored,
  from_email          text    not null,
  from_name           text,
  use_tls             boolean not null default true,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.users(id) on delete set null
);

comment on table public.smtp_settings is
  'Serveur d''envoi (SMTP) du tenant : mails d''authentification et notifications. Une ligne par tenant, écrite uniquement par save_smtp_settings.';
comment on column public.smtp_settings.password_secret_id is
  'Identifiant du secret Vault portant le mot de passe SMTP. JAMAIS lisible par un client (grant colonne) — déchiffré côté service seulement.';
comment on column public.smtp_settings.has_password is
  'Reflet lisible par l''administrateur : un mot de passe est enregistré, sans jamais le divulguer.';
comment on column public.smtp_settings.from_email is
  'Adresse d''expédition. Doit être autorisée par le relais, sinon le relais rejettera l''envoi.';

-- ----------------------------------------------------------------------------
-- RLS — lecture par l'administrateur du tenant, écriture par RPC uniquement.
-- ----------------------------------------------------------------------------
alter table public.smtp_settings enable row level security;

drop policy if exists smtp_settings_select_admin on public.smtp_settings;
create policy smtp_settings_select_admin on public.smtp_settings
  for select to authenticated
  using (public.is_org_admin_anywhere(organization_id));

drop policy if exists smtp_settings_service_all on public.smtp_settings;
create policy smtp_settings_service_all on public.smtp_settings
  for all to service_role
  using (true) with check (true);

-- Privilèges COLONNE : `password_secret_id` est retiré de la surface cliente.
-- (Le RLS est ligne-à-ligne ; seul le grant colonne interdit une colonne.)
revoke all on table public.smtp_settings from anon, authenticated;
grant select (
  organization_id, host, port, username, has_password,
  from_email, from_name, use_tls, updated_at, updated_by
) on table public.smtp_settings to authenticated;

-- ----------------------------------------------------------------------------
-- save_smtp_settings — porte unique d'écriture (administrateur du tenant).
-- Mot de passe : absent/vide ⇒ le secret existant est CONSERVÉ (l'écran ne
-- réaffiche jamais le mot de passe, il ne doit pas l'effacer par omission).
-- ----------------------------------------------------------------------------
create or replace function public.save_smtp_settings(
  p_org_id     uuid,
  p_host       text,
  p_port       integer,
  p_username   text,
  p_password   text,
  p_from_email text,
  p_from_name  text,
  p_use_tls    boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_existing_secret uuid;
  v_secret_id       uuid;
  v_host            text := btrim(coalesce(p_host, ''));
  v_from            text := lower(btrim(coalesce(p_from_email, '')));
  v_port            integer := coalesce(p_port, 587);
begin
  if not public.is_org_admin_anywhere(p_org_id) then
    raise exception 'Administration requise sur ce tenant.' using errcode = '42501';
  end if;
  if v_host = '' then
    raise exception 'Le serveur SMTP est obligatoire.' using errcode = '22023';
  end if;
  if v_from !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Adresse d''expédition invalide.' using errcode = '22023';
  end if;
  if v_port < 1 or v_port > 65535 then
    raise exception 'Port SMTP invalide.' using errcode = '22023';
  end if;

  select s.password_secret_id into v_existing_secret
    from public.smtp_settings s where s.organization_id = p_org_id;

  if coalesce(btrim(p_password), '') <> '' then
    if v_existing_secret is null then
      v_secret_id := vault.create_secret(
        p_password,
        'iris_smtp_' || p_org_id::text,
        'Mot de passe SMTP du tenant Iris ' || p_org_id::text
      );
    else
      perform vault.update_secret(v_existing_secret, p_password);
      v_secret_id := v_existing_secret;
    end if;
  else
    v_secret_id := v_existing_secret;
  end if;

  insert into public.smtp_settings (
    organization_id, host, port, username, password_secret_id,
    from_email, from_name, use_tls, updated_at, updated_by
  ) values (
    p_org_id, v_host, v_port,
    nullif(btrim(coalesce(p_username, '')), ''),
    v_secret_id, v_from,
    nullif(btrim(coalesce(p_from_name, '')), ''),
    coalesce(p_use_tls, true), now(), auth.uid()
  )
  on conflict (organization_id) do update set
    host               = excluded.host,
    port               = excluded.port,
    username           = excluded.username,
    password_secret_id = excluded.password_secret_id,
    from_email         = excluded.from_email,
    from_name          = excluded.from_name,
    use_tls            = excluded.use_tls,
    updated_at         = now(),
    updated_by         = excluded.updated_by;
end $$;

comment on function public.save_smtp_settings(uuid, text, integer, text, text, text, text, boolean) is
  'Enregistre le serveur d''envoi du tenant (administrateur requis). Mot de passe vide ⇒ secret Vault conservé.';
revoke execute on function public.save_smtp_settings(uuid, text, integer, text, text, text, text, boolean) from public, anon;
grant  execute on function public.save_smtp_settings(uuid, text, integer, text, text, text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- delete_smtp_settings — retire la configuration ET le secret Vault.
-- ----------------------------------------------------------------------------
create or replace function public.delete_smtp_settings(p_org_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret_id uuid;
begin
  if not public.is_org_admin_anywhere(p_org_id) then
    raise exception 'Administration requise sur ce tenant.' using errcode = '42501';
  end if;

  delete from public.smtp_settings s
   where s.organization_id = p_org_id
   returning s.password_secret_id into v_secret_id;

  if v_secret_id is not null then
    delete from vault.secrets v where v.id = v_secret_id;
  end if;
end $$;

comment on function public.delete_smtp_settings(uuid) is
  'Supprime le serveur d''envoi du tenant et son secret Vault (administrateur requis).';
revoke execute on function public.delete_smtp_settings(uuid) from public, anon;
grant  execute on function public.delete_smtp_settings(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Lecture SERVICE — déchiffrement du mot de passe. Révoquée de tout client.
-- ⚠️ Ne teste pas `is_service_context()` : dans une fonction DEFINER,
--    `current_user` vaut toujours le propriétaire (piège vérifié le
--    2026-08-22, CLAUDE.md). La garde est le GRANT : service_role seul.
-- ----------------------------------------------------------------------------
create or replace function public.smtp_config_for_org(p_org_id uuid)
returns table (
  organization_id uuid, organization_name text,
  host text, port integer, username text, password text,
  from_email text, from_name text, use_tls boolean
)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, s.host, s.port, s.username, d.decrypted_secret,
         s.from_email, s.from_name, s.use_tls
    from public.smtp_settings s
    join public.organizations o on o.id = s.organization_id
    left join vault.decrypted_secrets d on d.id = s.password_secret_id
   where s.organization_id = p_org_id;
$$;

comment on function public.smtp_config_for_org(uuid) is
  'Configuration SMTP déchiffrée d''un tenant — SERVICE UNIQUEMENT (edge functions d''envoi).';
revoke execute on function public.smtp_config_for_org(uuid) from public, anon, authenticated;
grant  execute on function public.smtp_config_for_org(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- mail_context_for_user — tenant d'un destinataire + son SMTP, en un aller.
-- Un compte peut appartenir à plusieurs tenants : on retient d'abord celui qui
-- a un serveur d'envoi configuré, sinon le premier par ordre alphabétique
-- (l'appelant retombe alors sur le relais de plateforme).
-- ----------------------------------------------------------------------------
create or replace function public.mail_context_for_user(p_user_id uuid)
returns table (
  organization_id uuid, organization_name text,
  host text, port integer, username text, password text,
  from_email text, from_name text, use_tls boolean
)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, s.host, s.port, s.username, d.decrypted_secret,
         s.from_email, s.from_name, s.use_tls
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    left join public.smtp_settings s on s.organization_id = o.id
    left join vault.decrypted_secrets d on d.id = s.password_secret_id
   where m.user_id = p_user_id
   order by (s.host is null), o.name
   limit 1;
$$;

comment on function public.mail_context_for_user(uuid) is
  'Tenant de rattachement d''un compte et sa configuration SMTP déchiffrée — SERVICE UNIQUEMENT (hook d''emails d''authentification).';
revoke execute on function public.mail_context_for_user(uuid) from public, anon, authenticated;
grant  execute on function public.mail_context_for_user(uuid) to service_role;
