-- ============================================================================
-- Paramètres de PUBLICATION des démarches dans le cache léger.
--
-- Le Socle a gagné deux notions que le sélecteur de démarche doit connaître
-- (2026-08-30), et qu'il ne faut jamais confondre :
--   · `status`  — le PARAMÉTRAGE est-il fini ? `brouillon` (en cours d'écriture)
--     ou `production` (déclarée prête). Une démarche en brouillon n'est
--     proposée NULLE PART, quelle que soit sa visibilité.
--   · `communication_config.visibility` — OÙ et QUAND proposer une démarche
--     déjà prête : portail usagers, période de publication (bornes incluses).
--
-- Ce que le cache retient est la publication EFFECTIVE, pas le bloc brut : les
-- valeurs par défaut du contrat (jamais paramétrée = visible, sans période) et
-- le commutateur `publicationPeriodEnabled` (qui conserve les dates sans les
-- appliquer) sont interprétés UNE FOIS à la frontière, par le module pur
-- `supabase/functions/_shared/procedures/publication.ts`. Aucun écran d'Iris
-- n'a donc à redécouvrir ces règles.
--
-- Le cache reste léger : quatre colonnes scalaires, aucun bloc JSON de plus.
-- Écriture : service_role uniquement (edge sync-socle-referentiel), inchangé.
--
-- ⚠️ Les lignes déjà en cache prennent le défaut `brouillon` : *fail closed*,
-- une démarche n'est proposée à la création qu'après une synchronisation qui
-- l'aura déclarée en production. C'est voulu — le contraire ouvrirait à la
-- création des démarches dont on ne sait rien.
-- ============================================================================

alter table public.socle_procedure_cache
  add column if not exists status text not null default 'brouillon'
    check (status in ('brouillon', 'production')),
  add column if not exists portal_visible boolean not null default true,
  add column if not exists publication_start date,
  add column if not exists publication_end date;

comment on column public.socle_procedure_cache.status is
  'Cycle de vie du PARAMÉTRAGE côté Socle : brouillon | production. Une démarche en brouillon n''est proposée nulle part dans Iris (fail closed : tout ce qui n''est pas explicitement « production » est un brouillon).';
comment on column public.socle_procedure_cache.portal_visible is
  'La démarche est proposée aux usagers sur le portail en ligne (communication_config.visibility.portalVisible). Défaut du contrat Socle : true — une démarche jamais paramétrée est visible.';
comment on column public.socle_procedure_cache.publication_start is
  'Premier jour de publication, INCLUS. NULL = pas de borne, ou période désactivée côté Socle (les dates y sont conservées mais ne s''appliquent pas).';
comment on column public.socle_procedure_cache.publication_end is
  'Dernier jour de publication, INCLUS. NULL = pas de borne, ou période désactivée côté Socle.';
