-- ============================================================================
-- Résolution groupée (B7 de docs/backlog.md) — résoudre d'un geste une
-- SÉLECTION LIBRE de demandes, depuis la liste.
--
-- Décision PO du 2026-11-04 : la décision du 2026-10-16 (« une demande à
-- traiter se résout avec le groupe ; l'agent qui résout en devient
-- l'instructeur ») s'étend à toute sélection, liée ou non. Même mise en œuvre,
-- donc même absence de brèche :
--   · la matrice de `requests_guard_write` n'est PAS ouverte : la RPC ENCHAÎNE
--     elle-même `→ en_instruction → résolution`, chaque UPDATE traversant la
--     garde, t17, le RLS, le journal t30 et les statistiques t31 comme un
--     UPDATE client (SECURITY INVOKER) ;
--   · une demande sans instructeur est affectée à l'agent qui résout ;
--   · restent exigés, demande par demande : instruction (affectation, passage
--     par l'instruction) et clôture sur le couple, t17 pour une résolution
--     positive.
--
-- `resolve_one_request` porte désormais LE geste, une demande, dans sa
-- sous-transaction : `resolve_linked_requests` (groupe « même incident ») et
-- `resolve_requests` (sélection libre) n'en diffèrent que par ce qu'elles
-- vérifient avant et consignent après. Comportement de
-- `resolve_linked_requests` inchangé (supabase/tests/demandes-liees-resolution.test.sql).
--
-- `log_batch_resolution` (DEFINER, `request_events` n'a aucune policy
-- d'écriture) ne consigne que des FAITS revérifiés : la demande est résolue,
-- l'appelant y détient la clôture, et le passage à ce statut a été journalisé
-- PAR LUI DANS CETTE TRANSACTION (`created_at = now()`, horodatage de début de
-- transaction) — un appel isolé ne peut rien inventer.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Le geste, pour une demande.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_one_request(
  p_request_id   uuid,
  p_status       text,
  p_motif        text default null,
  p_closure_text text default null)
returns table (
  reference  text,
  ok         boolean,
  error      text,
  took_over  boolean,
  chained    boolean)
language plpgsql volatile security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  r       record;
  v_n     integer;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
  v_text  text := nullif(btrim(coalesce(p_closure_text, '')), '');
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if p_status is null or p_status not in ('resolue_positive', 'resolue_negative') then
    raise exception 'Seule une résolution (positive ou négative) se fait par ce geste.';
  end if;

  took_over := false; chained := false;
  select q.id, q.reference, q.status, q.assigned_to into r from public.requests q where q.id = p_request_id;
  if r.id is null then
    reference := null; ok := false; error := 'Demande introuvable ou hors de votre périmètre.';
    return next; return;
  end if;
  reference := r.reference;
  if r.status not in ('a_traiter', 'en_instruction', 'en_attente') then
    ok := false; error := 'Demande déjà close.';
    return next; return;
  end if;

  begin
    -- 1. L'instructeur : l'agent qui résout, à défaut d'un instructeur déjà affecté.
    if r.assigned_to is null then
      update public.requests set assigned_to = v_uid where id = p_request_id;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'Vous n''avez pas le droit de modifier cette demande.'; end if;
      took_over := true;
    end if;
    -- 2. Le passage par l'instruction, fait PAR LE SERVEUR (décisions PO) :
    --    la garde reste celle de tout le monde.
    if r.status <> 'en_instruction' then
      update public.requests set status = 'en_instruction' where id = p_request_id;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'Vous n''avez pas le droit de modifier cette demande.'; end if;
      chained := true;
    end if;
    -- 3. La résolution.
    update public.requests
       set status = p_status, closure_motif = v_motif, closure_text = v_text
     where id = p_request_id;
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'Vous n''avez pas le droit de clore cette demande.'; end if;
    ok := true; error := null;
  exception when others then
    -- Sous-transaction annulée : la demande revient à son état, affectation comprise.
    ok := false; error := sqlerrm; took_over := false; chained := false;
  end;
  return next;
end;
$$;
revoke execute on function public.resolve_one_request(uuid, text, text, text) from public, anon;
grant execute on function public.resolve_one_request(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Résolution commune d'un groupe « même incident » — même contrat qu'avant.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_linked_requests(
  p_source_request_id uuid,
  p_request_ids       uuid[],
  p_status            text,
  p_motif             text default null,
  p_closure_text      text default null)
returns table (
  request_id uuid,
  reference  text,
  ok         boolean,
  error      text,
  took_over  boolean,
  chained    boolean)
language plpgsql volatile security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_group uuid;
  v_id    uuid;
  v_ref   text;
  one     record;
  v_ok_ids    uuid[] := '{}';
  v_took_ids  uuid[] := '{}';
  v_chain_ids uuid[] := '{}';
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if p_status is null or p_status not in ('resolue_positive', 'resolue_negative') then
    raise exception 'Résolution commune : seule une résolution (positive ou négative) se propage aux demandes liées.';
  end if;
  -- Lu sous RLS : un agent qui ne consulte pas la source n'a pas de groupe.
  select m.group_id into v_group from public.request_group_members m where m.request_id = p_source_request_id;
  if v_group is null then
    raise exception 'Résolution commune : cette demande n''est liée à aucune autre.';
  end if;

  foreach v_id in array coalesce(p_request_ids, '{}') loop
    select q.reference into v_ref from public.requests q where q.id = v_id;
    if v_ref is null then
      request_id := v_id; reference := null; ok := false; took_over := false; chained := false;
      error := 'Demande introuvable ou hors de votre périmètre.';
      return next; continue;
    end if;
    if v_id = p_source_request_id
       or not exists (select 1 from public.request_group_members m
                       where m.request_id = v_id and m.group_id = v_group) then
      request_id := v_id; reference := v_ref; ok := false; took_over := false; chained := false;
      error := 'Cette demande n''est pas liée à la demande résolue.';
      return next; continue;
    end if;

    select * into one from public.resolve_one_request(v_id, p_status, p_motif, p_closure_text);
    request_id := v_id; reference := one.reference; ok := one.ok; error := one.error;
    took_over := one.took_over; chained := one.chained;
    if one.ok then
      v_ok_ids := v_ok_ids || v_id;
      if one.took_over then v_took_ids := v_took_ids || v_id; end if;
      if one.chained then v_chain_ids := v_chain_ids || v_id; end if;
    end if;
    return next;
  end loop;

  if array_length(v_ok_ids, 1) > 0 then
    perform public.log_group_resolution(p_source_request_id, v_ok_ids, v_took_ids, v_chain_ids);
  end if;
end;
$$;
revoke execute on function public.resolve_linked_requests(uuid, uuid[], text, text, text) from public, anon;
grant execute on function public.resolve_linked_requests(uuid, uuid[], text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Journal d'une résolution groupée.
-- ---------------------------------------------------------------------------
create or replace function public.log_batch_resolution(
  p_request_ids uuid[], p_took_over uuid[], p_chained uuid[], p_batch_size integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  q     record;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  for q in
    select r.id, r.organization_id, r.status, r.socle_organization_id, r.socle_procedure_id
      from public.requests r
     where r.id = any(coalesce(p_request_ids, '{}'))
  loop
    if q.status not in ('resolue_positive', 'resolue_negative')
       or not public.request_right_for(v_uid, q.organization_id, q.socle_organization_id, q.socle_procedure_id, 'cloture')
       or not exists (select 1 from public.request_events e
                       where e.request_id = q.id and e.event_type = 'status_changed'
                         and e.payload ->> 'to' = q.status and e.created_by = v_uid
                         and e.created_at = now()) then
      continue;  -- on ne consigne que ce qui est vrai, et de cette transaction
    end if;
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (q.organization_id, q.id, 'resolved_in_batch',
            jsonb_build_object('batch_size', p_batch_size,
                               'took_over', q.id = any(coalesce(p_took_over, '{}')),
                               'chained', q.id = any(coalesce(p_chained, '{}'))),
            v_uid);
  end loop;
end;
$$;
revoke execute on function public.log_batch_resolution(uuid[], uuid[], uuid[], integer) from public, anon;
grant execute on function public.log_batch_resolution(uuid[], uuid[], uuid[], integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Résolution groupée d'une sélection libre.
-- ---------------------------------------------------------------------------

-- Taille maximale d'un lot — jumeau de `BATCH_MAX_SIZE`
-- (src/features/requests/resolution/batch.ts). Les avis de clôture partent un
-- par un depuis le navigateur : au-delà, une file d'envoi serait nécessaire.
create or replace function public.request_batch_max_size()
returns integer language sql immutable set search_path = '' as $$ select 50 $$;
revoke execute on function public.request_batch_max_size() from public, anon;
grant execute on function public.request_batch_max_size() to authenticated;

create or replace function public.resolve_requests(
  p_request_ids  uuid[],
  p_status       text,
  p_motif        text default null,
  p_closure_text text default null)
returns table (
  request_id uuid,
  reference  text,
  ok         boolean,
  error      text,
  took_over  boolean,
  chained    boolean)
language plpgsql volatile security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_ids  uuid[];
  v_id   uuid;
  one    record;
  v_ok_ids    uuid[] := '{}';
  v_took_ids  uuid[] := '{}';
  v_chain_ids uuid[] := '{}';
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if p_status is null or p_status not in ('resolue_positive', 'resolue_negative') then
    raise exception 'Résolution groupée : seule une résolution (positive ou négative) se fait en lot.';
  end if;
  -- Doublons retirés, ordre de la sélection conservé.
  select coalesce(array_agg(x.id order by x.first_pos), '{}') into v_ids
    from (select u.id, min(u.pos) as first_pos
            from unnest(coalesce(p_request_ids, '{}')) with ordinality as u(id, pos)
           where u.id is not null
           group by u.id) x;
  if cardinality(v_ids) = 0 then
    raise exception 'Résolution groupée : aucune demande sélectionnée.';
  end if;
  if cardinality(v_ids) > public.request_batch_max_size() then
    raise exception 'Résolution groupée : % demandes au plus par lot (% sélectionnées).',
      public.request_batch_max_size(), cardinality(v_ids);
  end if;

  foreach v_id in array v_ids loop
    select * into one from public.resolve_one_request(v_id, p_status, p_motif, p_closure_text);
    request_id := v_id; reference := one.reference; ok := one.ok; error := one.error;
    took_over := one.took_over; chained := one.chained;
    if one.ok then
      v_ok_ids := v_ok_ids || v_id;
      if one.took_over then v_took_ids := v_took_ids || v_id; end if;
      if one.chained then v_chain_ids := v_chain_ids || v_id; end if;
    end if;
    return next;
  end loop;

  if array_length(v_ok_ids, 1) > 0 then
    perform public.log_batch_resolution(v_ok_ids, v_took_ids, v_chain_ids, cardinality(v_ids));
  end if;
end;
$$;
revoke execute on function public.resolve_requests(uuid[], text, text, text) from public, anon;
grant execute on function public.resolve_requests(uuid[], text, text, text) to authenticated;
