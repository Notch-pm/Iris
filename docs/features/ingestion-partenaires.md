# Fondations et API d'ingestion `requests-api`

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Le schéma des fondations est appliqué** (miroirs dans `supabase/migrations/`) : tenants,
  membres/rôles, `requests` + satellites, storage privé, **modèle multi-source d'ingestion**
  (`integration_sources`/`integration_credentials`/`integration_api_logs`, registre de sources
  dynamique — aucune logique spécifique à un émetteur).
- **L'API d'ingestion `requests-api` est déployée et vérifiée** (18 + 7 scénarios HTTP bout
  en bout) : contrat OpenAPI **2.5.0** sur `/v1/openapi.json` (routes `/` et `/v1/openapi.json`
  **publiques et seules ouvertes au navigateur** — CORS ; rendu humain sur `/api-doc`), guide
  consommateurs dans [`docs/api-ingestion.md`](../api-ingestion.md). Périmètre dérivé de la clé (jamais d'un
  header/payload) — **sauf clé PLATEFORME** (2.3.0, 2026-09-22) : source sans tenant, réservée
  à une application de la gamme qui sert toutes les collectivités (le portail Nora), et
  l'en-tête `X-Socle-Root-Organization-Id` nomme la collectivité, qui doit avoir une source
  active du même code (interrupteur et journal restent par collectivité) ; **scope
  `requests:read_tenant`** (2.4.0, 2026-09-23) : lecture des demandes d'UN usager nommé
  (`?socle_contact_id=`) toutes sources confondues — vue usager de Clara —, jamais du tenant entier,
  et fil d'une demande `GET /v1/requests/{id}/timeline` (2.5.0 : texte, activité, **notes internes**,
  interventions — la seule sortie des notes internes, réservée à ce scope), **démarche obligatoire** (vérifiée dans le cache du tenant, snapshot
  construit côté serveur — dégradé + anomalie si Socle injoignable, jamais un refus), rejeu
  identique → 200, divergent → 409, pièces par URL signée uniquement (`form_field_key` pour
  rattacher une pièce à un champ du formulaire).
  Détail des tables, gardes et policies : [`docs/data-model.md`](../data-model.md).
  Tests d'étanchéité : `supabase/tests/fondations.test.sql` (transactionnel annulé,
  15 scénarios) + `supabase/tests/profils-droits.test.sql`. Visibilité par **sous-arbre**
  Socle et par démarche : livrée le 2026-08-22 par les profils de droits (bullet ci-dessous).
