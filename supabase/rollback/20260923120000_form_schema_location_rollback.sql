-- Rollback de 20260923120000_form_schema_location.sql : `form_field_valid`
-- retrouve sa liste de types d'avant (sans `location`). ⚠️ Une démarche
-- publiée avec un lieu d'intervention redevient alors ILLISIBLE pour le
-- jumeau SQL : plus aucune exigence de pièce n'y est vue (voir l'en-tête de la
-- migration).

create or replace function public.form_field_valid(p_raw jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_type text;
  o      jsonb;
begin
  if p_raw is null or coalesce(jsonb_typeof(p_raw), '') <> 'object' then return false; end if;
  if coalesce(jsonb_typeof(p_raw -> 'type'), '') <> 'string' then return false; end if;
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
