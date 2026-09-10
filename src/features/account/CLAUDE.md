# Mon compte (`src/features/account`)

Route `/mon-compte` (zone authentifiée, **pas** d'`AdminRoute` — c'est l'écran de chacun sur
lui-même), atteinte par le menu du rond en haut à droite. Livré le 2026-08-24.

Trois blocs sans rapport entre eux, une même règle : **rien ici n'est administré par quelqu'un
d'autre**. Chaque geste est personnel. L'adresse e-mail fait exception, et c'est justement ce
qui la rend intéressante (voir plus bas).

Photo et préférences ont la même portée : **le compte**, pas le rattachement. C'est la seule
lecture cohérente — un agent ne change pas de visage ni d'appétence aux courriels en changeant
de collectivité.

## Identité et photo

- Prénom, nom et **téléphones** (fixe et portable, 2026-09-01) s'écrivent directement dans
  `public.users` (la policy `users_update` autorise déjà l'utilisateur sur SA ligne). Le
  bouton reste inactif tant que rien n'a changé — comparaison sur les valeurs **taillées**
  (`identityChanged`) : une espace de plus n'est pas une modification.
- **Les téléphones ne sont pas validés au FORMAT**, délibérément : Iris n'a pas à décider
  qu'un agent est joignable en France. Indicatifs étrangers, extensions et séparations libres
  passent ; seules les LETTRES sont refusées (là, c'est une faute de frappe, pas un choix),
  avec un plancher de 4 chiffres et la borne de longueur de la base
  (`users_phones_length_check`, 40). Même parti pris que pour les contacts du Socle, où rien
  n'est normalisé non plus.
- ⚠️ **Aucune garde SQL sur les téléphones**, contrairement au courriel. `t03_users_protect_email`
  existe parce que le courriel est l'IDENTIFIANT DE CONNEXION ; un numéro n'est l'identifiant
  de rien, c'est une coordonnée que son titulaire tient à jour, comme son prénom.
- **Le formulaire d'identité est PARTAGÉ avec l'écran superadmin** (`IdentityForm`,
  `identityFormFrom`, `identityPatch`, `validateIdentityForm` dans `account.ts`) : deux écrans
  écrivent ces colonnes — « Mon compte » et Superadmin › Utilisateurs, à l'édition comme à
  l'invitation —, ils ne doivent pas avoir deux idées de ce qu'est un champ vide.
- **La photo vit dans un bucket PRIVÉ** (`avatars`, 2 Mio, images seulement) et se lit par
  **URL signée** (1 h, redemandée par TanStack Query). Un bucket public la servirait à qui
  connaît l'adresse, sans authentification ni trace : la photo d'un agent est une donnée
  personnelle, pas un asset.
- Convention de chemin **porteuse du RLS** : `{user_id}/{uuid}.{ext}`. Le premier segment est
  ce que la policy compare à `auth.uid()`. Un nouvel envoi écrit un **nouveau** chemin puis
  supprime l'ancien — aucun objet écrasé en place, donc aucun cache de navigateur à combattre.
- L'extension vient du **type MIME**, jamais du nom de fichier (qui ment).
- Si l'écriture de `users.avatar_path` échoue après l'envoi, l'objet est retiré : pas
  d'orphelin. L'inverse (échec de la suppression de l'ANCIENNE photo) est toléré — un orphelin
  ne doit pas faire échouer un geste réussi.
- Le rond du header affiche la photo dès qu'elle existe, les initiales sinon
  (`useMyAvatarUrl`). Une photo illisible retombe **silencieusement** sur les initiales : le
  shell ne casse pas pour une image — `Avatar` (`components/ui/surface.tsx`) porte ce repli via
  `onError`, pour tous les appelants.
- **`useAvatarUrls(paths)`** signe PLUSIEURS photos en un seul aller-retour
  (`createSignedUrls`) : le menu de mentions et la liste des notes en affichent plusieurs, une
  requête par personne serait absurde. Rend une Map chemin → URL ; un chemin absent = initiales.

## Mot de passe

**GoTrue n'a pas d'« update password with current password »** : `updateUser` accepte le
nouveau mot de passe sans jamais demander l'ancien. La preuve exigée est donc obtenue par une
**reconnexion** (`signInWithPassword` avec l'ancien) juste avant la mise à jour — c'est le seul
moyen. Un échec de cette étape laisse la session en place et ne change rien ; le message est
explicite (« Mot de passe actuel incorrect. »).

Iris ne stocke ni ne voit jamais un mot de passe : ce bloc n'a **aucune** empreinte SQL.

## L'adresse e-mail est administrée

`public.users.email` est un miroir de `auth.users.email`, c'est-à-dire **l'identifiant de
connexion**. La policy `users_update` laisse un utilisateur écrire sa ligne ; sans garde, il
pourrait donc y réécrire son adresse et désynchroniser le miroir **sans que sa connexion change
pour autant** — un état incohérent, silencieux, difficile à diagnostiquer.

Le trigger **`t03_users_protect_email`** refuse ce changement pour un client ; le contexte de
service (`admin-users`, provisionnement) et l'administrateur de plateforme passent. Le champ est
en lecture seule à l'écran, mais **c'est la base qui décide** — l'UI ne fait que refléter,
comme partout dans ce projet.

## Préférences de notification

Matrice **événement × canal** (dans Iris / par e-mail), deux cases indépendantes : les deux,
l'une, ou aucune (= ne rien recevoir pour cet événement). Ces réglages sont **globaux au
compte** (décision PO 2026-08-24) : ils valent pour toutes les organisations auxquelles
l'utilisateur a accès, exactement comme sa photo. Un agent rattaché à deux collectivités règle
ses notifications une seule fois — et ne risque pas de continuer à recevoir des messages parce
qu'il a oublié le second tenant.

- `matrixFromRows` **réimplémente volontairement** la sémantique de
  `notification_channels_for(user, kind)` (ligne du motif, sinon `'*'`, sinon tout activé) : c'est le
  seul endroit du front à le faire, et il garantit que l'écran montre ce qui s'appliquera
  vraiment plutôt qu'une approximation.
- L'enregistrement écrit **une ligne par motif**, jamais `'*'` : chaque case cochée devient une
  décision explicite. `'*'` reste au modèle pour un futur réglage global.
- Un événement dont les deux cases sont décochées l'annonce dans sa propre ligne (« Aucune
  notification pour cet événement. ») et un compteur rappelle en bas combien d'événements sont
  devenus muets — couper une information doit être un geste conscient.
- Effet en base : les deux canaux coupés → **aucune ligne de notification n'est créée** ;
  in-app coupé seul → ligne muette qui porte quand même l'e-mail. Détail :
  [`../notifications/CLAUDE.md`](../notifications/CLAUDE.md).

## Sur cet appareil (push, 2026-09-10)

Sous les préférences, une carte **« Sur cet appareil »** avec l'interrupteur « Notifications sur
cet appareil » (`PushDeviceToggle`, partagé avec la feuille « Moi » du mobile). Ce n'est **pas
une préférence du compte** : un abonnement Web Push vaut pour UN appareil et UN navigateur, et
il **suit le canal « Dans Iris »** de la matrice au-dessus — aucun réglage par événement
(décision PO). États écrits, jamais un gris muet : `on`, `off`, `denied` (bloqué dans le
navigateur), `needs_install` (iPhone hors écran d'accueil), `unsupported`, `not_configured`.
Détail : [`../notifications/CLAUDE.md`](../notifications/CLAUDE.md) § « Doublage par push ».

## Fichiers

- **`account.ts`** (pur, testé — 24 cas) : matrice de préférences (aller-retour lignes ↔
  matrice, surcharge, comptage des muets), validation du formulaire de mot de passe (dans
  l'ordre de la saisie : on ne reproche pas la confirmation à qui n'a pas encore tapé le
  nouveau), validation de l'image, chemin de stockage, initiales et nom affiché.
- **`useAccount.ts`** : `useAvatarUrl` / `useMyAvatarUrl`, `useUploadAvatar`, `useRemoveAvatar`,
  `useUpdateIdentity`, `useChangePassword`, `useNotificationPreferences`,
  `useSaveNotificationPreferences`.
- **`AccountPage.tsx`** : les trois blocs en `Surface`.
- `AuthProvider.refreshProfile()` — ajouté pour cet écran. ⚠️ **Sans `setLoading(true)`** :
  repasser `loading` à vrai ferait retomber les routes protégées sur leur écran de chargement
  et démonterait la page en cours (le piège même que le keyage sur `userId` évite).

## Tests

- `account.test.ts` — module pur, 24 cas.
- [`supabase/tests/compte-utilisateur.test.sql`](../../../supabase/tests/compte-utilisateur.test.sql)
  — **9 scénarios, tous passés le 2026-08-24** : mes noms et ma photo m'appartiennent · mon
  adresse e-mail, non — mais le contexte de service peut la corriger · le profil d'autrui reste
  hors d'atteinte · dépôt et suppression bornés à mon dossier · lecture de la photo d'un
  collègue du même tenant, jamais d'un autre tenant.
- Vérifié en navigateur le 2026-08-24 : envoi et retrait d'une photo (objet storage créé puis
  supprimé, aucun orphelin), enregistrement des préférences (5 lignes écrites, dont un
  événement muet), puis re-vérifié après le passage en portée globale (upsert sur
  `(user_id, kind)`).
- La portée globale elle-même est couverte côté base par le scénario **T13bis** de
  [`supabase/tests/notifications-email.test.sql`](../../../supabase/tests/notifications-email.test.sql) :
  le décor rattache l'agent à deux collectivités et vérifie qu'une préférence posée une fois
  s'applique dans les deux.
