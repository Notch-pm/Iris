# Instructions pour les agents IA

Les règles de développement, invariants et pièges du projet vivent dans **[CLAUDE.md](CLAUDE.md)**
— lecture obligatoire avant toute modification ; le détail de chaque feature (parcours agent,
contacts, superadmin) est dans `src/features/<feature>/CLAUDE.md`, à lire avant d'y toucher.
L'architecture validée fait foi :
**[docs/architecture-proposee.md](docs/architecture-proposee.md)**.

Rappels non négociables :

1. **Socle est la source de vérité** des référentiels (organisations, démarches, catégories,
   usagers) — Iris les consomme, ne les redéfinit jamais. Pas de miroir complet.
2. **Jamais de clé d'un autre projet dans le navigateur** — aucun secret en `VITE_*`.
3. **La sécurité vit dans le RLS Postgres**, visibilité par sous-arbre d'organisation Socle ;
   l'UI ne fait que refléter les droits.
4. **Workflow fixe à 7 statuts**, gardes de transition côté serveur.
5. **Aucune demande libre** : toute nouvelle demande est fondée sur une démarche Socle active
   du tenant (trigger `t16`, service_role compris) ; les **snapshots** (`procedure_snapshot`,
   `requester_snapshot`) sont construits **côté serveur** — jamais acceptés d'un navigateur
   ou d'un partenaire.
6. **Aucun miroir local d'usagers** — les contacts vivent dans le Socle, lus/rapprochés/créés
   via `socle-proxy` ; `internal_notes` n'est jamais transmis ni stocké côté Iris.
7. **Aucune suppression de demande** ; les notes internes ne quittent jamais Iris.
8. Interface et messages **en français**.

Vérifications avant de conclure : `npm run lint` (tsc strict), `npm test` (vitest),
`npm run build`.
