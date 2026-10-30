# Consentements RGPD au dépôt

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Consentements RGPD au dépôt** (2026-09-20, remplace « accepte les mails / accepte les
  SMS ») : **deux** questions posées SYSTÉMATIQUEMENT à l'usager, quelle que soit la démarche —
  `traitement` (utilisation des informations pour instruire la demande, **OBLIGATOIRE** :
  sans lui le dépôt n'est pas validable) et `partage` (partage aux services de l'organisme
  principal, facultatif, proposé **coché**). **Ce ne sont PAS des champs de `form_schema`** et
  ils ne le seront pas : un consentement qu'un service pourrait décocher dans son paramétrage
  ne vaudrait rien. Catalogue **FERMÉ** dans `supabase/functions/_shared/consents/catalog.ts`
  (pur, testé, partagé écran ↔ edge functions).
  **Le navigateur n'envoie que `kind` et `granted`** : la phrase consignée est recomposée côté
  serveur depuis le nom de l'organisme principal (`organizations.name`, miroir de la racine
  Socle) — même doctrine que les snapshots, un `statement` venu d'un client est refusé. La
  garde vit dans `normalizeConsents`, appelée par `create-request-from-procedure`, jamais dans
  l'écran seul.
  **Deux écritures, et les deux sont nécessaires** : le **référentiel** est propriétaire du
  consentement d'une PERSONNE (Socle `contact_consents` + état dérivé sur `contacts`, via
  `POST /v1/contacts/{id}/consents`, idempotent par dépôt) ; `requests.consents` garde celui de
  CE DÉPÔT, **immuable** (`t10_requests_protect_immutable`), parce qu'un dépôt anonyme ou une
  identité non rapprochée n'a aucune fiche où écrire, et qu'un retrait ultérieur ne doit pas
  réécrire ce qui a été accepté ce jour-là. Un échec d'écriture au Socle ne refuse JAMAIS le
  dépôt : anomalie `consentement_non_transmis_au_socle`.
  À l'**ingestion partenaire**, `consents` est **facultatif** (le contrat 2.x n'évolue qu'en
  additif) : absent ⇒ anomalie `consentement_absent`, jamais une exigence rétroactive.
  ⚠️ Les consentements **franchissent désormais la frontière** vers le navigateur
  (`sanitizeContact`), à la différence d'`internal_notes` : Iris pose lui-même la question, un
  agent doit pouvoir lire ce que l'usager a accepté. `consent_email`/`consent_sms` restent
  hors d'Iris — obsolètes, conservés pour Clara seule.
