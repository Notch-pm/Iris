-- ============================================================================
-- Accusé de réception au dépôt — test TRANSACTIONNEL ANNULÉ.
--
-- Joué par apply_migration (execute_sql est en lecture seule) : le `raise
-- exception` final annule tout, et son message porte le verdict. Rien n'est
-- écrit dans schema_migrations.
--
-- S'appuie sur des demandes EXISTANTES (une du guichet ou du portail, une de
-- Clara) : la file est neuve, et rien n'est envoyé — on teste la base, pas le
-- facteur.
-- ============================================================================

do $test$
declare
  v_iris   uuid;
  v_clara  uuid;
  v_ok     boolean;
  v_row    record;
  v_email  uuid;
  v_email2 uuid;
  v_status text;
  v_mail   record;
begin
  select id into v_iris  from public.requests where source <> 'clara'
   and not exists (select 1 from public.request_receipts q where q.request_id = requests.id)
   order by created_at desc limit 1;
  select id into v_clara from public.requests where source = 'clara' order by created_at desc limit 1;
  if v_iris is null or v_clara is null then
    raise exception 'ÉCHEC décor : il faut une demande hors Clara et une demande Clara.';
  end if;

  -- A1 · une demande déposée s'enfile, une seule fois
  v_ok := public.enqueue_request_receipt(v_iris);
  if v_ok is not true then raise exception 'ÉCHEC A1 : premier enfilement refusé.'; end if;
  v_ok := public.enqueue_request_receipt(v_iris);
  if v_ok is not false then raise exception 'ÉCHEC A1 : second enfilement accepté (doublon).'; end if;

  -- A2 · une demande issue de Clara ne s'enfile jamais
  v_ok := public.enqueue_request_receipt(v_clara);
  if v_ok is not false then raise exception 'ÉCHEC A2 : une demande Clara a été enfilée.'; end if;
  if exists (select 1 from public.request_receipts where request_id = v_clara) then
    raise exception 'ÉCHEC A2 : ligne de file pour une demande Clara.';
  end if;

  -- A3 · la réclamation rend la demande, marquée « sending », tentative 1
  select * into v_row from public.claim_request_receipts(200) c where c.receipt_request_id = v_iris;
  if v_row.receipt_request_id is null then raise exception 'ÉCHEC A3 : demande non réclamée.'; end if;
  if v_row.attempts <> 1 or v_row.email_id is not null or v_row.reference is null then
    raise exception 'ÉCHEC A3 : réclamation incohérente (%).', row_to_json(v_row);
  end if;
  select status into v_status from public.request_receipts where request_id = v_iris;
  if v_status <> 'sending' then raise exception 'ÉCHEC A3 : statut % au lieu de sending.', v_status; end if;
  -- Une seconde réclamation ne la rend pas (déjà en vol).
  if exists (select 1 from public.claim_request_receipts(200) c where c.receipt_request_id = v_iris) then
    raise exception 'ÉCHEC A3 : demande réclamée deux fois.';
  end if;

  -- A4 · l'échange s'ouvre sans agent, une seule fois
  v_email := public.start_request_receipt_email(v_iris, 'usager@exemple.fr', 'Nous avons bien reçu votre demande', 'Corps');
  v_email2 := public.start_request_receipt_email(v_iris, 'autre@exemple.fr', 'Autre', 'Autre');
  if v_email is distinct from v_email2 then raise exception 'ÉCHEC A4 : deux échanges ouverts.'; end if;
  select * into v_mail from public.request_emails where id = v_email;
  if v_mail.sent_by is not null or v_mail.status <> 'en_cours' or v_mail.to_email <> 'usager@exemple.fr' then
    raise exception 'ÉCHEC A4 : échange incohérent (%).', row_to_json(v_mail);
  end if;

  -- A5 · un échec avant le plafond remet en file, l'échange reste « en_cours »
  perform public.settle_request_receipt(v_iris, false, 'relais muet');
  select status into v_status from public.request_receipts where request_id = v_iris;
  if v_status <> 'pending' then raise exception 'ÉCHEC A5 : statut % au lieu de pending.', v_status; end if;
  if (select status from public.request_emails where id = v_email) <> 'en_cours' then
    raise exception 'ÉCHEC A5 : échange réglé trop tôt.';
  end if;
  -- Temporisée : pas réclamable tout de suite.
  if exists (select 1 from public.claim_request_receipts(200) c where c.receipt_request_id = v_iris) then
    raise exception 'ÉCHEC A5 : reprise sans temporisation.';
  end if;

  -- A6 · la reprise rend le texte ENREGISTRÉ, et le succès règle les deux
  update public.request_receipts set next_attempt_at = now() - interval '1 second' where request_id = v_iris;
  select * into v_row from public.claim_request_receipts(200) c where c.receipt_request_id = v_iris;
  if v_row.email_id is distinct from v_email or v_row.email_to <> 'usager@exemple.fr' or v_row.attempts <> 2 then
    raise exception 'ÉCHEC A6 : reprise incohérente (%).', row_to_json(v_row);
  end if;
  perform public.settle_request_receipt(v_iris, true);
  select status into v_status from public.request_receipts where request_id = v_iris;
  select * into v_mail from public.request_emails where id = v_email;
  if v_status <> 'sent' or v_mail.status <> 'envoye' or v_mail.sent_at is null then
    raise exception 'ÉCHEC A6 : règlement incomplet (file %, échange %).', v_status, v_mail.status;
  end if;

  -- A7 · au plafond, abandon franc : file « failed », échange « echec »
  update public.request_receipts set status = 'sending', attempts = 5, settled_at = null where request_id = v_iris;
  update public.request_emails set status = 'en_cours', sent_at = null where id = v_email;
  perform public.settle_request_receipt(v_iris, false, 'refus définitif');
  select status into v_status from public.request_receipts where request_id = v_iris;
  if v_status <> 'failed' or (select status from public.request_emails where id = v_email) <> 'echec' then
    raise exception 'ÉCHEC A7 : abandon non réglé.';
  end if;

  -- A8 · renoncer (pas d'adresse) ne laisse aucun échange
  delete from public.request_emails where id = v_email;
  update public.request_receipts set status = 'sending', email_id = null where request_id = v_iris;
  perform public.skip_request_receipt(v_iris, 'aucune adresse de courriel');
  if (select status from public.request_receipts where request_id = v_iris) <> 'skipped' then
    raise exception 'ÉCHEC A8 : renoncement non réglé.';
  end if;

  -- A9 · aucune porte cliente
  if has_function_privilege('authenticated', 'public.enqueue_request_receipt(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_request_receipts(int)', 'execute')
     or has_function_privilege('authenticated', 'public.start_request_receipt_email(uuid,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.settle_request_receipt(uuid,boolean,text)', 'execute')
     or has_function_privilege('anon', 'public.skip_request_receipt(uuid,text)', 'execute') then
    raise exception 'ÉCHEC A9 : une RPC de la file est exécutable par un client.';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.request_receipts'::regclass
              and polname <> 'request_receipts_service') then
    raise exception 'ÉCHEC A9 : policy cliente sur request_receipts.';
  end if;

  raise exception 'TOUS LES TESTS SONT PASSES (A1-A9) — transaction annulee';
end;
$test$;
