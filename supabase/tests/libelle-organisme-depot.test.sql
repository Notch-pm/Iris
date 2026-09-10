-- ============================================================================
-- Tests du LIBELLÉ D'ORGANISME posé au dépôt (migration 20260917100000)
--
--   1. Une demande déposée SANS libellé (chemin de l'ingestion partenaire :
--      `requests-api` n'envoie que l'identifiant) reçoit le nom du miroir.
--   2. Un libellé SOUMIS qui ment est remplacé par celui du miroir — même
--      règle qu'au transfert.
--   3. Organisme INCONNU du miroir : le libellé soumis reste (l'ingestion
--      garde sa latitude), et `t21` pose l'anomalie `destinataire_inconnu`.
--   4. Sans organisme désigné : rien n'est inventé.
--
-- Contexte postgres, hors RLS — exactement celui de l'ingestion (service_role
-- côté edge function). Le transfert, lui, reste couvert par
-- `transfert-organisme.test.sql`, qui exerce la même fonction en UPDATE.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL editor
-- du dashboard ; le MCP execute_sql est en lecture seule → apply_migration,
-- l'échec final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ailleurs uuid := gen_random_uuid();  -- inconnu du miroir
  orgA     uuid;
  proc     uuid := gen_random_uuid();
  snap     jsonb;
  req      uuid;
  v_fail   text[] := '{}';
  v_text   text;
  v_json   jsonb;
begin
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Libelle')
    returning id into orgA;
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root,   null,   'Mairie'),
    (orgA, s_voirie, s_root, 'Voirie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement nid-de-poule');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement nid-de-poule');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_voirie), (orgA, proc, s_root);

  -- ==========================================================================
  -- T1. Sans libellé soumis : le miroir répond
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id)
  values (orgA, 'Depot sans libelle', proc, snap, s_voirie)
  returning id into req;
  select socle_organization_label into v_text from public.requests where id = req;
  if v_text is distinct from 'Voirie' then
    v_fail := v_fail || format('T1: libelle %s au lieu de Voirie', coalesce(v_text, 'NULL')); end if;

  -- ==========================================================================
  -- T2. Un libellé soumis qui ment est corrigé
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgA, 'Depot qui ment', proc, snap, s_voirie, 'CCAS')
  returning id into req;
  select socle_organization_label into v_text from public.requests where id = req;
  if v_text is distinct from 'Voirie' then
    v_fail := v_fail || format('T2: libelle %s au lieu de Voirie (soumis accepte)', coalesce(v_text, 'NULL')); end if;

  -- ==========================================================================
  -- T3. Organisme inconnu du miroir : le soumis reste, l'anomalie est posée
  -- ==========================================================================
  -- t18 exige l'activation de la démarche pour l'organisme : on l'active pour
  -- l'inconnu aussi, afin de tester t08/t21 et non t18.
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_ailleurs);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgA, 'Depot inconnu', proc, snap, s_ailleurs, 'Service partenaire')
  returning id into req;
  select socle_organization_label, anomalies into v_text, v_json from public.requests where id = req;
  if v_text is distinct from 'Service partenaire' then
    v_fail := v_fail || format('T3a: libelle soumis perdu (%s)', coalesce(v_text, 'NULL')); end if;
  if not (v_json @> '[{"code":"destinataire_inconnu"}]'::jsonb) then
    v_fail := v_fail || format('T3b: anomalie destinataire_inconnu absente - %s', v_json); end if;

  -- ==========================================================================
  -- T4. Sans organisme : rien n'est inventé
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot)
  values (orgA, 'Depot sans organisme', proc, snap)
  returning id into req;
  select socle_organization_label into v_text from public.requests where id = req;
  if v_text is not null then
    v_fail := v_fail || format('T4: libelle invente (%s)', v_text); end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (libelle d''organisme au depot) - transaction annulee, aucune donnee conservee.';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' | ');
  end if;
end
$main$;
