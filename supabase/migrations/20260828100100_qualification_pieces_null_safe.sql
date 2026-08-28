-- ============================================================================
-- Correctif du jumeau SQL du moteur de formulaire (même jour que 100000).
--
-- SYMPTÔME, trouvé par `supabase/tests/qualification-pieces.test.sql` avant
-- toute mise en service : une pièce FACULTATIVE (« Pièce d'identité », ni
-- `required` ni `requiredIf`) était déclarée obligatoire par la garde, qui
-- refusait alors la résolution positive d'une demande que l'écran, lui,
-- montrait comme complète.
--
-- CAUSE — la propagation de NULL en SQL, là où JavaScript raisonne en
-- « falsy ». `p_field -> 'requiredIf'` vaut SQL NULL quand la clé est absente,
-- donc `jsonb_typeof(...) <> 'object'` vaut NULL, pas TRUE : le CASE ne prend
-- PAS cette branche, tombe dans le `else` et appelle `form_condition_met(NULL)`
-- — qui répond TRUE, à juste titre (« condition absente = satisfaite »), mais
-- pour la mauvaise question. Côté TypeScript, `if (!field.requiredIf) return
-- false` n'a pas ce trou.
--
-- Le même piège dormait dans cinq autres fonctions, TOUJOURS dans le sens
-- dangereux — accepter un nœud illisible, donc garder un schéma que l'écran
-- aurait vidé, donc bloquer sur une exigence invisible :
--   . form_condition_valid   — `rules` absent rendait la condition VALIDE ;
--   . form_field_valid       — `type`/`id`/`key`/`label` absents renvoyaient
--                              NULL, et `not NULL` ne déclenche aucun refus ;
--   . form_node_valid        — `id`/`title` absents sur une section ;
--   . form_schema_content    — `content` absent renvoyait NULL au lieu de [] ;
--   . form_condition_met     — `rules` absent (sans effet observable, corrigé
--                              par cohérence).
--
-- RÈGLE À RETENIR pour tout jumeau SQL d'un contrat JSON : comparer un
-- `jsonb_typeof` sans `coalesce(..., '')` est un bug en attente. Un test qui
-- passe par la garde RÉELLE (et non par la seule fonction) est ce qui l'attrape.
-- ============================================================================

create or replace function public.form_condition_valid(p_raw jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  r jsonb;
begin
  if p_raw is null or jsonb_typeof(p_raw) = 'null' then return true; end if;
  if coalesce(jsonb_typeof(p_raw), '') <> 'object' then return false; end if;
  if coalesce(p_raw ->> 'combinator', '') not in ('and', 'or') then return false; end if;
  if coalesce(jsonb_typeof(p_raw -> 'rules'), '') <> 'array' then return false; end if;

  for r in select * from jsonb_array_elements(p_raw -> 'rules') loop
    if coalesce(jsonb_typeof(r), '') <> 'object' then return false; end if;
    if coalesce(jsonb_typeof(r -> 'fieldId'), '') <> 'string' then return false; end if;
    if coalesce(jsonb_typeof(r -> 'operator'), '') <> 'string'
       or coalesce(r ->> 'operator', '') not in ('equals', 'notEquals', 'includes', 'isEmpty', 'isNotEmpty') then
      return false;
    end if;
    -- `value` : chaîne, tableau de chaînes, ou ABSENTE. Présente à `null` =
    -- invalide (parité stricte : côté TS, `r.value !== undefined` l'attrape).
    if r ? 'value' then
      if jsonb_typeof(r -> 'value') = 'array' then
        if exists (select 1 from jsonb_array_elements(r -> 'value') v
                    where coalesce(jsonb_typeof(v), '') <> 'string') then
          return false;
        end if;
      elsif coalesce(jsonb_typeof(r -> 'value'), '') <> 'string' then
        return false;
      end if;
    end if;
  end loop;
  return true;
end;
$$;
revoke execute on function public.form_condition_valid(jsonb) from public, anon, authenticated;

create or replace function public.form_condition_met(p_condition jsonb, p_values jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_or     boolean;
  r        jsonb;
  v_field  jsonb;
  v_target text;
  v_op     text;
  v_hit    boolean;
  v_any    boolean := false;
  v_all    boolean := true;
  v_count  int := 0;
begin
  if p_condition is null or coalesce(jsonb_typeof(p_condition), '') <> 'object' then
    return true;
  end if;
  -- Deux IF distincts, jamais un `or` : Postgres ne garantit pas le
  -- court-circuit, et jsonb_array_length d'un non-tableau lève une erreur.
  if coalesce(jsonb_typeof(p_condition -> 'rules'), '') <> 'array' then return true; end if;
  if jsonb_array_length(p_condition -> 'rules') = 0 then return true; end if;
  v_or := (p_condition ->> 'combinator') = 'or';

  for r in select * from jsonb_array_elements(p_condition -> 'rules') loop
    v_count  := v_count + 1;
    v_field  := coalesce(p_values, '{}'::jsonb) -> (r ->> 'fieldId');
    v_target := public.form_rule_target(r -> 'value');
    v_op     := r ->> 'operator';

    if v_op = 'isEmpty' then
      v_hit := public.form_value_empty(v_field);
    elsif v_op = 'isNotEmpty' then
      v_hit := not public.form_value_empty(v_field);
    elsif v_op = 'equals' then
      v_hit := public.form_rule_equals(v_field, v_target);
    elsif v_op = 'notEquals' then
      v_hit := not public.form_rule_equals(v_field, v_target);
    elsif v_op = 'includes' then
      v_hit := public.form_rule_includes(v_field, v_target);
    else
      v_hit := false;   -- opérateur inconnu : jamais satisfait (parité TS)
    end if;

    v_any := v_any or v_hit;
    v_all := v_all and v_hit;
  end loop;

  if v_count = 0 then return true; end if;
  return case when v_or then v_any else v_all end;
end;
$$;
revoke execute on function public.form_condition_met(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.form_field_valid(p_raw jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_type text;
  o      jsonb;
begin
  if p_raw is null or coalesce(jsonb_typeof(p_raw), '') <> 'object' then return false; end if;
  if coalesce(jsonb_typeof(p_raw -> 'type'), '') <> 'string' then return false; end if;
  -- parseCommon
  if coalesce(jsonb_typeof(p_raw -> 'id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_raw -> 'key'), '') <> 'string'
     or coalesce(jsonb_typeof(p_raw -> 'label'), '') <> 'string' then
    return false;
  end if;
  if not public.form_condition_valid(p_raw -> 'visibleIf') then return false; end if;

  v_type := p_raw ->> 'type';
  if v_type = 'attachment' then
    return public.form_condition_valid(p_raw -> 'requiredIf');
  end if;
  if v_type in ('select', 'radio', 'checkboxes') then
    -- `options` absent ou non-tableau reste valide (parité TS : la liste est
    -- alors vide) — d'où l'égalité nue, volontairement NULL-permissive ici.
    if jsonb_typeof(p_raw -> 'options') = 'array' then
      for o in select * from jsonb_array_elements(p_raw -> 'options') loop
        if coalesce(jsonb_typeof(o), '') <> 'object'
           or coalesce(jsonb_typeof(o -> 'value'), '') <> 'string'
           or coalesce(jsonb_typeof(o -> 'label'), '') <> 'string' then
          return false;
        end if;
      end loop;
    end if;
    return true;
  end if;
  return v_type in ('text', 'textarea', 'number', 'date', 'email', 'phone', 'boolean');
end;
$$;
revoke execute on function public.form_field_valid(jsonb) from public, anon, authenticated;

create or replace function public.form_node_valid(p_raw jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
begin
  if p_raw is null or coalesce(jsonb_typeof(p_raw), '') <> 'object' then return false; end if;
  if p_raw -> 'kind' = '"section"'::jsonb then
    if coalesce(jsonb_typeof(p_raw -> 'id'), '') <> 'string'
       or coalesce(jsonb_typeof(p_raw -> 'title'), '') <> 'string' then
      return false;
    end if;
    if not public.form_condition_valid(p_raw -> 'visibleIf') then return false; end if;
    if jsonb_typeof(p_raw -> 'fields') = 'array' then
      for f in select * from jsonb_array_elements(p_raw -> 'fields') loop
        if not public.form_field_valid(f) then return false; end if;
      end loop;
    end if;
    return true;
  end if;
  return public.form_field_valid(p_raw);
end;
$$;
revoke execute on function public.form_node_valid(jsonb) from public, anon, authenticated;

create or replace function public.form_schema_content(p_form_schema jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  n jsonb;
begin
  if p_form_schema is null or coalesce(jsonb_typeof(p_form_schema), '') <> 'object' then
    return '[]'::jsonb;
  end if;
  if (p_form_schema ? 'version') and (p_form_schema -> 'version') is distinct from '1'::jsonb then
    return '[]'::jsonb;
  end if;
  if coalesce(jsonb_typeof(p_form_schema -> 'content'), '') <> 'array' then
    return '[]'::jsonb;
  end if;
  for n in select * from jsonb_array_elements(p_form_schema -> 'content') loop
    if not public.form_node_valid(n) then return '[]'::jsonb; end if;
  end loop;
  return p_form_schema -> 'content';
end;
$$;
revoke execute on function public.form_schema_content(jsonb) from public, anon, authenticated;

-- LE correctif d'origine : sans les coalesce, un champ « pièce » sans
-- `requiredIf` tombait dans le `else` et devenait obligatoire.
create or replace function public.form_attachment_required(p_field jsonb, p_values jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when (p_field -> 'required') = 'true'::jsonb then true
    when coalesce(jsonb_typeof(p_field -> 'requiredIf'), '') <> 'object' then false
    when coalesce(jsonb_typeof(p_field -> 'requiredIf' -> 'rules'), '') <> 'array' then false
    when jsonb_array_length(p_field -> 'requiredIf' -> 'rules') = 0 then false
    else public.form_condition_met(p_field -> 'requiredIf', p_values)
  end;
$$;
revoke execute on function public.form_attachment_required(jsonb, jsonb) from public, anon, authenticated;

comment on function public.form_attachment_required(jsonb, jsonb) is
  'attachmentIsRequired : `required` statique OU `requiredIf` satisfaite. ⚠️ Chaque jsonb_typeof est enveloppé d''un coalesce : une clé absente rend NULL, et un CASE ne prend pas une branche NULL — c''est ce qui rendait toute pièce facultative obligatoire (correctif du 2026-08-28).';
