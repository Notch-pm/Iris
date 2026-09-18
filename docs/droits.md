# Droits — Iris

> **Public** : administrateurs fonctionnels d'un tenant et développeuses/développeurs
> Iris · **Question traitée** : comment fonctionnent les profils de droits qui
> gouvernent la visibilité et l'instruction des demandes ? · **Dernière mise à jour** :
> 2026-09-13 · Schéma appliqué au projet Supabase `tqcoqlneybtbrrcvpkpk`
> (migrations `20260822100000` à `20260822100900`, puis `20260921100000` —
> invariant du dernier administrateur rendu différentiel ; miroirs dans
> `supabase/migrations/`).

Remplace le rôle binaire `agent | administrateur` (décision PO du 2026-08-20,
documentée en historique dans [`architecture-proposee.md`](architecture-proposee.md)
§4) par des **profils de droits**, attribuables cumulativement à un utilisateur, qui
gouvernent à la fois la visibilité des demandes et les actions permises dessus. Solde
l'écart n°1 de [`data-model.md`](data-model.md) (visibilité par sous-arbre Socle
jamais livrée), augmenté d'une dimension que l'architecture validée n'avait pas
anticipée : la **démarche**. Détail des tables, gardes et policies :
[`data-model.md`](data-model.md).

## Vocabulaire

| Terme | Sens | Ne pas confondre avec |
|---|---|---|
| **Profil de droits** | Objet nommé d'un tenant (`permission_profiles`) portant une administration (oui/non), un périmètre d'organisations et une matrice de démarches | `public.users` — « profils applicatifs », miroir de `auth.users` |
| **Attribution** | Lien (profil, utilisateur), `permission_profile_assignments` | **Affectation** d'une demande à un agent (`requests.assigned_to` / `request_assignments`) |
| **Droit** | consultation / création / instruction / clôture, plus l'attribut administration | **Statut** — position de la demande dans son cycle de vie ; **rôle** (`organization_members.role`, désormais dérivé, voir plus bas) |

## Modèle

- **Périmètre** — ensemble de nœuds du miroir `socle_organizations` du tenant
  (`permission_profile_organizations`), sémantique **sous-arbre implicite** : cocher
  un nœud inclut toute sa descendance (expansion faite côté serveur,
  `permission_profile_scope`, profondeur bornée à 10, anti-cycle).
- **Matrice** — couples (démarche du `socle_procedure_cache` du tenant → un
  sous-ensemble de {consultation, création, instruction, clôture}),
  `permission_profile_procedures`. Une ligne à quatre droits « non » est une
  **exception explicite** qui prime sur le défaut du profil (« tout sauf l'état
  civil »).
- **Défaut** (`default_view/create/process/close` sur `permission_profiles`) — droits
  appliqués à toute démarche **non listée** dans la matrice, y compris les démarches
  futures, ainsi qu'à la pseudo-démarche **« Sans démarche (historique) »**
  (`nil_procedure()` = `00000000-0000-0000-0000-000000000000`, qui couvre les
  demandes dont `socle_procedure_id IS NULL`). Valeur initiale : **aucun droit**
  (*fail closed* — une démarche créée dans le Socle est invisible de tous tant qu'un
  administrateur n'a pas agi).
- **Administration** (`is_admin`) — attribut du profil, **pas un cinquième niveau**
  de la matrice. N'accorde par lui-même **aucun** droit de lecture ni d'écriture sur
  les demandes (un « administrateur fonctionnel » au périmètre racine et à la
  matrice vide ne voit aucune demande).
- **Intervenant** (`is_intervenant`, 2026-09-14) — second attribut de profil,
  sur le même modèle que l'administration : ses titulaires peuvent être
  **sollicités** pour une intervention sur les demandes du **périmètre** du
  profil, pendant l'instruction. Il n'accorde par lui-même **aucun** droit sur
  les demandes : c'est la **sollicitation** (`request_interventions`) qui ouvre
  la demande à l'intervenant — résumé, pièces, journal, interventions ; **ni** les
  notes internes **ni** les échanges (`can_consult_request`). Un profil
  « Intervenant » sans autre droit est valide (modèle de reprise rapide
  « Intervenant » dans l'éditeur). Détail : [`data-model.md`](data-model.md)
  § « Interventions ».
- **Base de connaissances** (`knowledge_base_access`, 2026-09-18) — troisième attribut
  de profil, **marche/arrêt**, sans périmètre ni matrice : il ouvre l'écran « Base de
  connaissances » (catalogue des démarches **publiées** du tenant, leurs fiches, et
  l'assistant). **Activé sur tous les profils existants** à sa création ; un profil neuf
  part de `false`, et les modèles d'agent (Guichet, Instructeur, Superviseur,
  Consultation) le cochent. Un profil « Base de connaissances » seul est valide.
  ⚠️ C'est le droit d'ouvrir un **écran**, pas une frontière de données : ce que l'écran
  montre est déjà lisible par tout membre (catalogue miroité, `socle-proxy
  /v1/procedures/get`, lu par le rail « Procédure » du guichet et de l'instruction). La
  seule garde **serveur** qui en dépend est celle de l'assistant en mode démarche
  (`request-assistant` : droit de création **ou** cet attribut) — une question de
  budget IA, pas de confidentialité. ⚠️ `save_permission_profile` **conserve** la valeur
  en place quand la clé est absente du payload : un navigateur servi avant ce lot
  n'éteint pas l'accès des profils qu'il enregistre.
- Un profil est `active` ou `inactive` (désactivé = zéro droit produit ; les
  attributions restent, affichées grisées).
- Tout droit d'écriture (création, instruction, clôture) **implique** la
  consultation ; consultation seule = lecture stricte, aucune action.

## Sémantique de combinaison — par couple, jamais de produit cartésien

Les droits effectifs d'un utilisateur sur un couple (organisation, démarche) sont
l'**union**, sur ses profils **actifs** attribués dont le **périmètre contient
l'organisation**, des droits de la démarche dans **ce même profil** (ligne explicite
sinon défaut) :

```
droits(u, o, d) = ⋃ { matrice(p, d) | p profil actif attribué à u ET o ∈ périmètre(p) }
```

La conjonction (organisation ET démarche) est **interne à chaque profil** ; seule
l'union est faite entre profils. L'option rejetée est l'union séparée des
périmètres puis des matrices (produit cartésien) :

> Profil A = (Voirie ; « Signalement nid-de-poule » : instruction). Profil B =
> (CCAS ; « Aide sociale » : clôture). Un produit cartésien donnerait à l'utilisateur
> « Aide sociale » à Voirie ET « nid-de-poule » au CCAS — un droit que **personne n'a
> jamais accordé**, apparu par la seule addition de deux profils légitimes.

Contrepartie assumée : **un profil porte un seul périmètre pour toutes ses
démarches**. Un besoin mixte (« instruction sur D1 à Voirie + consultation sur D2
partout ») se modélise par **deux profils** attribués à la même personne — c'est ce
qui rend chaque droit effectif traçable à un profil unique (« quel profil m'accorde
cela ? » a toujours une réponse).

Rattachement d'une demande à son couple d'évaluation : `requests.socle_scope_org_id`
(destinataire s'il est connu du miroir du tenant, obsolescence comprise, racine
Socle du tenant sinon — voir [`data-model.md`](data-model.md#tables)) et
`coalesce(requests.socle_procedure_id, nil_procedure())`.

## Correspondance droits ↔ actions du workflow

| Droit / attribut | Donne accès à |
|---|---|
| **Consultation** | Demande dans la liste et les facettes, fiche complète (`procedure_snapshot`, `requester_snapshot`, `form_data`), pièces + URL signée storage, journal (`request_events`), historique d'affectation (`request_assignments`), liens (`request_links`), et **les notes internes** (`request_messages` — Iris n'a plus de rôle « lecteur » depuis le 2026-08-20 ; masquer les notes réintroduirait ce rôle) |
| **Consultation seule** | Lecture stricte : aucune transition, affectation, note, pièce ni lien |
| **Création** | Déposer une nouvelle demande (`create-request-from-procedure`) sur le couple (organisation destinataire, démarche), pièces du brouillon comprises |
| **Instruction** | Transitions `a_traiter→en_instruction`, `en_instruction→en_attente`, `en_attente→en_instruction`, `en_instruction→a_traiter` ; affectation/désaffectation (`assigned_to`) ; édition du dossier (`subject`, `body`, `priority`, `form_data`, `due_at`) ; ajout de pièces hors formulaire ; **requalification** de démarche (couple **actuel ET cible**) ; **transfert** d'organisation (couple actuel — la cible peut être hors périmètre de l'auteur, c'est le geste métier) |
| **Clôture** | Transitions terminales : `a_traiter→resolue_negative`, `a_traiter→annulee`, `en_instruction→resolue_positive\|resolue_negative\|annulee`, `en_attente→annulee` (exigences inchangées : `closure_text`, motif, `master_request_id` pour un doublon) |
| **Administration + clôture** | **Réouverture** (terminal → `en_instruction`) et **archivage/désarchivage** — exigent `has_admin_scope` sur l'organisation de la demande **en plus** de la clôture (« qui rouvre doit pouvoir reclore ») |
| **Notes internes** (écriture) | Créer : n'importe quel droit d'écriture (création, instruction ou clôture) sur le couple, `author_id = auth.uid()`. Modifier/supprimer : l'auteur avec ce même droit, **ou** administration sur l'organisation de la demande |
| **Pièces** | Ajout hors formulaire = instruction, `uploaded_by = auth.uid()`. Suppression = administration sur l'organisation de la demande. Aucune modification |
| **Liens** (`request_links`, `liee_a`) | Écriture ≥ création sur la demande **source** ; la **cible** doit être au moins consultable par l'auteur (hors contexte de service) ; suppression = administration |
| **Affectation** à un collègue | Exige l'instruction pour l'auteur du geste **et** au moins l'instruction pour le **destinataire** sur le couple retenu — garde serveur bloquante dès l'INSERT (une demande ne peut pas naître affectée à un agent sans droit) et à l'UPDATE, message français explicite |
| **Transfert** d'organisation | Instruction sur le couple actuel ; cible = toute organisation du sous-arbre du tenant, y compris hors périmètre de l'auteur (perte d'accès immédiate) |
| **Requalification** de démarche | Instruction sur le couple actuel **et** sur le couple cible |
| **Solliciter un intervenant** | Instruction sur le couple **et** demande `en_instruction` ; l'intervenant doit détenir un profil actif `is_intervenant` couvrant l'organisation porteuse (`eligible_intervenants`) |
| **Déclarer une intervention réalisée** | L'intervenant sollicité, et lui seul (admin plateforme compris) — aucun droit sur le couple n'est exigé |

## Règles d'exploitation

- **Nouvelle démarche Socle** : entre uniquement dans les **droits par défaut** de
  chaque profil (le défaut standard étant « aucun », elle est invisible de tous
  jusqu'à action d'un administrateur). Le **rapport de couverture**
  (`permission_coverage_report`) liste, par tenant, les couples (organisation ×
  démarche active) qu'aucun profil actif attribué ne couvre au niveau
  **instruction**, avec le nombre de demandes non terminales concernées — le
  garde-fou du *fail closed*.
- **Membres sans profil** : `members_without_profile` liste les membres du tenant
  sans aucune attribution active — à afficher en tête des Paramètres.
- **Reparentage Socle** : un changement de parent dans le Socle change la
  visibilité après la synchronisation quotidienne (`sync-socle-referentiel`).
  Comportement assumé, le Socle fait foi ; `sync_runs` permet de diagnostiquer un
  basculement.
- **Organisation obsolète** (`socle_organizations.obsoleted_at`) : reste utilisable
  pour la résolution d'ascendance et reste affichée dans les périmètres existants
  (sinon obsoléter un nœud rendrait ses demandes invisibles), mais n'est plus
  proposée à l'ajout dans un nouveau profil (contrôle côté UI).
- **Demandes historiques sans démarche** : pseudo-démarche « Sans démarche
  (historique) » (`nil_procedure()`), couverte par les droits par défaut d'un
  profil — avec les profils de reprise (tous droits par défaut), elles restent
  visibles et transitionnables exactement comme avant les profils de droits.
- **Destinataire NULL ou inconnu du miroir** : rattachement à la **racine Socle du
  tenant** (`socle_scope_org_id`) + anomalie `destinataire_inconnu` posée sur la
  demande — jamais d'invisibilité totale. Recalculé après chaque synchronisation
  par `refresh_request_scope_org` (appelée par `sync-socle-referentiel`).
- **Dernier administrateur** (invariant de tenant) : un tenant qui compte au moins
  un utilisateur détenant l'administration sur la **racine Socle** n'en perd jamais
  le dernier. Toute opération qui le violerait est refusée avec un message français
  explicite — vérifié à **deux** endroits distincts, sans contournement, admin
  plateforme compris : `assert_tenant_keeps_root_admin` (appelée par
  `save_permission_profile`, `set_permission_profile_status`,
  `revoke_permission_profile`) pour le chemin « profils », et le trigger
  `t05_organization_members_protect_last_admin`
  (`organization_members_protect_last_admin`, BEFORE DELETE, contourné en contexte
  de service uniquement) pour le chemin « retrait du membre lui-même ».
  L'invariant est **différentiel** (2026-09-13, `20260921100000`) : chacune des
  trois RPC mesure l'état d'avant (`tenant_has_root_admin`, interne) et ne joue
  l'assertion que s'il était satisfait. Écrit en post-condition absolue, il
  interdisait au **premier profil d'un tenant neuf** de naître — aucun profil sans
  administrateur attribué, aucun administrateur sans profil : verrou circulaire
  constaté à l'ouverture de SNA27, sans contournement possible puisque c'est la
  seule garde du projet qu'un admin plateforme ne lève pas. « Conserver » un
  administrateur, c'est interdire le passage de ≥ 1 à 0 ; un tenant à 0 n'a rien à
  conserver, et la propriété garantie est inchangée. Le chemin « retrait du membre »
  (`is_last_root_admin`) était déjà différentiel par construction. Deux scénarios
  de `profils-droits.test.sql` couvrent désormais le geste réel (par la RPC, sur un
  tenant vierge) — les autres sèment leurs profils par `insert` direct, ce qui
  explique que le verrou n'ait pas été vu.
- **Verrou optimiste** : `permission_profiles.version` est vérifiée
  (`expected_version`) et incrémentée à chaque écriture composite ; divergence →
  refus avec invitation à recharger, jamais de fusion silencieuse.
- **Journal** (`permission_audit_log`, append-only, `forbid_change`) : toute
  création, modification, activation/désactivation, suppression de profil, toute
  attribution/retrait est tracée (qui, quand, quoi, avant/après). Lisible par les
  administrateurs du tenant (`is_org_admin_anywhere`).

## Non-escalade

Un administrateur ne peut **jamais** accorder plus qu'il ne détient lui-même — ni en
périmètre, ni en niveau de droit :

- **Autorité sur le profil existant** (`assert_editor_can_manage_profile`,
  appelée en tête de toute RPC d'écriture avant mutation) : vérifie
  `is_org_admin_anywhere`, puis `has_admin_scope` sur **chaque** organisation du
  **périmètre actuel** du profil visé, puis l'inclusion couple par couple des
  droits que ce profil porte **déjà** dans ceux de l'éditeur. Sans ce contrôle, un
  administrateur de sous-arbre pourrait réécrire le profil racine d'un tiers avec
  son propre périmètre étroit.
- **Non-escalade du contenu proposé** (dans `save_permission_profile`) : une
  **pré-image** des droits de l'éditeur (`v_pre`) est capturée **avant toute
  mutation**, encodée `droit|organisation|organisation_porteuse|démarche`. Après
  écriture, chaque couple que le profil **écrit** accorderait doit figurer dans
  `v_pre` — sinon refus (« Ce profil accorderait le droit « % » que vous ne
  détenez pas vous-même sur tout son périmètre. »), contourné uniquement par
  `is_platform_admin()`.
- **Pourquoi une pré-image plutôt qu'une exclusion du profil édité** : une
  première version excluait le profil en cours d'édition des droits de l'éditeur,
  évaluée **après** mutation — elle cassait le cas ordinaire d'un administrateur
  dont l'**unique** profil est justement celui édité (le compte fondateur avec son
  profil « Administrateur » de reprise) : plus aucun droit une fois ce profil
  exclu, donc refus même d'un simple renommage. La pré-image, capturée avant
  toute mutation, reflète fidèlement ce que l'éditeur détenait avant **cet appel
  précis** (profil édité compris) et supprime le besoin de toute exclusion.
- **Administration** (`is_admin = true`) : autorisée seulement si l'éditeur détient
  lui-même `has_admin_scope` sur **tout le périmètre proposé** — vérifié en
  pré-mutation (le périmètre écrit est le périmètre proposé, aucune revalidation
  post-mutation nécessaire).
- Ces gardes s'appliquent aussi aux profils **inactifs** (on ne prépare pas un
  profil hors-la-loi qu'on réactivera plus tard) et à **toutes** les opérations de
  gestion : édition, changement de statut, suppression, attribution, retrait.

## Reprise des données existantes

La migration de reprise (M6) crée, dans **chaque tenant existant**, deux profils
« ordinaires » (renommables, modifiables, supprimables sous réserve de l'invariant
du dernier administrateur) :

| Profil | Administration | Périmètre | Matrice | Défaut |
|---|---|---|---|---|
| **Administrateur** | oui | racine Socle du tenant | vide | consultation + création + instruction + clôture |
| **Agent** | non | racine Socle du tenant | vide | consultation + création + instruction + clôture |

Attribution automatique selon `organization_members.role` **avant** sa dérivation :
« Administrateur » à tout membre `role = 'administrateur'`, « Agent » sinon. Le
défaut « tous droits » couvre les démarches futures et la pseudo-démarche
historique ; le périmètre racine couvre les demandes à destinataire NULL ou
inconnu : **équivalence stricte** avec le comportement antérieur (tout membre
voyait et pouvait tout faire sauf réouverture/archivage/paramètres, réservés à
l'administrateur). Garde-fou préalable de la migration : elle échoue explicitement
si un tenant n'a **aucun** membre `role = 'administrateur'` avant bascule (il
naîtrait verrouillé, RM-42 ne pourrait plus jamais être satisfait que par l'admin
plateforme).

## Rôle dérivé transitoire

`organization_members.role` **reste en base** (compatibilité front/edge functions
pendant la bascule progressive) mais n'est plus une source d'autorité : un trigger
BEFORE INSERT/UPDATE (`organization_members_force_role`) **écrase** toute valeur
fournie par un client avec `member_role_derived(organization_id, user_id)` —
`administrateur` si l'utilisateur détient une attribution active à un profil
`is_admin` dans ce tenant, `agent` sinon. Rafraîchi après toute écriture de profil
ou d'attribution (`refresh_member_roles`, appelée par les RPC ; triggers
`t95_permission_profiles_refresh_roles` /
`t95_permission_profile_assignments_refresh_roles` en filet pour toute écriture
hors RPC). `is_org_admin(org_id)` est **redéfinie** sur `has_admin_scope` (racine du
tenant) et continue de gouverner les gestes **globaux** (membres, journal des
intégrations) ; les gestes liés à une demande précise passent tous par
`has_admin_scope(org, socle_scope_org_id)`. `is_org_writer` est **supprimée** (plus
de sens hors du couple organisation/démarche) — planifié : retrait de la colonne
`role` elle-même dans une vague ultérieure, pour éviter une seconde source de
vérité.

## Admin plateforme

`users.is_platform_admin` contourne l'ensemble du dispositif (`is_platform_admin()`
dans chaque garde), y compris pour dépanner un tenant verrouillé — **sauf**
l'invariant du dernier administrateur (`assert_tenant_keeps_root_admin`), qui
s'applique sans aucune exception : un admin plateforme qui retirerait le dernier
administrateur racine sans en ajouter un autre casserait quand même la propriété
que cet invariant garantit. C'est précisément pourquoi cet invariant doit rester
**différentiel** (§ « Dernier administrateur ») : n'ayant pas de contournement, une
post-condition absolue rendait un tenant neuf définitivement inadministrable — y
compris pour l'admin plateforme, seul à pouvoir l'ouvrir.

## RPC — seule porte d'écriture des profils

Les 5 tables `permission_*` n'ont **aucune policy d'écriture cliente** (§ ci-dessous) :
les RPC sont l'unique chemin, `SECURITY DEFINER`, `EXECUTE` révoqué de
`public`/`anon`, accordé à `authenticated`.

| RPC | Rôle | Qui peut appeler | Erreurs françaises (extrait) |
|---|---|---|---|
| `save_permission_profile(p jsonb) → jsonb {id, version}` | Création ou édition atomique (en-tête + périmètre + matrice) | Administrateur du tenant, dans son périmètre (non-escalade) | « Le nom du profil est obligatoire. », « Sélectionnez au moins une organisation. », « Ce profil n'accorderait aucun droit. », « Votre périmètre d'administration ne couvre pas l'organisation %. », « Ce profil accorderait le droit « % » que vous ne détenez pas vous-même sur tout son périmètre. », « Ce profil a été modifié entre-temps par quelqu'un d'autre ; rechargez avant de réessayer. », « Le tenant doit conserver au moins un administrateur sur l'organisation racine. » |
| `set_permission_profile_status(p_profile_id, p_status, p_expected_version) → jsonb` | Active/désactive (RM-52) | Idem, sur le profil visé | « Statut invalide : %. », verrou optimiste, dernier administrateur |
| `delete_permission_profile(p_profile_id, p_expected_version) → jsonb` | Supprime (refusé si des attributions subsistent) | Idem | « Ce profil est attribué à au moins un utilisateur : désactivez-le plutôt que de le supprimer. » |
| `assign_permission_profile(p_profile_id, p_user_id) → jsonb` | Attribue (idempotente) | Idem, cible = membre du tenant | « Cet utilisateur n'est pas membre de ce tenant. » |
| `revoke_permission_profile(p_profile_id, p_user_id) → jsonb` | Retire (idempotente) | Idem | Dernier administrateur (`assert_tenant_keeps_root_admin` après le DELETE) |
| `my_rights(p_org_id) → jsonb` | Profils de l'appelant, périmètre déjà expansé côté serveur (`{organization_id, is_platform_admin, is_admin, no_procedure_id, profiles[]}`) | Tout membre du tenant | « Ressource introuvable. » si non membre |
| `eligible_assignees(p_request_id) → table(user_id, display_name, email)` | Membres du tenant détenant l'instruction sur le couple de la demande — alimente le sélecteur d'affectation | Quiconque peut lire la demande | « Demande introuvable. » |
| `eligible_intervenants(p_request_id) → table(user_id, display_name, email)` | Membres sollicitables comme intervenant (profil actif `is_intervenant` couvrant l'organisation porteuse) | Quiconque peut lire la demande | « Demande introuvable. » |
| `request_intervention(p_request_id, p_intervenant_id, p_requested_for, p_comment) → jsonb {id}` | Sollicite un intervenant (2026-09-14) — journal + notification `intervention_requested` | Instruction sur le couple, demande `en_instruction` | « Une intervention ne se sollicite que sur une demande en cours d'instruction. », « Cette personne n'est pas intervenant sur l'organisme de la demande. », « La date d'intervention demandée ne peut pas être passée. », « Cet intervenant a déjà une intervention en attente sur cette demande. » |
| `complete_request_intervention(p_intervention_id, p_completed_on, p_comment, p_upload_ids uuid[]) → jsonb` | Déclare l'intervention réalisée, avec jusqu'à 4 justificatifs reçus par `request-attachments` (portée `intervention_id`) — journal + notification `intervention_completed` | L'intervenant sollicité | « Seul l'intervenant sollicité peut déclarer cette intervention réalisée. », « La date de finalisation ne peut pas être future. », « Cette intervention est déjà déclarée réalisée. », « Au plus 4 justificatifs par intervention. » |
| `permission_coverage_report(p_org_id) → table(...)` | Couples non couverts au niveau instruction + demandes non terminales concernées (RM-62, hors RLS par construction) | Administrateur du tenant | « Accès réservé aux administrateurs. » |
| `members_without_profile(p_org_id) → table(user_id, display_name, email)` | Membres sans attribution active | Administrateur du tenant | « Accès réservé aux administrateurs. » |

## Helpers RLS et fonctions internes

Toutes `SECURITY DEFINER`, `search_path = ''` (anti-récursion). Sauf mention
contraire, `EXECUTE` révoqué de `public`/`anon`, accordé à `authenticated`.

| Fonction | Rôle | EXECUTE |
|---|---|---|
| `nil_procedure()` | Pseudo-démarche « sans démarche » (constante `IMMUTABLE`) | `authenticated` |
| `uuid_or_null(text)` | Cast protégé texte→uuid (segments de chemin storage) | `authenticated` |
| `rights_array(bool,bool,bool,bool)` | Sérialise 4 booléens vers `['consultation',...]` | `authenticated` |
| `request_scope_org(org_id, socle_org_id)` | Organisation porteuse des droits (destinataire connu du miroir sinon racine) | **interne**, aucun grant client |
| `permission_profile_scope(profile_id)` | Expansion seule du périmètre d'un profil (sous-arbre) | **interne** |
| `permission_pairs_of(profile_ids[], right, org_id?)` | **Moteur unique** de la sémantique par couple — toutes les policies et tous les contrôles unitaires en dépendent, aucune seconde implémentation | **interne** |
| `my_permission_pairs(right)` | Couples autorisés de l'utilisateur courant — utilisée par les policies (`IN` non corrélé) | `authenticated` |
| `user_has_request_right(user_id, org_id, socle_org_id, socle_procedure_id, right)` | Contrôle unitaire (arguments bruts) ; sondage d'un tiers restreint aux co-membres du même tenant côté client | `authenticated` |
| `has_admin_scope(org_id, socle_org_id)` | Administration effective sur une organisation (remontée d'ascendance) | `authenticated` |
| `is_org_admin_anywhere(org_id)` | Administration quelque part dans le tenant — ouvre les Paramètres | `authenticated` |
| `has_any_creation_right(org_id)` | Création quelque part dans le tenant (utilisateur courant) — storage brouillon | `authenticated` |
| `has_any_creation_right_for(user_id, org_id)` | Idem, paramétrée par utilisateur — appelée par `socle-proxy` en service_role | **révoquée aussi de `authenticated`** |
| `can_read_request` / `can_write_request` / `can_process_request` / `can_admin_request(request_id)` | Enveloppes par id de demande — réservées aux policies storage et usages ponctuels (les satellites utilisent un `EXISTS` direct, pas ces fonctions). Depuis le 2026-09-14, `can_read_request` = consultation par couple **ou** sollicitation comme intervenant | `authenticated` |
| `can_consult_request(request_id)` | Consultation par couple **sans** la sollicitation (l'ancienne `can_read_request`) — garde des notes internes et des échanges | `authenticated` |
| `my_intervention_request_ids()` | Demandes ouvertes à l'appelant par une sollicitation — sous-requête non corrélée de `requests_select` | `authenticated` |
| `is_intervenant_for(user_id, org_id, socle_org_id)` | Sollicitable sur cette organisation porteuse (profil actif `is_intervenant`, périmètre en sous-arbre) | **interne** |
| `has_knowledge_base_access_for(user_id, org_id)` | Accès à la base de connaissances (profil ACTIF `knowledge_base_access`, ou admin plateforme) — appelée par `request-assistant` en service_role (2026-09-18) | **révoquée de `authenticated`**, accordée à `service_role` |
| `paris_today()` | Jour courant vu de France (les dates saisies sont celles d'un agent en France, le serveur est en UTC) | **interne** |
| `request_exists(id)` | Existence brute d'une demande, **hors RLS** — distingue un vrai brouillon d'une demande existante mais invisible | `authenticated` |
| `is_last_root_admin(org_id, user_id)` | Vrai si l'utilisateur est l'unique détenteur actif de l'administration racine | `authenticated` |
| `member_role_derived(org_id, user_id)` | `role` dérivé (administrateur/agent) | **interne** |
| `refresh_member_roles(org_id)` | Recalcule `organization_members.role` pour un tenant | **interne** |
| `refresh_request_scope_org(org_id?)` | Recalcule `socle_scope_org_id` + anomalie `destinataire_inconnu` après une sync Socle | **interne**, appelée par `sync-socle-referentiel` |
| `is_org_admin(org_id)` | **Redéfinie** : administration sur la racine du tenant (gestes globaux) | `authenticated` |
| `validate_permission_profile_shape(profile_id)` | RM-05/RM-06 — appelée post-mutation par `save_permission_profile` | **interne** |
| `assert_tenant_keeps_root_admin(org_id)` | Invariant du dernier administrateur, sans contournement | **interne** |
| `assert_editor_can_manage_profile(org_id, profile_id?)` | Autorité sur le profil existant, pré-mutation | **interne** |

Advisor 0029 (fonctions `SECURITY DEFINER` appelables par `authenticated`) : assumé
pour toutes celles marquées `authenticated` ci-dessus — même posture que les sept
helpers historiques (`data-model.md`), le RLS les évalue avec les droits de
l'appelant et elles ne révèlent que l'appartenance/les droits de l'appelant
lui-même (sauf `user_has_request_right`, qui porte sa propre garde anti-sondage).

## Piège SECURITY DEFINER / current_user — règle de projet

Vérifié empiriquement le 2026-08-22 : à l'intérieur d'une fonction `SECURITY
DEFINER`, `current_user` devient le **propriétaire** de la fonction (ex.
`postgres`), y compris en cascade derrière plusieurs `DEFINER` imbriqués — le
changement n'est **pas** « ré-empilé » par appelant. `is_service_context()` (qui
teste `current_user`) y vaut donc **toujours vrai**, même pour un vrai client
authentifié passé par une RPC `DEFINER`. Deux conséquences concrètes rencontrées
dans ce lot :

- Les invariants RM-05/06/38/39/42 étaient initialement portés par des
  **constraint triggers différés** — abandonnés : ils auraient été soit
  systématiquement court-circuités (le test `is_service_context()` y est toujours
  vrai), soit, une fois corrigés pour tester autre chose, en échec « permission
  denied » **au COMMIT en production** (un trigger différé s'exécute après le
  retour de la fonction `DEFINER` appelante, où `current_user` est revenu à
  `authenticated`, qui n'a pas l'`EXECUTE` sur les fonctions de garde). **Décision
  du projet : aucun constraint trigger différé** — les validations sont appelées
  **explicitement et immédiatement** par les RPC (M4/M5).

**Règle impérative pour toute nouvelle garde posée à l'intérieur d'une fonction
`SECURITY DEFINER`** : ne **jamais** y tester `is_service_context()`. Utiliser
selon le besoin :

- `is_platform_admin()` (fondée sur `auth.uid()`, lu depuis le GUC
  `request.jwt.claims`, insensible au changement de `current_user`) pour un
  contournement explicite de type RM-24 ;
- `current_setting('role', true)` (reflète le rôle **positionné par PostgREST
  pour la requête** — `SET LOCAL ROLE authenticated | service_role` — lui aussi
  insensible à `SECURITY DEFINER`) pour distinguer un appel client d'un appel
  service_role, comme dans `user_has_request_right` ;
- ou décider le contournement **côté appelant**, dans une fonction restée
  `SECURITY INVOKER` (motif `requests_guard_write`, `requests_before_insert_guard`,
  `organization_members_protect_last_admin` : ces trois triggers restent
  volontairement `INVOKER`, sans `security definer`, précisément pour que
  `is_service_context()` y demeure fiable).

## Risques résiduels assumés

- `/v1/procedures/*` (`socle-proxy`) et `socle_procedure_cache` restent lisibles
  par tout membre du tenant, indépendamment de ses droits (seule `/v1/contacts/*`
  exige un droit de création). L'UI ne sollicite les démarches que pour celles
  autorisées, mais rien ne l'empêche techniquement côté serveur.
- **Écriture dans le référentiel Socle** (`/v1/contacts/create` et, depuis le
  2026-08-23, `/v1/contacts/update`) : gardée par le **même** droit que le reste
  de `/v1/contacts/*`, c'est-à-dire « au moins un droit de création de demande
  dans le tenant ». Corriger une fiche usager du Socle est donc à la portée de
  tout agent qui peut déposer une demande, et la correction vaut pour toute la
  gamme (Clara comprise). Hypothèse retenue faute de droit dédié dans le modèle ;
  **à durcir** (administration du tenant, ou nouveau droit « référentiel ») si le
  PO le décide — la garde tient en une condition dans l'edge function. Même
  question ouverte pour l'archivage d'un usager, non livré (voir
  [`data-model.md`](data-model.md) § Écarts, point 7).
- Audit (`permission_audit_log`) et annuaire (profils, `members_without_profile`)
  sont gardés par `is_org_admin_anywhere` : un administrateur d'un simple
  sous-arbre voit l'intégralité du journal et de l'annuaire du tenant, pas
  seulement son périmètre.
- Numérotation des demandes toujours **séquentielle par tenant** : un agent
  restreint peut inférer le volume global du tenant (risque déjà documenté,
  inchangé par ce lot).
- `user_has_request_right` reste **sondable** par un co-membre du même tenant
  (l'appelant et la cible doivent partager le tenant, mais un co-membre peut
  sonder les droits d'un autre co-membre — nécessaire à `eligible_assignees` et à
  la garde d'affectation, RM-16).
- `requests.version` est incrémentée par `refresh_request_scope_org` (recalcul
  post-synchronisation Socle) — sans conséquence tant que l'outbox webhook n'est
  pas branchée (phase 4), à revoir à ce moment-là.

## Rollback

En cas d'abandon du lot **après déploiement** : exécuter manuellement
[`supabase/rollback/20260822_profils_droits_rollback.sql`](../supabase/rollback/20260822_profils_droits_rollback.sql)
— **jamais via `apply_migration`**, ce script n'est pas une migration et ne vit pas
sous `supabase/migrations/`. Il restaure à l'identique les policies/gardes de
`requests`, des satellites et du storage telles qu'elles étaient avant ce lot, ainsi
que `is_org_writer`/`is_org_admin` (version rôle), et laisse **inertes** (aucune
donnée perdue, re-déploiement possible sans purge) : les 5 tables de profils,
`permission_audit_log`, la colonne `requests.socle_scope_org_id` et les RPC.
Procédure de rejeu des tests et de vérification de performance :
[`supabase/tests/README-profils.md`](../supabase/tests/README-profils.md).
