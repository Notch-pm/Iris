# Journal du contrat d'ingestion (`requests-api`)

Public : **les équipes qui émettent vers Iris**. Une entrée par version publiée du contrat
OpenAPI (`/v1/openapi.json`, rendu humain sur `/api-doc`).

Ce document est **append-only** : on ajoute en tête, on ne réécrit jamais une entrée publiée.
La politique v1 reste celle annoncée dans le contrat — **évolutions additives uniquement**, et
les consommateurs doivent tolérer les champs de réponse inconnus.

---

## 1.2.0 — 2026-08-26 — l'usager déclaré entre dans le référentiel

**Additif. Aucune enveloppe valide en 1.1.0 ne devient invalide.** Rien à changer chez vous ;
la lecture ci-dessous explique seulement ce qui change dans les demandes que vous recevez en
retour.

### Ce qui change

Jusqu'ici, une enveloppe portant une identité (`requester`) sans `socle_contact_id` produisait
une demande en `identity_status: "non_rapprochee"` : l'usager restait inconnu du référentiel,
et la demande n'était rattachable à rien.

Désormais, Iris **rapproche cette identité d'une fiche usager du Socle, et en crée une à
défaut** (décision PO du 2026-08-26 : sans correspondance, c'est une nouvelle personne). La
demande revient alors avec `identity_status: "rapprochee"` et le `socle_contact_id` obtenu.

### Ce que ça implique pour vous

- **Envoyez un identifiant fort dès que vous en avez un** — `email`, un téléphone, ou `siret`.
  La réutilisation d'une fiche existante n'a lieu que sur l'un d'eux. Un nom identique ne
  suffit **jamais** : aucun agent n'arbitre les homonymes à l'ingestion, et rattacher la
  demande d'un habitant à son homonyme donnerait à l'un accès aux échanges de l'autre. Sans
  identifiant fort, une nouvelle fiche est créée — c'est-à-dire, potentiellement, un doublon.
- `identity_status` que vous receviez à `non_rapprochee` passera le plus souvent à
  `rapprochee`, et `socle_contact_id` sera renseigné là où il était `null`. Si vous stockez
  ces champs, attendez-vous à ce changement.
- **Le Socle injoignable ne fait jamais échouer une ingestion** (même doctrine que le snapshot
  de démarche) : la demande est acceptée, reste en `non_rapprochee`, et porte l'anomalie
  `usager_a_creer_dans_socle` — à régulariser côté Iris.
- Un dépôt anonyme (`requester: { "anonymous": true }`) est inchangé : c'est un choix assumé,
  pas une identité incomplète. Une identité que rien ne nomme (un courriel seul, par exemple)
  ne crée pas de fiche non plus.
- Les clés d'identité acceptées sont désormais **documentées et plus larges** (plusieurs
  écritures par champ — `last_name`/`nom_naissance`/`nom`…). Les clés inconnues restent
  conservées telles quelles dans le dossier, et ne sont pas envoyées au référentiel.

Détail des champs : `requester` dans le contrat OpenAPI.

---

## 1.1.0 — 2026-08-20 — la démarche devient obligatoire

`socle_procedure_id` est **requis** : Iris ne gère aucune demande libre (règle impérative PO du
2026-08-20). Une démarche introuvable, obsolète ou hors du périmètre du tenant est refusée en
400. Le `procedure_snapshot` est construit **côté serveur** depuis le Socle — un émetteur ne
peut jamais l'imposer ; si le Socle est injoignable, un snapshot minimal du cache est posé avec
l'anomalie `referentiel_indisponible`, jamais un refus.

## 1.0.0 — première publication

Ingestion générique serveur-à-serveur : authentification par clé d'intégration, périmètre
dérivé de la clé, idempotence par `(source, external_id)` et `idempotency_key` (rejeu identique
→ 200, divergent → 409), pièces jointes par URL signée.
