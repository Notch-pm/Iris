# Rejouer les tests — profils de droits

> Public : qui applique les migrations `20260822100000` à `20260822100800` et
> vérifie le lot 1. Question traitée : comment rejouer les deux tests SQL et
> mesurer la performance de la liste paginée.

## 1. Appliquer les migrations

Dans l'ordre strict, un par un, via le MCP Supabase `apply_migration` (jamais
`execute_sql`, qui est en lecture seule) :

```
20260822100000_profils_droits_schema.sql
20260822100100_profils_droits_helpers.sql
20260822100200_requests_scope_org.sql
20260822100300_profils_droits_gardes.sql
20260822100400_profils_droits_rpc.sql
20260822100500_reprise_profils.sql
20260822100600_role_derive.sql
20260822100700_policies_droits.sql
20260822100800_permission_rls.sql
```

Aucune inversion possible : M6 (reprise) doit avoir tourné avant M8 (bascule
des policies), faute de quoi la bascule prive tout le monde de droits le
temps d'un aller-retour.

## 2. Rejouer les tests (transactionnels, toujours annulés)

Les deux fichiers de `supabase/tests/` se terminent par un `RAISE EXCEPTION`
volontaire qui porte le verdict : la transaction est **systématiquement
annulée**, aucune donnée de test ne persiste. C'est pourquoi ils passent par
`apply_migration` (qui accepte un échec de dernière instruction sans
enregistrer la migration) plutôt que par `execute_sql` (lecture seule).

1. `supabase/tests/fondations.test.sql` — rejouer en premier : vérifie que
   les 15 scénarios historiques (isolation, transitions, immuabilité,
   idempotence, règle impérative) passent toujours avec le nouveau décor
   « profils de droits » (deux profils par tenant, `Administrateur` /
   `Agent`, reproduisant exactement la reprise M6).
2. `supabase/tests/profils-droits.test.sql` — le nouveau test dédié (CA-01 à
   CA-20, CL-01/02/04/05/06/11/15/16/22, équivalence
   `user_has_request_right` ⟺ `permission_pairs_of`, storage).

Lire le message final :
- `TOUS LES TESTS SONT PASSÉS (…) — transaction annulée, aucune donnée
  conservée.` → succès, rien à corriger.
- `ÉCHECS (n) : …` → la liste des scénarios en échec (séparés par ` · `),
  aucune donnée ne persiste non plus (même transaction annulée).

## 3. Vérifier la performance de la liste paginée (Hashed SubPlan)

Le risque n°1 documenté par l'architecte (§4.1 du plan) est le coût de
`permission_pairs_of` sur une liste paginée. Exécuter, sur le tenant ACCM
réel (ou après avoir généré un volume représentatif en transaction annulée) :

```sql
explain (analyze, buffers, format text)
select id, reference, subject, status, socle_scope_org_id, socle_procedure_id
  from public.requests
 where organization_id = '<uuid ACCM>'
 order by created_at desc
 limit 20 offset 0;
```

Point de vigilance dans le plan :
- Le `Subquery Scan` / `Hashed SubPlan` issu de `my_permission_pairs('consultation')`
  (appelé UNE FOIS, dans la clause `IN` non corrélée de `requests_select`)
  doit apparaître **une seule fois** dans le plan, initialisé avant le
  `Seq Scan`/`Index Scan` sur `requests` — pas ré-exécuté par ligne.
- Le `Seq Scan`/`Bitmap Index Scan` sur `requests` doit pouvoir s'appuyer sur
  `requests_org_scope_proc_idx (organization_id, socle_scope_org_id,
  socle_procedure_id)` combiné à `requests_org_created_idx (organization_id,
  created_at desc)` selon le nombre de profils de l'utilisateur courant.
- Temps total attendu (§4.1 du plan, cas réaliste 1-3 profils) : de l'ordre
  de quelques millisecondes de coût fixe + ~10-15 ms de filtrage, très en
  dessous du budget de 500 ms fixé par la spécification (Annexe, contrainte
  non fonctionnelle) même à 10⁵ demandes.
- Si le plan montre un appel de `permission_pairs_of`/`my_permission_pairs`
  **par ligne** (SubPlan corrélé au lieu de Hashed SubPlan), c'est le signal
  du repli de performance documenté au risque n°1 du plan d'architecture
  (représentation « défaut + exceptions » au lieu de l'énumération complète)
  — à traiter dans une vague dédiée, pas en correctif du lot 1.

## 4. En cas d'échec

Toute erreur affichée par `apply_migration` sur l'une des 9 migrations, ou
tout scénario listé dans `ÉCHECS (n) : …`, doit être renvoyé tel quel (texte
complet du message Postgres) pour diagnostic — ne pas réessayer en boucle.

## 5. Abandon du lot (rollback)

Si le lot doit être abandonné APRÈS déploiement : exécuter manuellement
`supabase/rollback/20260822_profils_droits_rollback.sql` (n'est PAS une
migration, ne vit pas sous `supabase/migrations/`). Il restaure à l'identique
les policies/gardes de `requests`, des satellites et du storage telles
qu'elles étaient avant ce lot, ainsi que `is_org_writer`/`is_org_admin`
(version rôle) — et laisse INERTES les 5 tables de profils, `permission_audit_log`,
la colonne `requests.socle_scope_org_id` et les RPC de M5 (aucune donnée
perdue, ré-déploiement possible sans purge).
