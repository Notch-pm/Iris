-- ============================================================================
-- Le jumeau SQL du moteur de formulaire apprend le type `location`
-- (lieu d'intervention — contrat Socle `public-api` 1.29.0, 2026-09-22).
--
-- ⚠️ Pourquoi c'est indispensable AVANT qu'une démarche publiée porte ce
-- champ : `form_field_valid` est fidèle, pas tolérant — un type inconnu vide
-- TOUT le schéma (`form_schema_content` rend une liste vide), et
-- `request_piece_requirements` ne trouve alors plus AUCUNE exigence : la garde
-- t17 cesserait de bloquer `resolue_positive` sur une pièce obligatoire
-- manquante, pour toute démarche portant un lieu d'intervention. Le test Q1h
-- (qualification-pieces.test.sql) enshrine ce comportement pour un type
-- inconnu ; le cas Q1-location vérifie qu'un `location` ne l'est plus.
--
-- Rien d'autre ne change : aucune fonction du jumeau ne lit la VALEUR d'un
-- champ qui n'est pas une pièce. Le miroir TypeScript est
-- `create-request-from-procedure/_shared/procedureForm.ts` (même PR).
-- Rollback : supabase/rollback/20260923120000_form_schema_location_rollback.sql
-- ============================================================================

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
  -- `location` (Socle 1.29.0) : aucune option propre, rien de plus à vérifier.
  return v_type in ('text', 'textarea', 'number', 'date', 'email', 'phone', 'boolean', 'location');
end;
$$;
-- ⚠️ `create or replace` rend l'EXECUTE par défaut à PUBLIC : on le reprend.
revoke execute on function public.form_field_valid(jsonb) from public, anon, authenticated;
