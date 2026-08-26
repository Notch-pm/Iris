-- ============================================================================
-- Serveur d'envoi : configuration réservée à l'administration de l'ORGANISME
-- PRINCIPAL (racine du tenant). Décision PO du 2026-08-23.
--
-- Le serveur d'envoi vaut pour tout le sous-arbre : le définir est un geste de
-- la racine, pas d'une branche. Un administrateur dont le périmètre se limite
-- à la Voirie voit la configuration (elle n'a rien de secret, cf. grant
-- colonne de 20260823100000) mais ne l'écrit pas.
--
-- Ne change RIEN à l'invitation d'un agent, qui reste ouverte à tout
-- administrateur du tenant (`is_org_admin_anywhere_for`) : inviter dans sa
-- branche est légitime, configurer le relais de tout le monde ne l'est pas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- is_tenant_root_admin — administration sur la RACINE Socle du tenant.
-- Délègue à `has_admin_scope`, moteur unique de « administration sur une
-- organisation » (ADR-04, pas de seconde implémentation) : testée sur la
-- racine, la remontée d'ascendance est triviale — la racine n'a pas de parent.
-- ----------------------------------------------------------------------------
create or replace function public.is_tenant_root_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_admin_scope(
    p_org_id,
    (select o.socle_org_id from public.organizations o where o.id = p_org_id)
  );
$$;

comment on function public.is_tenant_root_admin(uuid) is
  'Administration de l''utilisateur courant sur l''organisme principal (racine Socle) du tenant. Gouverne la configuration du serveur d''envoi.';
revoke execute on function public.is_tenant_root_admin(uuid) from public, anon;
grant  execute on function public.is_tenant_root_admin(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- is_tenant_root_admin_for — même règle pour un utilisateur DONNÉ (service).
-- `has_admin_scope` étant fondée sur auth.uid(), elle ne peut pas servir ici ;
-- la racine n'ayant pas de parent, la règle se réduit à « un profil actif
-- is_admin dont le périmètre contient la racine ». SERVICE UNIQUEMENT.
-- ----------------------------------------------------------------------------
create or replace function public.is_tenant_root_admin_for(p_user_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_platform_admin from public.users u where u.id = p_user_id), false)
      or exists (
    select 1
      from public.permission_profile_assignments a
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_admin
      join public.permission_profile_organizations po on po.profile_id = p.id
      join public.organizations o on o.id = a.organization_id
     where a.user_id = p_user_id
       and a.organization_id = p_org_id
       and po.socle_org_id = o.socle_org_id
  );
$$;

comment on function public.is_tenant_root_admin_for(uuid, uuid) is
  'Administration d''un utilisateur donné sur l''organisme principal du tenant — variante service de is_tenant_root_admin, révoquée des clients.';
revoke execute on function public.is_tenant_root_admin_for(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.is_tenant_root_admin_for(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Bascule des gardes : `is_org_admin_anywhere` → `is_tenant_root_admin`.
-- (Corps inchangé par ailleurs — seul le test d'entrée et son message bougent.)
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
  if not public.is_tenant_root_admin(p_org_id) then
    raise exception 'Le serveur d''envoi se configure au niveau de l''organisme principal : administration de la racine du tenant requise.'
      using errcode = '42501';
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
  'Enregistre le serveur d''envoi du tenant (administration de l''organisme principal requise). Mot de passe vide ⇒ secret Vault conservé.';
-- ⚠️ CREATE OR REPLACE re-grante PUBLIC : re-révoquer dans la même migration.
revoke execute on function public.save_smtp_settings(uuid, text, integer, text, text, text, text, boolean) from public, anon;
grant  execute on function public.save_smtp_settings(uuid, text, integer, text, text, text, text, boolean) to authenticated;

create or replace function public.delete_smtp_settings(p_org_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret_id uuid;
begin
  if not public.is_tenant_root_admin(p_org_id) then
    raise exception 'Le serveur d''envoi se configure au niveau de l''organisme principal : administration de la racine du tenant requise.'
      using errcode = '42501';
  end if;

  delete from public.smtp_settings s
   where s.organization_id = p_org_id
   returning s.password_secret_id into v_secret_id;

  if v_secret_id is not null then
    delete from vault.secrets v where v.id = v_secret_id;
  end if;
end $$;

comment on function public.delete_smtp_settings(uuid) is
  'Supprime le serveur d''envoi du tenant et son secret Vault (administration de l''organisme principal requise).';
revoke execute on function public.delete_smtp_settings(uuid) from public, anon;
grant  execute on function public.delete_smtp_settings(uuid) to authenticated;
