-- ============================================================================
-- Demandes liées — RÉSOLUTION COMMUNE (lot L3 de docs/demandes-liees.md).
--
-- Quand l'agent résout une demande d'un groupe « même incident », il peut
-- résoudre avec elle les autres demandes du groupe, d'un seul geste.
--
-- Décision PO du 2026-10-16 :
--   « Lors d'une résolution commune, une demande à traiter peut être résolue
--     également automatiquement, pas de prérequis sur le fait de la faire passer
--     en cours d'instruction. L'agent qui résout une demande et les demandes
--     liées est considéré comme l'instructeur de toutes les demandes, s'il n'y
--     avait pas déjà d'agent instructeur affecté. »
--
-- Mise en œuvre SANS brèche dans la garde :
--   · la matrice de `requests_guard_write` n'est PAS ouverte (aucune transition
--     `a_traiter → resolue_*` nouvelle, ni pour l'écran ni pour l'API) : c'est
--     la RPC qui ENCHAÎNE elle-même, pour chaque demande qui n'est pas en
--     instruction, `→ en_instruction → résolution`, dans la même transaction ;
--   · une demande sans instructeur est affectée à l'agent qui résout ; une
--     affectation existante est conservée (`resolved_by` des statistiques =
--     l'auteur de la résolution, règle déjà en place) ;
--   · restent exigés, demande par demande : le droit d'instruction et de
--     clôture de l'agent sur le couple, et t17 (pièce obligatoire conforme pour
--     une résolution POSITIVE).
--
-- `resolve_linked_requests` est SECURITY INVOKER : chaque UPDATE traverse le RLS,
-- `requests_guard_write`, t17, le journal t30 et les statistiques t31 comme un
-- UPDATE client. Une transition par demande, chacune dans son bloc
-- `BEGIN … EXCEPTION` (sous-transaction) : le refus de l'une n'annule pas les
-- autres, et une demande refusée revient EXACTEMENT à son état (affectation
-- comprise). Le résultat est rendu demande par demande — l'écran annonce un
-- résultat PARTIEL honnête (« 7 sur 9 »).
--
-- `log_group_resolution` (DEFINER, `request_events` n'ayant aucune policy
-- d'écriture) ne consigne que des FAITS revérifiés : chaque demande est dans le
-- groupe de la source, résolue, et l'appelant y détient la clôture.
-- ============================================================================

create or replace function public.log_group_resolution(
  p_source_request_id uuid, p_request_ids uuid[], p_took_over uuid[], p_chained uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  s       record;
  v_group uuid;
  q       record;
  v_refs  text[] := '{}';
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  select r.id, r.organization_id, r.reference into s from public.requests r where r.id = p_source_request_id;
  select m.group_id into v_group from public.request_group_members m where m.request_id = p_source_request_id;
  if s.id is null or v_group is null or not public.can_consult_request(s.id) then
    raise exception 'Résolution commune : demande source introuvable ou hors groupe.';
  end if;

  for q in
    select r.id, r.organization_id, r.reference, r.status, r.socle_organization_id, r.socle_procedure_id
      from public.requests r
      join public.request_group_members m on m.request_id = r.id and m.group_id = v_group
     where r.id = any(coalesce(p_request_ids, '{}')) and r.id <> s.id
  loop
    if q.status not in ('resolue_positive', 'resolue_negative')
       or not public.request_right_for(v_uid, q.organization_id, q.socle_organization_id, q.socle_procedure_id, 'cloture') then
      continue;  -- on ne consigne que ce qui est vrai
    end if;
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (q.organization_id, q.id, 'resolved_with_group',
            jsonb_build_object('source_request_id', s.id, 'source_reference', s.reference,
                               'took_over', q.id = any(coalesce(p_took_over, '{}')),
                               'chained', q.id = any(coalesce(p_chained, '{}'))),
            v_uid);
    v_refs := v_refs || q.reference;
  end loop;

  if array_length(v_refs, 1) > 0 then
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (s.organization_id, s.id, 'group_resolution',
            jsonb_build_object('count', array_length(v_refs, 1), 'references', to_jsonb(v_refs)),
            v_uid);
  end if;
end;
$$;
revoke execute on function public.log_group_resolution(uuid, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.log_group_resolution(uuid, uuid[], uuid[], uuid[]) to authenticated;

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
  v_uid     uuid := auth.uid();
  v_group   uuid;
  v_id      uuid;
  r         record;
  v_n       integer;
  v_took    boolean;
  v_chain   boolean;
  v_motif   text := nullif(btrim(coalesce(p_motif, '')), '');
  v_text    text := nullif(btrim(coalesce(p_closure_text, '')), '');
  v_ok_ids  uuid[] := '{}';
  v_took_ids uuid[] := '{}';
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
    v_took := false;
    v_chain := false;
    select q.id, q.reference, q.status, q.assigned_to into r from public.requests q where q.id = v_id;

    if r.id is null then
      request_id := v_id; reference := null; ok := false; took_over := false; chained := false;
      error := 'Demande introuvable ou hors de votre périmètre.';
      return next; continue;
    end if;
    if v_id = p_source_request_id
       or not exists (select 1 from public.request_group_members m
                       where m.request_id = v_id and m.group_id = v_group) then
      request_id := v_id; reference := r.reference; ok := false; took_over := false; chained := false;
      error := 'Cette demande n''est pas liée à la demande résolue.';
      return next; continue;
    end if;
    if r.status not in ('a_traiter', 'en_instruction', 'en_attente') then
      request_id := v_id; reference := r.reference; ok := false; took_over := false; chained := false;
      error := 'Demande déjà close.';
      return next; continue;
    end if;

    begin
      -- 1. L'instructeur : l'agent qui résout, à défaut d'un instructeur déjà affecté.
      if r.assigned_to is null then
        update public.requests set assigned_to = v_uid where id = v_id;
        get diagnostics v_n = row_count;
        if v_n = 0 then raise exception 'Vous n''avez pas le droit de modifier cette demande.'; end if;
        v_took := true;
      end if;
      -- 2. Le passage par l'instruction, fait PAR LE SERVEUR (décision PO) :
      --    la garde reste celle de tout le monde.
      if r.status <> 'en_instruction' then
        update public.requests set status = 'en_instruction' where id = v_id;
        get diagnostics v_n = row_count;
        if v_n = 0 then raise exception 'Vous n''avez pas le droit de modifier cette demande.'; end if;
        v_chain := true;
      end if;
      -- 3. La résolution, avec le motif et le commentaire de la demande source.
      update public.requests
         set status = p_status, closure_motif = v_motif, closure_text = v_text
       where id = v_id;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'Vous n''avez pas le droit de clore cette demande.'; end if;

      ok := true; error := null;
      v_ok_ids := v_ok_ids || v_id;
      if v_took then v_took_ids := v_took_ids || v_id; end if;
      if v_chain then v_chain_ids := v_chain_ids || v_id; end if;
    exception when others then
      -- Sous-transaction annulée : la demande revient à son état, affectation comprise.
      ok := false; error := sqlerrm; v_took := false; v_chain := false;
    end;
    request_id := v_id; reference := r.reference; took_over := v_took; chained := v_chain;
    return next;
  end loop;

  if array_length(v_ok_ids, 1) > 0 then
    perform public.log_group_resolution(p_source_request_id, v_ok_ids, v_took_ids, v_chain_ids);
  end if;
end;
$$;
revoke execute on function public.resolve_linked_requests(uuid, uuid[], text, text, text) from public, anon;
grant execute on function public.resolve_linked_requests(uuid, uuid[], text, text, text) to authenticated;
