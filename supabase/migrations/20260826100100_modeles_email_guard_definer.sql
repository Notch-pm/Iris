-- ============================================================================
-- Correctif : la garde des variables des modèles d'e-mail était en
-- SECURITY INVOKER.
--
-- Constat en navigateur, avec un vrai client `authenticated` : toute écriture
-- d'un modèle échouait en
--     « permission denied for function email_template_unknown_variables ».
-- La garde s'exécutait comme l'appelant, qui n'a aucun droit sur le catalogue
-- — justement révoqué pour fermer la surface cliente.
--
-- C'est le piège documenté du projet (CLAUDE.md §Pièges connus) : toute
-- fonction appelée depuis un trigger ou une policy doit être SECURITY DEFINER.
--
-- ⚠️ Le test SQL initial n'avait PAS attrapé ce défaut : ses scénarios
-- « la variable inconnue est refusée » utilisaient `exception when others then
-- null`, qui accueille N'IMPORTE QUELLE erreur comme un refus légitime — y
-- compris un `permission denied`. Le test a été durci pour vérifier le MESSAGE
-- du refus, pas seulement qu'il y en a un.
--
-- ⚠️ `create or replace` re-grante PUBLIC : on re-révoque juste après.
-- ============================================================================

create or replace function public.email_templates_guard_variables()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_unknown text[];
begin
  v_unknown := public.email_template_unknown_variables(new.subject);
  if array_length(v_unknown, 1) is not null then
    raise exception 'Variable inconnue dans l''objet : {{%}}.', array_to_string(v_unknown, '}}, {{');
  end if;

  v_unknown := public.email_template_unknown_variables(new.body);
  if array_length(v_unknown, 1) is not null then
    raise exception 'Variable inconnue dans le corps : {{%}}.', array_to_string(v_unknown, '}}, {{');
  end if;
  return new;
end;
$fn$;
revoke execute on function public.email_templates_guard_variables() from public, anon, authenticated;
