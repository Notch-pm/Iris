-- ============================================================================
-- Source d'intégration PLATEFORME — une clé pour toutes les collectivités.
--
-- Jusqu'ici une source est rattachée à UN tenant, et sa clé aussi. C'est le bon
-- modèle pour un partenaire tiers : il ne dépose que chez lui. Ce n'est pas le
-- bon pour une application de la gamme qui sert TOUTES les collectivités depuis
-- une seule instance — le portail usagers (Nora) parle déjà au Socle avec une
-- clé plateforme. Constaté le 2026-09-22 : une clé Iris par collectivité, à
-- reposer toutes ensemble dans un secret que personne ne peut relire, n'est
-- pas tenable.
--
-- Une source plateforme est une ligne d'integration_sources SANS organisation.
-- Sa clé authentifie, mais ne désigne aucun tenant : c'est l'appel qui le nomme
-- (en-tête `X-Socle-Root-Organization-Id`, motif symétrique de la clé
-- plateforme Socle + `X-Organization-Id` qu'Iris envoie lui-même). Le tenant
-- doit alors avoir une source du MÊME code, active : les sources par
-- collectivité restent, sans clé — ce sont les interrupteurs, et le journal
-- reste par collectivité. Aucune logique propre à un émetteur.
-- ============================================================================

alter table public.integration_sources
  alter column organization_id drop not null;

comment on column public.integration_sources.organization_id is
  'Tenant de la source. NULL = source PLATEFORME : sa clé vaut pour toute collectivité qui a une source active du même code, désignée à l''appel par X-Socle-Root-Organization-Id.';

-- Un seul code par source plateforme (l'unicité (organization_id, code) ne
-- couvre pas les NULL).
create unique index if not exists integration_sources_platform_code_unique
  on public.integration_sources (code)
  where organization_id is null;

-- La RLS ne change pas : is_org_admin(NULL) n'est vrai que pour la plateforme,
-- donc une source plateforme n'apparaît à aucun administrateur de collectivité,
-- et sa gestion reste réservée à la plateforme (integration_sources_write).
-- requests_check_source ne change pas non plus : une demande exige toujours
-- une source ACTIVE du tenant — c'est précisément ce que la clé plateforme
-- vérifie avant d'écrire.
