-- ============================================================================
-- Tests de la messagerie sortante — le serveur d'envoi est un MIROIR du Socle.
-- Ce qui est vérifié : plus aucune surface cliente (ni lecture, ni écriture,
-- ni RPC de saisie), une porte de service unique, le mot de passe au Vault et
-- jamais ailleurs, et l'étanchéité entre tenants.
-- Réf : 20260823150000_smtp_depuis_socle.sql · docs/emails.md ·
--       profils-droits.test.sql (harnais).
--
-- Exécution : contexte postgres en lecture-écriture (SQL editor, ou
-- apply_migration — qui échoue volontairement, l'exception finale annulant
-- toute la transaction : aucune donnée, aucun secret Vault ne subsiste).
-- ============================================================================

do $main$
declare
  -- Tenant 1 : Mairie (racine + branche Voirie). Tenant 2 : étanchéité.
  s_root1  uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_root2  uuid := gen_random_uuid();
  org1    uuid;
  org2    uuid;
  -- A administre la racine du tenant 1, D la Voirie seule, B en est simple
  -- membre, C administre le tenant 2.
  u_admin1  uuid := gen_random_uuid();
  u_branche uuid := gen_random_uuid();
  u_membre1 uuid := gen_random_uuid();
  u_admin2  uuid := gen_random_uuid();
  p_admin1  uuid;
  p_branche uuid;
  p_admin2  uuid;
  -- Scratch.
  v_fail    text[] := '{}';
  v_int     int;
  v_text    text;
  v_uuid    uuid;
  v_uuid2   uuid;
  v_bool    boolean;
  v_ts      timestamptz;
  v_now     timestamptz := now();
begin
  -- ==========================================================================
  -- MISE EN PLACE (contexte postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_admin1,  'admin1@messagerie.test',  now(), now()),
    (u_branche, 'branche@messagerie.test', now(), now()),
    (u_membre1, 'membre1@messagerie.test', now(), now()),
    (u_admin2,  'admin2@messagerie.test',  now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root1, 'Mairie Messagerie') returning id into org1;
  insert into public.organizations (socle_org_id, name) values (s_root2, 'Autre Collectivité') returning id into org2;

  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root1,  null,    'Mairie Messagerie'),
    (org1, s_voirie, s_root1, 'Voirie'),
    (org2, s_root2,  null,    'Autre Collectivité');

  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_admin1, 'agent'), (org1, u_branche, 'agent'),
    (org1, u_membre1, 'agent'), (org2, u_admin2, 'agent');

  insert into public.permission_profiles (organization_id, name, is_admin)
  values (org1, 'Admin Mairie', true) returning id into p_admin1;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_admin1, s_root1);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
  values (org1, p_admin1, u_admin1);

  insert into public.permission_profiles (organization_id, name, is_admin)
  values (org1, 'Admin Voirie', true) returning id into p_branche;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_branche, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
  values (org1, p_branche, u_branche);

  insert into public.permission_profiles (organization_id, name, is_admin)
  values (org2, 'Admin Autre', true) returning id into p_admin2;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_admin2, s_root2);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
  values (org2, p_admin2, u_admin2);

  -- ==========================================================================
  -- M-01 · La saisie dans Iris n'existe plus : les RPC ont disparu, et avec
  --        elles les gardes qui ne servaient qu'à elles.
  -- ==========================================================================
  if to_regprocedure('public.save_smtp_settings(uuid, text, integer, text, text, text, text, boolean)') is not null then
    v_fail := v_fail || 'M-01: save_smtp_settings existe encore — la saisie dans Iris n''a pas été retirée';
  end if;
  if to_regprocedure('public.delete_smtp_settings(uuid)') is not null then
    v_fail := v_fail || 'M-01: delete_smtp_settings existe encore';
  end if;
  if to_regprocedure('public.is_tenant_root_admin(uuid)') is not null then
    v_fail := v_fail || 'M-01: is_tenant_root_admin existe encore (garde sans objet)';
  end if;
  if to_regprocedure('public.is_tenant_root_admin_for(uuid, uuid)') is not null then
    v_fail := v_fail || 'M-01: is_tenant_root_admin_for existe encore (garde sans objet)';
  end if;

  -- ==========================================================================
  -- M-02 · Le service écrit le miroir. Normalisation, provenance, fraîcheur,
  --        mot de passe au Vault — jamais dans une colonne.
  -- ==========================================================================
  perform public.sync_smtp_settings_from_socle(
    org1, s_root1, '  smtp.mairie.test ', 587, ' iris ', 'motdepasse',
    '  Ne-Pas-Repondre@Mairie.TEST ', ' Mairie ', true, v_now - interval '1 day');

  select count(*) into v_int from public.smtp_settings where organization_id = org1;
  if v_int <> 1 then
    v_fail := v_fail || 'M-02: le miroir n''a pas été écrit';
  end if;

  select host into v_text from public.smtp_settings where organization_id = org1;
  if v_text <> 'smtp.mairie.test' then
    v_fail := v_fail || format('M-02: hôte non détouré (%s)', v_text);
  end if;
  select from_email into v_text from public.smtp_settings where organization_id = org1;
  if v_text <> 'ne-pas-repondre@mairie.test' then
    v_fail := v_fail || format('M-02: adresse d''expédition non normalisée (%s)', v_text);
  end if;

  select socle_org_id, socle_updated_at into v_uuid, v_ts
    from public.smtp_settings where organization_id = org1;
  if v_uuid is distinct from s_root1 then
    v_fail := v_fail || 'M-02: la provenance Socle (socle_org_id) n''est pas tracée';
  end if;
  if v_ts is null then
    v_fail := v_fail || 'M-02: la date de modification côté Socle n''est pas tracée';
  end if;

  select password_secret_id, has_password into v_uuid, v_bool
    from public.smtp_settings where organization_id = org1;
  if v_uuid is null or v_bool is not true then
    v_fail := v_fail || 'M-02: aucun secret Vault rattaché à la configuration';
  end if;

  -- ==========================================================================
  -- M-03 · Le service relit le mot de passe EN CLAIR (et lui seul).
  -- ==========================================================================
  select password into v_text from public.smtp_config_for_org(org1);
  if v_text is distinct from 'motdepasse' then
    v_fail := v_fail || 'M-03: smtp_config_for_org ne déchiffre pas le mot de passe';
  end if;
  select organization_name into v_text from public.smtp_config_for_org(org1);
  if v_text <> 'Mairie Messagerie' then
    v_fail := v_fail || 'M-03: smtp_config_for_org ne renvoie pas le nom du tenant';
  end if;

  -- ==========================================================================
  -- M-04 · AUCUNE surface cliente : ni lecture (même les colonnes anodines),
  --        ni écriture. La configuration se consulte dans le Socle.
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_admin1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    execute 'select host from public.smtp_settings limit 1';
    v_fail := v_fail || 'M-04: un administrateur peut encore lire smtp_settings';
  exception when insufficient_privilege then null;
  end;

  begin
    execute 'select password_secret_id from public.smtp_settings limit 1';
    v_fail := v_fail || 'M-04: un administrateur a pu lire password_secret_id';
  exception when insufficient_privilege then null;
  end;

  begin
    execute format('update public.smtp_settings set host = %L where organization_id = %L', 'pirate.test', org1);
    v_fail := v_fail || 'M-04: écriture directe (UPDATE) acceptée sur smtp_settings';
  exception when others then null;
  end;

  begin
    execute format('delete from public.smtp_settings where organization_id = %L', org1);
    v_fail := v_fail || 'M-04: suppression directe (DELETE) acceptée sur smtp_settings';
  exception when others then null;
  end;

  begin
    execute format(
      'insert into public.smtp_settings (organization_id, host, from_email) values (%L, %L, %L)',
      org2, 'pirate.test', 'x@pirate.test');
    v_fail := v_fail || 'M-04: insertion directe (INSERT) acceptée sur smtp_settings';
  exception when others then null;
  end;

  -- ==========================================================================
  -- M-05 · Les portes de service sont fermées au client : un administrateur ne
  --        peut ni écrire le miroir, ni l'effacer, ni lire un mot de passe.
  -- ==========================================================================
  begin
    execute format(
      'select public.sync_smtp_settings_from_socle(%L, %L, %L, 587, null, %L, %L, null, true, null)',
      org1, s_root1, 'pirate.test', 'vole', 'x@pirate.test');
    v_fail := v_fail || 'M-05: sync_smtp_settings_from_socle est appelable par un client authentifié';
  exception when insufficient_privilege then null;
  end;

  begin
    execute format('select public.clear_smtp_settings_from_socle(%L)', org1);
    v_fail := v_fail || 'M-05: clear_smtp_settings_from_socle est appelable par un client authentifié';
  exception when insufficient_privilege then null;
  end;

  begin
    execute format('select password from public.smtp_config_for_org(%L)', org1);
    v_fail := v_fail || 'M-05: smtp_config_for_org est appelable par un client authentifié';
  exception when insufficient_privilege then null;
  end;

  begin
    execute format('select password from public.mail_context_for_user(%L)', u_admin1);
    v_fail := v_fail || 'M-05: mail_context_for_user est appelable par un client authentifié';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- M-06 · Un mot de passe changé REMPLACE le secret, sans en créer un second.
  -- ==========================================================================
  select password_secret_id into v_uuid from public.smtp_settings where organization_id = org1;
  perform public.sync_smtp_settings_from_socle(
    org1, s_root1, 'smtp.mairie.test', 465, 'iris', 'nouveau',
    'ne-pas-repondre@mairie.test', 'Mairie', true, v_now);
  select password_secret_id into v_uuid2 from public.smtp_settings where organization_id = org1;
  if v_uuid2 is distinct from v_uuid then
    v_fail := v_fail || 'M-06: le secret Vault a été dupliqué au lieu d''être mis à jour';
  end if;
  select password into v_text from public.smtp_config_for_org(org1);
  if v_text is distinct from 'nouveau' then
    v_fail := v_fail || 'M-06: le mot de passe n''a pas suivi la source';
  end if;
  select port into v_int from public.smtp_settings where organization_id = org1;
  if v_int <> 465 then
    v_fail := v_fail || 'M-06: le reste de la configuration n''a pas suivi la source';
  end if;

  -- ==========================================================================
  -- M-07 · Miroir STRICT : le Socle ne déclare plus de mot de passe (relais
  --        sans authentification) ⇒ le secret Vault est SUPPRIMÉ, pas conservé.
  --        (C'est l'inverse de l'ancienne saisie, où un champ vide valait
  --         « inchangé » : ici, la source déclare, elle n'omet pas.)
  -- ==========================================================================
  perform public.sync_smtp_settings_from_socle(
    org1, s_root1, 'smtp.mairie.test', 25, null, '',
    'ne-pas-repondre@mairie.test', 'Mairie', false, v_now);

  select password_secret_id, has_password into v_uuid, v_bool
    from public.smtp_settings where organization_id = org1;
  if v_uuid is not null or v_bool is not false then
    v_fail := v_fail || 'M-07: un mot de passe retiré côté Socle survit dans le miroir';
  end if;
  select count(*) into v_int from vault.secrets where id = v_uuid2;
  if v_int <> 0 then
    v_fail := v_fail || 'M-07: le secret Vault n''a pas été supprimé';
  end if;
  select use_tls into v_bool from public.smtp_settings where organization_id = org1;
  if v_bool is not false then
    v_fail := v_fail || 'M-07: le refus explicite de TLS n''a pas été recopié';
  end if;

  -- ==========================================================================
  -- M-08 · Une déclaration inexploitable est REFUSÉE côté serveur : le miroir
  --        ne devient jamais un relais bancal (l'appelant efface, il n'insiste
  --        pas).
  -- ==========================================================================
  begin
    perform public.sync_smtp_settings_from_socle(
      org1, s_root1, '   ', 587, null, null, 'ne-pas-repondre@mairie.test', null, true, null);
    v_fail := v_fail || 'M-08: un hôte vide a été accepté';
  exception when others then null;
  end;
  begin
    perform public.sync_smtp_settings_from_socle(
      org1, s_root1, 'smtp.mairie.test', 587, null, null, '  ', null, true, null);
    v_fail := v_fail || 'M-08: une adresse d''expédition vide a été acceptée';
  exception when others then null;
  end;
  -- Un port absurde retombe sur 587 plutôt que d'échouer : la source fait foi,
  -- mais elle ne doit pas pouvoir écrire n'importe quoi.
  perform public.sync_smtp_settings_from_socle(
    org1, s_root1, 'smtp.mairie.test', 70000, null, 'motdepasse',
    'ne-pas-repondre@mairie.test', 'Mairie', true, v_now);
  select port into v_int from public.smtp_settings where organization_id = org1;
  if v_int <> 587 then
    v_fail := v_fail || format('M-08: port hors bornes non ramené au défaut (%s)', v_int);
  end if;

  -- ==========================================================================
  -- M-09 · Un agent de n'importe quelle branche est servi par le relais de son
  --        tenant — un seul serveur pour tout le sous-arbre — et l'autre tenant
  --        ne le voit pas.
  -- ==========================================================================
  select host into v_text from public.mail_context_for_user(u_branche);
  if v_text is distinct from 'smtp.mairie.test' then
    v_fail := v_fail || 'M-09: un agent de branche n''est pas servi par le relais de son tenant';
  end if;
  select password into v_text from public.mail_context_for_user(u_membre1);
  if v_text is distinct from 'motdepasse' then
    v_fail := v_fail || 'M-09: mail_context_for_user ne déchiffre pas le mot de passe du tenant';
  end if;
  select host into v_text from public.mail_context_for_user(u_admin2);
  if v_text is not null then
    v_fail := v_fail || 'M-09: le relais d''un tenant a fuité vers un autre tenant';
  end if;

  -- ==========================================================================
  -- M-10 · Le Socle ne déclare plus de relais ⇒ le miroir s'efface, secret
  --        compris. Un miroir qui survit à sa source ment (l'envoi doit
  --        retomber sur le relais de plateforme).
  -- ==========================================================================
  select password_secret_id into v_uuid from public.smtp_settings where organization_id = org1;
  if public.clear_smtp_settings_from_socle(org1) is not true then
    v_fail := v_fail || 'M-10: clear_smtp_settings_from_socle ne signale pas la suppression';
  end if;
  select count(*) into v_int from public.smtp_settings where organization_id = org1;
  if v_int <> 0 then
    v_fail := v_fail || 'M-10: la ligne du miroir subsiste';
  end if;
  select count(*) into v_int from vault.secrets where id = v_uuid;
  if v_int <> 0 then
    v_fail := v_fail || 'M-10: le secret Vault subsiste après effacement du miroir';
  end if;
  if public.clear_smtp_settings_from_socle(org1) is not false then
    v_fail := v_fail || 'M-10: un second effacement prétend avoir supprimé une ligne';
  end if;

  -- ==========================================================================
  -- M-11 · Étanchéité : le miroir d'un tenant ne parle jamais d'un autre.
  -- ==========================================================================
  perform public.sync_smtp_settings_from_socle(
    org2, s_root2, 'smtp.autre.test', 587, null, 'secret2',
    'contact@autre.test', 'Autre', true, v_now);
  select count(*) into v_int from public.smtp_config_for_org(org1);
  if v_int <> 0 then
    v_fail := v_fail || 'M-11: smtp_config_for_org renvoie une configuration pour un tenant qui n''en a pas';
  end if;
  select host into v_text from public.mail_context_for_user(u_admin2);
  if v_text is distinct from 'smtp.autre.test' then
    v_fail := v_fail || 'M-11: le tenant 2 n''est pas servi par son propre relais';
  end if;
  select host into v_text from public.mail_context_for_user(u_admin1);
  if v_text is not null then
    v_fail := v_fail || 'M-11: le relais du tenant 2 a fuité vers le tenant 1';
  end if;

  -- ==========================================================================
  -- M-12 · L'invitation d'un agent reste ouverte à tout administrateur du
  --        tenant : le serveur d'envoi a quitté Iris, pas l'administration.
  -- ==========================================================================
  if not public.is_org_admin_anywhere_for(u_branche, org1) then
    v_fail := v_fail || 'M-12: l''administrateur de branche a perdu le droit d''inviter un agent';
  end if;
  if public.can_manage_account(u_membre1, u_admin1) then
    v_fail := v_fail || 'M-12: un simple membre a autorité sur le compte d''un administrateur';
  end if;

  -- ==========================================================================
  -- Verdict — l'exception finale annule TOUTE la transaction.
  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (messagerie) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end;
$main$;
