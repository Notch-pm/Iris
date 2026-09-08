# Recherche globale (`src/features/search`)

Barre au **centre du header** du shell agent, donc montée sur toutes les pages de la zone
authentifiée. Une seule saisie, **deux natures** : une demande ou un usager. Livrée le
2026-09-01.

Elle ne remplace aucune liste : la liste des demandes et l'annuaire des usagers gardent leurs
filtres, leurs tris et leur export. Celle-ci répond à l'autre question, celle du téléphone qui
sonne — « j'appelle pour ma demande » — où l'agent n'a qu'un nom ou un numéro et n'a pas le
temps de choisir un écran.

## Ce qui s'affiche, et pourquoi ces informations-là

Les résultats sont **groupés par nature**, demandes d'abord (l'agent cherche d'abord un
dossier), usagers ensuite. Un groupe vide n'apparaît pas — un en-tête sans ligne se lirait
comme une recherche encore en cours.

- **Demande** : code de suivi, libellé, date de dépôt, statut, agent instructeur, organisme
  responsable. C'est exactement ce qu'il faut pour reconnaître SA demande parmi trois
  homonymes de rue, sans ouvrir la fiche.
- **Usager** : nom, prénom (le `display_name` du Socle, `contactName` à défaut) et **ville de
  l'adresse**. Deux « Muller Alain » se départagent par la commune.

Les libellés absents prennent les mots de la maison : « Non affectée » pour une demande sans
instructeur, « — » pour un organisme vide, « Ville inconnue » pour une fiche sans commune.

## Le rythme de la frappe

**Trois caractères** (`MIN_QUERY_LENGTH`) et une **temporisation de 300 ms**
(`SEARCH_DEBOUNCE_MS`) avant d'émettre quoi que ce soit. En deçà, le panneau dit ce qui manque
plutôt que de rester vide.

Le cache de TanStack Query dédoublonne les préfixes déjà tapés ; la temporisation, elle, évite
d'**émettre** la requête intermédiaire — ce que le cache ne peut pas faire. Sans elle, « nid-de-poule »
coûterait douze allers-retours à Postgres et douze appels d'edge function au Socle. Même
raisonnement que `useAddressSuggestions`, dont le `useDebounced` est repris tel quel.

## Deux sources qu'aucun serveur ne joint

- **Demandes** : RPC `search_requests` (migration `20260901130000`), **`SECURITY INVOKER`** —
  le RLS borne le résultat au périmètre du lecteur, la barre ne garde aucune porte.
- **Usagers** : `socle-proxy /v1/contacts/search`, dont la garde exige **au moins un droit de
  création** dans le tenant (RM-64). Le composant reflète cette garde avec
  `useCanBrowseUsagers()` — le même droit que l'entrée « Usagers » du rail : sans lui, l'appel
  n'est même pas émis et la barre ne cherche que des demandes. L'edge function reste
  l'autorité, ce reflet n'est qu'un confort.

**Aucun usager n'est mis en cache** (`gcTime: 0`, `staleTime: 0`) — invariant de la gamme, le
même que la fiche usager et l'annuaire. Les demandes, elles, sont des données Iris : 30 s de
fraîcheur, la recherche se répète souvent à l'identique.

Une **panne du référentiel n'échoue pas la recherche** : le groupe « Usagers » disparaît, une
ligne discrète le dit, et les demandes restent. C'est la doctrine constante — le Socle muet
dégrade, il ne bloque pas.

## Ce qui est cherché (et ce qui ne l'est pas)

Le **code de suivi** et le **libellé**, rien d'autre. Ni le corps, ni le formulaire figé, ni
les notes : les balayer ferait de chaque frappe un scan du tenant, et une note interne n'a
rien à faire dans une liste de résultats.

Une limite assumée, à connaître avant de promettre le contraire à un agent : **une demande ne
se trouve pas par le nom de son usager.** Passer par l'usager puis sa fiche reste le chemin —
c'est précisément ce que le groupe « Usagers » sert.

`RESULTS_PER_KIND` borne à 6 par nature : au-delà, on affine, ou on ouvre la liste qui sait
filtrer.

## Les accents, et pourquoi c'est une RPC

Personne ne tape les diacritiques dans une barre de recherche, et un usager au téléphone
épelle rarement « Benoît » avec son accent circonflexe. « eclairage » DOIT trouver
« Éclairage » : `ilike` ignore la casse, jamais les accents.

La normalisation ne pouvait pas vivre dans le navigateur : elle doit s'appliquer aux **deux
côtés** de la comparaison, et seul Postgres connaît le texte stocké. D'où la migration
`20260901130000` et son trio :

- `immutable_unaccent(text)` — `unaccent()` rendu `IMMUTABLE` (dictionnaire nommé), sans quoi
  aucun index d'expression n'est possible ;
- `request_search_text(reference, subject)` — le texte cherché d'une demande, minuscules sans
  accents ; **unique porteuse** de cette définition, l'index et la RPC l'appellent tous deux ;
- `search_requests(p_org_id, p_query, p_limit)` — la recherche, `SECURITY INVOKER`.

Un index **GIN trigramme** porte la même expression, au mot près : `like '%…%'` n'utilise aucun
btree, et sans lui chaque frappe serait un balayage du tenant.

**Aucun jumeau JavaScript d'`unaccent`** n'a été écrit, délibérément : il aurait divergé du
serveur sur « cœur », « ß » ou « ø » — et une recherche qui ne trouve rien ne dit jamais
pourquoi. La saisie part telle quelle ; l'échappement des métacaractères de LIKE (`%`, `_`,
antislash) est fait côté serveur, au même endroit. Seule la garde des 3 caractères a un jumeau
SQL, et c'est voulu : elle protège aussi d'un appel direct à la RPC.

Vérifié le 2026-09-01 : test SQL transactionnel `supabase/tests/recherche-globale.test.sql`
(7 groupes, dont l'étanchéité entre deux agents de la même collectivité), et en navigateur
« eclairage » → les quatre « Éclairage… » du jeu ACCM.

⚠️ **Côté usagers, la recherche reste sensible aux accents, et Iris n'y peut rien** :
`socle-proxy /v1/contacts/search` relaie `contacts-api`, dont le filtre est un `ilike` sur
`display_name` brut (Socle, `supabase/functions/contacts-api/index.ts`). « françois » rend les
six François, « francois » aucun. Le correctif appartient au Socle — et compenser ici (deux
appels, l'un accentué l'autre non) ne réparerait que le sens rare, en doublant la charge.

## Clavier et accessibilité

Motif éprouvé du champ d'adresse (`AddressField`) : `role="combobox"` sur la saisie,
`aria-activedescendant` vers l'option retenue, ↑ ↓ circulaires, **Entrée ouvre** le résultat,
**Échap ferme**, Tab n'est pas détourné. Chaque groupe est un `role="group"` nommé, et un
`role="status"` annonce le nombre de résultats — sans lui, la liste n'existerait que pour l'œil.

Fermeture au **clic à côté** (écouteur `mousedown`, motif du menu compte) et non au `blur` : le
panneau porte des boutons de navigation, un `blur` fermerait avant que le clic n'arrive.

Choisir un résultat **vide la saisie** : la barre revient au neutre, elle ne garde pas en
mémoire une recherche déjà aboutie.

## Détail d'implémentation à ne pas défaire

`useTenantMembers(orgId, enabled)` a gagné un second paramètre pour cette barre : montée sur
**toutes** les pages, elle ne doit pas interroger la liste des membres du tenant tant que
personne n'a rien cherché. Les noms d'agents ne sont chargés qu'une fois une recherche lancée.

## Découpage

- `search.ts` — **logique pure testée** : normalisation de la saisie, mise en forme des
  résultats, groupes, parcours clavier. Aucun DOM, aucun réseau.
- `useGlobalSearch.ts` — les deux requêtes, la temporisation, les états (`isStale`,
  `usagersUnavailable`, `settled`).
- `GlobalSearch.tsx` — le rendu et le clavier. Il n'y décide rien qui ne soit déjà décidé.
