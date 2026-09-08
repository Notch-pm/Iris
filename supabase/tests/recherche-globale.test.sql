-- ============================================================================
-- Tests de la RECHERCHE GLOBALE (migration 20260901130000).
--
--   1. Les ACCENTS ne comptent pas : « eclairage » trouve « Éclairage », dans
--      les deux sens et quelle que soit la casse.
--   2. Le CODE DE SUIVI se cherche comme l'objet.
--   3. Les MÉTACARACTÈRES de LIKE sont cherchés à la lettre : « 100 % » cherche
--      un pourcentage, « _00 » ne trouve pas « 100 ».
--   4. La garde des TROIS CARACTÈRES vit aussi au serveur (jumeau SQL de
--      MIN_QUERY_LENGTH) : un appel direct ne peut pas demander tout le tenant.
--   5. `p_limit` est BORNÉ et l'ordre est celui de la date de dépôt.
--   6. `security invoker` : deux agents de la MÊME collectivité ne trouvent pas
--      les mêmes demandes — chacun son périmètre. C'est le cœur du test : une
--      recherche qui contournerait le RLS serait une fuite silencieuse.
--   7. Le tenant VOISIN n'apparaît jamais, et `anon` n'a pas le droit d'appeler.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL editor
-- du dashboard ; le MCP execute_sql est en lecture seule → apply_migration,
-- l'échec final VOLONTAIRE annule la transaction, aucune donnée ne subsiste).
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  s_other  uuid := gen_random_uuid();   -- racine Socle du tenant voisin
  orgA     uuid;
  orgB     uuid;
  proc     uuid := gen_random_uuid();
  procB    uuid := gen_random_uuid();
  snap     jsonb;
  snapB    jsonb;
  -- Deux agents de la MÊME collectivité, deux périmètres disjoints.
  u_voirie uuid := gen_random_uuid();
  u_ccas   uuid := gen_random_uuid();
  p_id     uuid;
  r_ecl1   uuid;  -- Voirie, la plus récente
  r_ecl2   uuid;  -- Voirie
  r_cent   uuid;  -- Voirie, contient « 100 % »
  r_ccas   uuid;  -- CCAS : hors du périmètre de u_voirie
  v_fail   text[] := '{}';
  v_int    int;
  v_text   text;
  v_uuid   uuid;
  v_ref    text;
begin
  -- ==========================================================================
  -- MISE EN PLACE (postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_voirie, 'voirie@recherche.test', now(), now()),
    (u_ccas,   'ccas@recherche.test',   now(), now());

  insert into public.organizations (socle_org_id, name)
    values (s_root, 'Mairie Recherche') returning id into orgA;
  insert into public.organizations (socle_org_id, name)
    values (s_other, 'Mairie Voisine') returning id into orgB;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_voirie, 'agent'), (orgA, u_ccas, 'agent');

  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root,   null,   'Mairie'),
    (orgA, s_voirie, s_root, 'Voirie'),
    (orgA, s_ccas,   s_root, 'CCAS'),
    (orgB, s_other,  null,   'Mairie Voisine');

  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name) values
    (proc,  orgA, s_root,  'Signalement éclairage'),
    (procB, orgB, s_other, 'Signalement éclairage');
  snap  := jsonb_build_object('id', proc::text,  'name', 'Signalement éclairage');
  snapB := jsonb_build_object('id', procB::text, 'name', 'Signalement éclairage');

  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_voirie), (orgA, proc, s_ccas), (orgB, procB, s_other);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Voirie-instruction', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_voirie);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'CCAS-instruction', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_ccas);

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_voirie, 'role', 'authenticated')::text, true);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values
    (orgA, 'Éclairage défectueux rue Jean Jaurès', proc, snap, s_voirie, 'Voirie',
     'Signalement éclairage', '2026-03-12T09:30:00Z')
  returning id into r_ecl2;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values
    (orgA, 'Éclairage éteint avenue Frédéric Mistral', proc, snap, s_voirie, 'Voirie',
     'Signalement éclairage', '2026-04-20T09:30:00Z')
  returning id into r_ecl1;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values
    (orgA, 'Subvention 100 % du marché de Noël', proc, snap, s_voirie, 'Voirie',
     'Signalement éclairage', '2026-02-01T09:30:00Z')
  returning id into r_cent;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values
    (orgA, 'Éclairage de la salle des fêtes', proc, snap, s_ccas, 'CCAS',
     'Signalement éclairage', '2026-05-05T09:30:00Z')
  returning id into r_ccas;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values
    (orgB, 'Éclairage public du tenant voisin', procB, snapB, s_other, 'Mairie Voisine',
     'Signalement éclairage', '2026-05-06T09:30:00Z');

  select reference into v_ref from public.requests where id = r_ecl1;

  -- ==========================================================================
  -- T1. Les accents ne comptent pas — dans les deux sens, et sans la casse
  -- ==========================================================================
  execute 'set local role authenticated';

  -- Deux demandes « Éclairage » dans le périmètre Voirie ; celle du CCAS est
  -- hors périmètre (T6) et celle du tenant voisin n'existe pas (T7).
  select count(*) into v_int from public.search_requests(orgA, 'eclairage', 20);
  if v_int <> 2 then
    v_fail := v_fail || format('T1a: « eclairage » rend %s demandes au lieu de 2', v_int); end if;

  select count(*) into v_int from public.search_requests(orgA, 'ÉCLAIRAGE', 20);
  if v_int <> 2 then
    v_fail := v_fail || format('T1b: « ÉCLAIRAGE » rend %s demandes au lieu de 2', v_int); end if;

  -- L'objet porte les accents, la saisie non : c'est le cas ordinaire.
  select count(*) into v_int from public.search_requests(orgA, 'defectueux', 20);
  if v_int <> 1 then
    v_fail := v_fail || format('T1c: « defectueux » rend %s demandes au lieu de 1', v_int); end if;

  -- Et l'inverse : la saisie porte les accents, pas le texte cherché.
  select count(*) into v_int from public.search_requests(orgA, 'Nöel', 20);
  if v_int <> 1 then
    v_fail := v_fail || format('T1d: « Nöel » rend %s demandes au lieu de 1', v_int); end if;

  -- ==========================================================================
  -- T2. Le code de suivi se cherche comme l'objet
  -- ==========================================================================
  select count(*) into v_int from public.search_requests(orgA, right(v_ref, 6), 20);
  if v_int < 1 then
    v_fail := v_fail || format('T2: le code de suivi %s ne se trouve pas', v_ref); end if;

  -- ==========================================================================
  -- T3. Les métacaractères de LIKE sont cherchés à la lettre
  -- ==========================================================================
  select count(*) into v_int from public.search_requests(orgA, '100 %', 20);
  if v_int <> 1 then
    v_fail := v_fail || format('T3a: « 100 %% » rend %s demandes au lieu de 1', v_int); end if;

  -- `%%%` échappé ne trouve rien ; joker, il aurait rendu TOUT le périmètre.
  select count(*) into v_int from public.search_requests(orgA, '%%%', 20);
  if v_int <> 0 then
    v_fail := v_fail || format('T3b: « %%%%%% » rend %s demandes — le joker n''est pas echappe', v_int); end if;

  -- `_` joker aurait fait de « _00 » un synonyme de « 100 ».
  select count(*) into v_int from public.search_requests(orgA, '_00', 20);
  if v_int <> 0 then
    v_fail := v_fail || format('T3c: « _00 » rend %s demandes — le joker _ n''est pas echappe', v_int); end if;
  select count(*) into v_int from public.search_requests(orgA, '100', 20);
  if v_int <> 1 then
    v_fail := v_fail || format('T3d: « 100 » rend %s demandes au lieu de 1', v_int); end if;

  -- ==========================================================================
  -- T4. La garde des trois caractères vit AUSSI au serveur
  -- ==========================================================================
  select count(*) into v_int from public.search_requests(orgA, 'éc', 20);
  if v_int <> 0 then
    v_fail := v_fail || format('T4a: une saisie de 2 caracteres rend %s demandes', v_int); end if;
  select count(*) into v_int from public.search_requests(orgA, '   e   ', 20);
  if v_int <> 0 then
    v_fail := v_fail || format('T4b: une saisie d''un caractere entoure d''espaces rend %s demandes', v_int); end if;
  select count(*) into v_int from public.search_requests(orgA, null, 20);
  if v_int <> 0 then
    v_fail := v_fail || format('T4c: une saisie NULL rend %s demandes', v_int); end if;

  -- ==========================================================================
  -- T5. Ordre (dépôt décroissant) et plafond
  -- ==========================================================================
  select request_subject into v_text
    from public.search_requests(orgA, 'eclairage', 20) limit 1;
  if v_text is distinct from 'Éclairage éteint avenue Frédéric Mistral' then
    v_fail := v_fail || format('T5a: la plus recente n''est pas en tete (%s)', v_text); end if;

  select count(*) into v_int from public.search_requests(orgA, 'eclairage', 1);
  if v_int <> 1 then
    v_fail := v_fail || format('T5b: p_limit = 1 rend %s demandes', v_int); end if;

  select count(*) into v_int from public.search_requests(orgA, 'eclairage', 9999);
  if v_int <> 2 then
    v_fail := v_fail || format('T5c: un p_limit demesure change le resultat (%s)', v_int); end if;

  -- ==========================================================================
  -- T6. `security invoker` : chacun son périmètre, dans la même collectivité
  -- ==========================================================================
  -- u_voirie ne voit pas la demande du CCAS…
  select count(*) into v_int
    from public.search_requests(orgA, 'salle des fetes', 20);
  if v_int <> 0 then
    v_fail := v_fail || 'T6a: la demande du CCAS remonte dans la recherche d''un agent Voirie'::text; end if;
  execute 'reset role';

  -- … et l'agent du CCAS voit l'inverse.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_ccas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_int from public.search_requests(orgA, 'eclairage', 20);
  if v_int <> 1 then
    v_fail := v_fail || format('T6b: l''agent CCAS trouve %s demandes au lieu de la sienne', v_int); end if;
  select request_id into v_uuid from public.search_requests(orgA, 'eclairage', 20) limit 1;
  if v_uuid is distinct from r_ccas then
    v_fail := v_fail || 'T6c: l''agent CCAS ne trouve pas SA demande'::text; end if;

  -- ==========================================================================
  -- T7. Le tenant voisin n'existe pas, et anon n'appelle pas
  -- ==========================================================================
  select count(*) into v_int from public.search_requests(orgB, 'eclairage', 20);
  if v_int <> 0 then
    v_fail := v_fail || format('T7a: la recherche traverse la frontiere de tenant (%s)', v_int); end if;
  execute 'reset role';

  if has_function_privilege('anon', 'public.search_requests(uuid, text, int)', 'execute') then
    v_fail := v_fail || 'T7b: anon peut appeler search_requests'::text; end if;
  if not has_function_privilege('authenticated', 'public.search_requests(uuid, text, int)', 'execute') then
    v_fail := v_fail || 'T7c: authenticated ne peut PAS appeler search_requests'::text; end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (recherche globale) - transaction annulee, aucune donnee conservee.';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' | ');
  end if;
end
$main$;
