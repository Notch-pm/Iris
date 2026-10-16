# Demandes liées — étude fonctionnelle et technique

> **Public** : PO et équipe Iris · **Question traitée** : comment identifier les demandes qui
> signalent le même incident, les lier, et les résoudre ensemble ? · **Statut** : lots **L1, L2 et
> L3 livrés** le 2026-10-16 (réglages, groupes, lieux, liaison ; recherche serveur, carte « Même
> incident », « Signalements similaires » du guichet ; résolution commune depuis la fiche) ;
> L4 (assistant) et L5 à venir — le tableau et le mobile ne proposent pas encore la
> résolution commune · **Date** : 2026-10-16

Plusieurs habitants signalent souvent le même incident — un nid-de-poule, un lampadaire
éteint, un dépôt sauvage. Aujourd'hui chacun de ces signalements s'instruit et se clôt
séparément. L'objectif :

1. **identifier** les demandes approchantes, à la création et depuis la fiche ;
2. les **proposer** à l'agent, qui décide de les **lier** ;
3. à la résolution d'une demande liée, **proposer de résoudre les autres** avec elle.

Ce n'est pas pertinent partout : une carte de déchetterie accordée à un habitant n'en accorde
pas une autre à son voisin. Cette étude reprend et fusionne les entrées **B6** (liens entre les
demandes) et **B7** (résolution groupée) du [backlog](backlog.md).

## 0. Ce qui existe déjà

| Élément | Où | Limite |
|---|---|---|
| `request_links` (`doublon_de`, `issue_de_scission`, `liee_a`, `externe`) | `20260820100200_requests_satellites.sql` | Seul `liee_a` est écrit (paire symétrique, `useLinkRequests`) ; aucune trace au journal ; aucun effet sur la résolution |
| `requests.master_request_id` | `20260820100100_requests.sql` | N'existe que pour le motif `doublon`, que l'écran ne propose volontairement pas (`statuts.ts`) |
| « Demandes proches » | `creation/proches.ts`, `useNearbyRequests` | Calculées **dans le navigateur**, sur la seule **identité de l'usager** (même fiche Socle ou même nom déclaré), 20 candidats. Deux habitants différents signalant le même trou ne sont jamais rapprochés |
| `pg_trgm`, `unaccent`, `immutable_unaccent` | `20260901130000_recherche_insensible_aux_accents.sql` | Utilisés par la recherche globale seulement |
| Champ `location` (Socle 1.29.0) | `form_data` : `{address, lat, lon, precision, adjusted}` | Point **déclaré par l'usager** — une réponse au formulaire |
| Ancien bloc « Lieu d'intervention » | `instruction/lieu.ts` | Adresse sans point |
| Guichet IA, expurgation d'identité | `_shared/ai/socleClient.ts`, `context.ts`, `redact.ts` | Aucune tâche IA « en un coup » à sortie structurée aujourd'hui |

Ni PostGIS ni pgvector ne sont en place — et ni l'un ni l'autre n'est nécessaire (§3).

## 1. Modèle fonctionnel

### Arbitrages rendus (2026-10-16)

- **Éligibilité** : un **réglage Iris, démarche par démarche**, posé par un administrateur.
- **Forme** : un **groupe sans demande principale** — toutes égales ; lier A–B puis B–C forme
  un seul groupe.
- **Avis à l'usager** : à la résolution commune, **l'agent choisit sur le moment** de prévenir
  ou non les usagers des demandes liées.
- **Déclenchement** : **automatique au récapitulatif de création**, et **sur bouton depuis la
  fiche**. Rien à la simple consultation.

### Règles

- **Démarche « mutualisable »** : hors d'elles, rien ne change — ni recherche, ni groupe, ni
  proposition à la clôture.
- **Groupe** (à l'écran « Demandes liées ») : une demande appartient à **un groupe au plus** ;
  lier deux demandes de groupes différents **fusionne** les groupes ; délier retire la demande,
  et un groupe d'une seule demande disparaît. Même tenant obligatoirement ; démarches
  différentes admises si **toutes** sont mutualisables (le même trou arrive par « Voirie » et
  par un formulaire du portail) ; organismes différents admis.
- **Ce que voit l'agent** : les seuls membres que le RLS lui laisse lire. **Aucun compteur de
  demandes invisibles** — ce serait une fuite.
- **`liee_a` est conservé** comme lien générique « voir aussi » (même usager, sujets
  différents), sans effet. Le groupe est un concept distinct : **même incident**.
- **Résolution commune** : quand une demande groupée passe en `resolue_positive` ou
  `resolue_negative`, le dialogue commun ajoute « Résoudre aussi les demandes liées » :
  - les autres membres **ouverts**, cochés par défaut, chacun avec l'avertissement prévisible
    (pièce obligatoire non conforme, droit de clôture manquant) ;
  - la case « Prévenir les usagers des demandes liées » — les demandes issues de Clara n'en
    reçoivent jamais (`closureNoticeApplies`) ;
  - le motif et le texte de clôture sont repris pour toutes ;
  - le résultat est **partiel et honnête** (« 7 sur 9 résolues ») avec le refus de la garde
    pour chaque demande restée ouverte.
- **Rouvrir** une demande du groupe ne rouvre pas les autres.
- **Statistiques** : inchangées — chaque demande compte pour sa propre résolution (t31), et
  `resolved_by` reste l'agent.

### Décision PO (2026-10-16) — une demande « À traiter » se résout avec le groupe

> Lors d'une résolution commune, une demande à traiter peut être résolue également
> automatiquement, sans prérequis de passage en instruction. L'agent qui résout une demande
> et les demandes liées est considéré comme l'**instructeur de toutes**, s'il n'y avait pas
> déjà d'agent instructeur affecté.

**Mise en œuvre** — la décision s'obtient SANS ouvrir de brèche dans la garde :
- L'agent n'a **rien à faire au préalable** : la RPC `resolve_linked_requests` enchaîne
  elle-même, pour chaque demande `a_traiter`, `a_traiter → en_instruction → résolution`, dans
  la même transaction. La matrice de `requests_guard_write` reste inchangée (aucune transition
  `a_traiter → resolue_positive` n'est ouverte, ni pour l'écran, ni pour l'API) ; le journal
  montre honnêtement les deux étapes, la première marquée « par résolution commune ».
- **Affectation** : toute demande du lot **sans agent instructeur** est affectée à l'agent qui
  résout ; une affectation existante est **conservée**. Cohérent avec la règle des
  statistiques « l'agent qui a instruit = l'auteur de la résolution » (`resolved_by`).
- **Ce qui reste exigé, demande par demande** (non couvert par la décision, donc inchangé) :
  le droit de clôture de l'agent sur le couple de chaque demande, et la garde t17 — une pièce
  **obligatoire** non qualifiée conforme ferme la résolution *positive* de cette demande-là,
  qui apparaît alors dans le résultat partiel avec le motif.
- La garde d'affectation s'applique aussi : affecter l'agent exige qu'il détienne
  l'instruction sur le couple. Sinon, refus de cette demande, motif affiché.

## 2. Données

| Table | Contenu | Écriture |
|---|---|---|
| `procedure_link_settings` | `organization_id`, `socle_procedure_id`, `enabled`, `radius_m` (150), `window_days` (60) | RPC `save_procedure_link_settings`, administrateur (`has_admin_scope` sur la racine) |
| `request_groups` | `id`, `organization_id`, `created_by`, `created_at` | RPC seules |
| `request_group_members` | `group_id`, `request_id` **unique**, `organization_id`, `added_by`, `added_at` — FK `ON DELETE CASCADE` (la purge RGPD reste possible) | RPC seules |
| `request_locations` | `request_id` PK, `organization_id`, `lat`, `lon`, `address_norm` | Trigger sur `requests` (INSERT, UPDATE de `form_data`) + reprise |

- **Aucune colonne ajoutée à `requests`** : les gardes d'édition de `requests_guard_write`
  restent intactes.
- **`request_locations` ne recopie que le formulaire** : le point du champ `location` (clé
  trouvée par son `type` dans `procedure_snapshot->form_schema`, comme le jumeau
  `form_field_valid`) ou, pour l'ancien bloc, l'adresse normalisée sans point. **Iris ne
  géocode jamais pour stocker** — l'invariant cartographie tient.
- Index : btree `(organization_id, lat, lon)` (boîte englobante), GIN trigramme sur
  `address_norm`.
- RLS : la lecture suit la consultation de la demande ; **aucune policy d'écriture cliente**.
- Pièges de la gamme : `REVOKE EXECUTE` dans la même migration, `TO service_role` explicite,
  types régénérés, miroir de chaque migration.

## 3. Détection — tenir à plusieurs milliers de demandes ouvertes

**Le navigateur ne rapatrie jamais les demandes ouvertes.** Une RPC
`find_similar_requests(p_request_id | p_draft, p_limit)`, **SECURITY INVOKER** (bornée par le
RLS), préfiltre puis rend des **signaux bruts** :

- **Préfiltre** (indexé, sélectif) : même tenant, démarche mutualisable, `received_at` dans la
  fenêtre, statut ouvert **ou résolu depuis moins de 30 jours** (un trou déjà rebouché se lie
  et se résout avec le même texte), hors du groupe courant.
- **Signaux** : distance en mètres (haversine, après boîte englobante de `radius_m`) ;
  similarité d'adresse (`similarity` trigramme) faute de point ; similarité de texte
  (`word_similarity` sur objet + description sans accents), calculée sur le seul jeu
  préfiltré ; même démarche ; écart en jours.
- **Ordre grossier en SQL, `LIMIT 50`** ; le **score et son explication** (« à 40 m · déposée
  il y a 2 j · description proche ») dans un module pur testé `instruction/similaires.ts`, à la
  façon de `proches.ts`.
- **Coût** : le préfiltre ramène quelques centaines de lignes au pire ; l'ordre de grandeur
  est la milliseconde. PostGIS ou des embeddings restent une évolution si la qualité l'exige.
- **Au guichet**, `p_draft` porte démarche, organisme, lieu, objet et description ; la RPC
  n'écrit rien.

## 4. Écritures

- **`link_requests(a, b)`** et **`unlink_request(id)`** — `SECURITY DEFINER` (tables sans
  policy d'écriture) : tenant, éligibilité des démarches, droit d'**écriture** (création ou
  instruction) sur l'une et **consultation** de l'autre — le miroir de la règle actuelle de
  `request_links`. Création, extension ou fusion de groupe ; événements `request_linked` /
  `request_unlinked` au journal. ⚠️ **Jamais `is_service_context()`** dans ces fonctions :
  droits revérifiés par `auth.uid()`.
- **`resolve_linked_requests(ids, status, motif, closure_text)`** — **SECURITY
  INVOKER**, pour que `requests_guard_write`, t17 et le journal t30 s'appliquent exactement
  comme à un `UPDATE` client. **Une transition par demande**, chacune dans son bloc
  `BEGIN … EXCEPTION` (le refus de l'une n'annule pas les autres), chaînage éventuel par
  l'instruction et affectation de l'agent à défaut d'instructeur (§1, décision PO), résultat `{request_id, ok, error}[]`. La source de la
  résolution commune passe par `set_config` jusqu'à t30, qui la porte dans `status_changed`.
- **Ordre à l'écran** : la demande courante par le chemin existant, puis la RPC pour les
  autres, puis — si la case est cochée — les avis par `send-request-email` (`kind:
  "cloture"`), qui revérifie le droit de clôture et refuse déjà les demandes Clara. Une file
  d'envoi à la manière de `request_receipts` deviendra utile si les groupes grossissent.

## 5. L'assistant IA — sur action de l'agent seulement

- Bouton **« Affiner avec l'assistant »** sous la liste des candidats, sur la fiche comme au
  guichet.
- Edge function dédiée (ou mode de `request-email-assistant`, déjà en un coup) : la demande
  (ou le brouillon) et **10 candidats au plus**, **relus par le client JWT de l'agent** (un
  identifiant illisible ⇒ 400).
- Contexte **sans identité** (`REQUEST_CONTEXT_COLUMNS` + `redactValue`), lieu conservé ;
  prompt composé côté serveur.
- Sortie en lignes balisées `[[VERDICT: <id> | meme | different | incertain | motif]]`,
  analysées par un module pur qui **valide chaque identifiant contre la liste envoyée** (motif
  d'`extractProposal`) ; alias `feature: "rapprochement-demandes"` ; refus du guichet par
  `mapSocleFailure`.
- **L'assistant ne lie jamais** : il annote, l'agent décide.

## 6. Écrans

- **Paramètres › Démarches** : interrupteur « mutualisable », rayon, fenêtre.
- **Fiche** : carte « Demandes liées » (membres, statut, organisme, « Délier »), bouton
  « Rechercher des demandes similaires », candidats avec score expliqué, « Lier », « Affiner
  avec l'assistant » — seulement si la démarche est mutualisable.
- **Création** : section « Signalements similaires » à côté des « Demandes proches » (même
  usager) ; liaison après création, jamais bloquante.
- **Dialogue de transition** : la section du §1 — le tableau des demandes en hérite.
- Hors V1 : pastille « liée (N) » sur la liste, mobile, détection à l'ingestion.

## 7. Lots

| Lot | Contenu |
|---|---|
| **L0** | Cette étude ; B6/B7 du backlog renvoyés ici ; décision PO du §1 (rendue le 2026-10-16) |
| **L1** | Migrations (réglages, groupes, `request_locations` + reprise), RPC de liaison, test SQL d'étanchéité (inter-tenant, sous-arbres frères, fusion, démarche non mutualisable refusée), écran des Paramètres |
| **L2** | `find_similar_requests`, `similaires.ts`, panneau de la fiche, section du guichet, carte « Demandes liées » |
| **L3** | `resolve_linked_requests`, section du dialogue, avis optionnels, résultat partiel |
| **L4** | Assistant de rapprochement |
| **L5** (option) | Détection à l'ingestion (portail, API), pastille de liste, mobile |

## Vérification prévue

- `npm run lint`, `npm test` (`similaires.ts`, module de l'assistant).
- Tests SQL transactionnels : étanchéité, fusion, résolution commune avec refus partiel.
- `EXPLAIN ANALYZE` de `find_similar_requests` sur quelques milliers de demandes ouvertes
  générées dans une transaction annulée.
- Navigateur (jeu Rosny, 24 lieux vérifiés) : démarche rendue mutualisable, deux signalements
  à moins de 100 m, proposition au récapitulatif, liaison, résolution commune, journal, avis
  optionnel, assistant.
