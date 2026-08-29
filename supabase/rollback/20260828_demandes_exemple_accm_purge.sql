-- ============================================================================
-- PURGE du jeu de démonstration ACCM du 2026-08-28 (42 demandes,
-- DEM-2026-000008 à DEM-2026-000049).
--
-- ⚠️ NE JAMAIS APPLIQUER VIA `apply_migration` — même règle que
-- `20260822_profils_droits_rollback.sql`. Ce script se lance à la main, dans le
-- SQL editor du dashboard, quand on décide sciemment de reprendre la base.
--
-- POURQUOI IL EXISTE : une demande ne se supprime pas. Il n'y a aucune policy
-- DELETE sur `requests`, et un DELETE en service_role bute de toute façon sur
-- `t01_request_events_immutable` via la cascade du journal. Le jeu de
-- démonstration est donc DURABLE par construction : sans ce script, il reste.
--
-- CE QU'IL NE FAIT PAS : il ne touche ni aux 7 demandes antérieures
-- (DEM-2026-000001 à 000007), ni au référentiel, ni aux contacts du Socle — le
-- seed n'a créé aucun contact, il s'est appuyé sur les fiches de démonstration
-- `@exemple.fr` déjà présentes.
--
-- La sélection porte sur les UUID fixes du seed (`acc00000-…`), jamais sur les
-- objets ni sur une plage de références : un objet se retape, une référence se
-- décale, un UUID posé par le seed ne désigne que lui.
-- ============================================================================
do $purge$
declare
  v_accm uuid := '51a96071-6dc3-47e9-989e-5573ae4590aa';
  v_nb   integer;
begin
  execute 'alter table public.request_events disable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments disable trigger t01_request_assignments_immutable';

  -- request_messages, request_events, request_assignments, request_links et
  -- request_emails cascadent depuis requests ; le seed n'a créé aucune pièce
  -- jointe, donc rien à retirer du bucket `request-attachments`.
  delete from public.requests
   where organization_id = v_accm
     and id >= 'acc00000-0000-4000-8000-000000000001'::uuid
     and id <= 'acc00000-0000-4000-8000-0000000000ff'::uuid;

  get diagnostics v_nb = row_count;
  raise notice 'Jeu de démonstration ACCM purgé : % demandes supprimées.', v_nb;

  -- La séquence ne se remet à zéro que si PLUS AUCUNE demande ne reste sur le
  -- tenant : sinon on rendrait des références déjà attribuées.
  if not exists (select 1 from public.requests where organization_id = v_accm) then
    delete from public.request_sequences where organization_id = v_accm;
    raise notice 'Aucune demande restante sur ACCM : séquence de références remise à zéro.';
  end if;

  execute 'alter table public.request_events enable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments enable trigger t01_request_assignments_immutable';

  -- Trace des six migrations du seed dans l'historique du projet distant. Les
  -- retirer rendrait le miroir du dépôt menteur : on les CONSERVE, comme la
  -- trace de cette purge. (Les campagnes E2E, elles, effaçaient la ligne de leur
  -- seed jetable — ce jeu-ci n'est pas jetable, il a vécu.)
end
$purge$;
