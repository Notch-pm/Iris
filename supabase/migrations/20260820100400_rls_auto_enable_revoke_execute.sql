-- ============================================================================
-- Fondations Iris — verrou : rls_auto_enable (event trigger préexistant qui
-- active le RLS sur toute nouvelle table de public — filet conservé) ne doit
-- pas être appelable via /rest/v1/rpc/… (advisor 0028). Sans effet sur son
-- déclenchement : Postgres ne vérifie l'EXECUTE qu'à la création du trigger.
-- ============================================================================
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
