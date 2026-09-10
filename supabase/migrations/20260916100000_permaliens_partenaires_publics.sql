-- Permaliens de partenaire pointant sur une origine morte (2026-09-10).
--
-- Constat : la fiche d'une demande rend cliquable le permalien transmis par le
-- partenaire (`requests.external_url`, `request_links.external_url`). Deux
-- demandes venues de Clara portaient une adresse inexploitable :
--   * DEM-2026-000053 (10/09) — `http://localhost:8080/courrier/…` : le secret
--     `APP_ORIGIN` du projet Clara pointait sur un poste de développement. Cliqué
--     par un agent, ce lien désigne SA machine.
--   * DEM-2026-000006 (23/08) — `https://clara.notch.pm/courrier/…` : l'ancien
--     domaine, avant la bascule de la gamme sur `<app>.edilumen.fr`.
--
-- On réécrit l'ORIGINE, jamais le chemin : l'identifiant du courrier chez Clara
-- reste le sien. Le correctif durable vit ailleurs, en deux endroits :
--   * chez Clara, le secret `APP_ORIGIN` (cause racine) ;
--   * dans `requests-api`, la garde `_shared/permalink.ts` qui écarte désormais
--     à l'ingestion tout permalien ne résolvant que sur le réseau de l'émetteur
--     (anomalie `permalien_non_public`, contrat 2.1.0).
--
-- Aucune colonne immuable n'est touchée (`external_url` n'y figure pas), et
-- aucun déclencheur d'événement ni de notification ne réagit à ce champ.

update public.requests
   set external_url = 'https://clara.edilumen.fr'
                    || substring(external_url from '^https?://[^/]+(/.*)$')
 where source = 'clara'
   and external_url ~ '^https?://(localhost|clara\.notch\.pm)(:[0-9]+)?/';

update public.request_links l
   set external_url = 'https://clara.edilumen.fr'
                    || substring(l.external_url from '^https?://[^/]+(/.*)$')
  from public.requests r
 where r.id = l.request_id
   and r.source = 'clara'
   and l.external_url ~ '^https?://(localhost|clara\.notch\.pm)(:[0-9]+)?/';

-- Garde-fou : plus aucun permalien Clara sur une origine morte.
do $$
declare v_restants integer;
begin
  select count(*) into v_restants
    from public.requests
   where external_url ~ '^https?://(localhost|clara\.notch\.pm|127\.0\.0\.1)(:[0-9]+)?/';
  if v_restants > 0 then
    raise exception 'Permaliens non publics restants sur requests : %', v_restants;
  end if;

  select count(*) into v_restants
    from public.request_links
   where external_url ~ '^https?://(localhost|clara\.notch\.pm|127\.0\.0\.1)(:[0-9]+)?/';
  if v_restants > 0 then
    raise exception 'Permaliens non publics restants sur request_links : %', v_restants;
  end if;
end $$;
