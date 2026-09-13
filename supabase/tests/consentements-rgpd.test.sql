-- ============================================================================
-- Tests des CONSENTEMENTS RGPD au dépôt (migration 20260920100000)
--
--   1. Une demande naît avec `consents` vide — les demandes historiques et
--      l'ingestion sans consentement ne sont pas refusées par la base.
--   2. Ce qui est consigné au dépôt est relu à l'identique (phrase comprise).
--   3. `consents` est IMMUABLE : le réécrire est refusé, service_role compris.
--   4. Le refuser en le VIDANT est refusé aussi (une trace ne s'efface pas).
--   5. Une valeur non-tableau est refusée par le CHECK — y compris `'null'`,
--      le cas que `jsonb_typeof` seul laisserait passer.
--   6. La RPC `create_request_from_procedure` écrit bien la trace ; sans clé
--      `consents`, elle retombe sur `[]` plutôt que sur NULL.
--
-- ⚠️ Ce que ce fichier NE teste PAS, et où c'est testé : l'OBLIGATION du
-- consentement au traitement n'est pas une garde SQL — elle vit dans
-- `normalizeConsents` (`supabase/functions/_shared/consents/catalog.ts`),
-- couverte par `catalog.test.ts`. La base accepte donc `granted: false` : elle
-- enregistre un fait, elle n'arbitre pas le catalogue.
--
-- Contexte postgres, hors RLS. Exécution : bloc DO dans un contexte
-- lecture-écriture (SQL editor du dashboard ; le MCP execute_sql est en lecture
-- seule → apply_migration). L'échec final est VOLONTAIRE et annule la
-- transaction : aucune donnée conservée.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  orgA     uuid;
  agent    uuid := gen_random_uuid();
  proc     uuid := gen_random_uuid();
  snap     jsonb;
  req      uuid;
  draft    uuid := gen_random_uuid();
  v_fail   text[] := '{}';
  v_json   jsonb;
  v_res    jsonb;
  v_msg    text;
  traite   jsonb := jsonb_build_object(
    'kind', 'traitement', 'granted', true,
    'statement', 'J''accepte que les informations fournies ici soient utilisées dans le cadre du traitement de ma demande.');
  partage  jsonb := jsonb_build_object(
    'kind', 'partage', 'granted', false,
    'statement', 'J''accepte de partager ces informations aux services de Mairie Consentement afin d''améliorer le traitement de ma demande et de mes futures demandes.');
begin
  insert into public.organizations (socle_org_id, name)
    values (s_root, 'Mairie Consentement') returning id into orgA;
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root,   null,   'Mairie Consentement'),
    (orgA, s_voirie, s_root, 'Voirie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_voirie), (orgA, proc, s_root);

  -- ==========================================================================
  -- T1. Défaut : tableau vide, jamais NULL
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot)
  values (orgA, 'Depot historique', proc, snap)
  returning id into req;
  select consents into v_json from public.requests where id = req;
  if v_json is distinct from '[]'::jsonb then
    v_fail := v_fail || format('T1: defaut %s au lieu de []', coalesce(v_json::text, 'NULL')); end if;

  -- ==========================================================================
  -- T2. Ce qui est consigné est relu à l'identique, phrase comprise
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, consents)
  values (orgA, 'Depot avec consentements', proc, snap, s_voirie,
          jsonb_build_array(traite, partage))
  returning id into req;
  select consents into v_json from public.requests where id = req;
  if jsonb_array_length(v_json) <> 2 then
    v_fail := v_fail || format('T2a: %s consentements au lieu de 2', jsonb_array_length(v_json)); end if;
  if (v_json -> 0 ->> 'statement') is distinct from (traite ->> 'statement') then
    v_fail := v_fail || 'T2b: la phrase du consentement au traitement a ete alteree'; end if;
  -- Un REFUS se consigne : il ne disparaît pas au profit d'une absence.
  if (v_json -> 1 ->> 'granted') is distinct from 'false' then
    v_fail := v_fail || 'T2c: le refus du partage n''a pas ete conserve'; end if;

  -- ==========================================================================
  -- T3. IMMUABLE — réécrire la trace est refusé (t10)
  -- ==========================================================================
  begin
    update public.requests
      set consents = jsonb_build_array(traite, jsonb_set(partage, '{granted}', 'true'::jsonb))
      where id = req;
    v_fail := v_fail || 'T3: consents a pu etre reecrit (t10 ne garde rien)';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%immuable%' then
      v_fail := v_fail || format('T3: refus attendu mais message inattendu (%s)', v_msg); end if;
  end;

  -- ==========================================================================
  -- T4. …et le VIDER est un cas du même refus (une trace ne s'efface pas)
  -- ==========================================================================
  begin
    update public.requests set consents = '[]'::jsonb where id = req;
    v_fail := v_fail || 'T4: consents a pu etre vide';
  exception when others then
    null;  -- refus attendu
  end;

  -- ==========================================================================
  -- T5. CHECK de forme — un non-tableau est refusé, `'null'` compris
  --
  -- C'est le cas qui justifie le `coalesce(jsonb_typeof(...), '')` : sur un
  -- jsonb `null`, `jsonb_typeof` rend 'null' et non NULL, mais la leçon vaut —
  -- on vérifie ici que ni 'null' ni un objet ne passent.
  -- ==========================================================================
  begin
    insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, consents)
    values (orgA, 'Depot mal forme', proc, snap, '{"traitement": true}'::jsonb);
    v_fail := v_fail || 'T5a: un OBJET a ete accepte dans consents';
  exception when others then null;
  end;
  begin
    insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, consents)
    values (orgA, 'Depot null json', proc, snap, 'null'::jsonb);
    v_fail := v_fail || 'T5b: le jsonb null a ete accepte dans consents';
  exception when others then null;
  end;

  -- ==========================================================================
  -- T6. La RPC de création guidée consigne la trace
  -- ==========================================================================
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new,
                          email_change_token_current, email_change, phone_change,
                          phone_change_token, reauthentication_token)
  values (agent, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'consentement@test.local', crypt('x', gen_salt('bf')), now(), now(), now(),
          '', '', '', '', '', '', '', '');
  insert into public.organization_members (organization_id, user_id, role)
    values (orgA, agent, 'administrateur');

  v_res := public.create_request_from_procedure(jsonb_build_object(
    'agent_id', agent::text,
    'organization_id', orgA::text,
    'request_id', draft::text,
    'subject', 'Depot par la RPC',
    'socle_organization_id', s_voirie::text,
    'socle_procedure_id', proc::text,
    'procedure_snapshot', snap,
    'requester_snapshot', jsonb_build_object('declared', jsonb_build_object('anonymous', true)),
    'identity_status', 'anonyme',
    'consents', jsonb_build_array(traite, partage)
  ));
  select consents into v_json from public.requests where id = (v_res ->> 'id')::uuid;
  if jsonb_array_length(coalesce(v_json, '[]'::jsonb)) <> 2 then
    v_fail := v_fail || format('T6a: la RPC n''a pas consigne les consentements (%s)',
                               coalesce(v_json::text, 'NULL')); end if;

  -- Sans la clé : `[]`, jamais NULL (la colonne est not null, le coalesce de la
  -- RPC est ce qui l'en protège).
  v_res := public.create_request_from_procedure(jsonb_build_object(
    'agent_id', agent::text,
    'organization_id', orgA::text,
    'request_id', gen_random_uuid()::text,
    'subject', 'Depot RPC sans consentements',
    'socle_organization_id', s_voirie::text,
    'socle_procedure_id', proc::text,
    'procedure_snapshot', snap,
    'requester_snapshot', jsonb_build_object('declared', jsonb_build_object('anonymous', true)),
    'identity_status', 'anonyme'
  ));
  select consents into v_json from public.requests where id = (v_res ->> 'id')::uuid;
  if v_json is distinct from '[]'::jsonb then
    v_fail := v_fail || format('T6b: sans cle consents, la RPC a ecrit %s',
                               coalesce(v_json::text, 'NULL')); end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (consentements RGPD) - transaction annulee, aucune donnee conservee.';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' | ');
  end if;
end
$main$;
