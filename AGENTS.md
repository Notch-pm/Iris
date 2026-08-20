# Instructions pour les agents IA

Les règles de développement, invariants et pièges du projet vivent dans **[CLAUDE.md](CLAUDE.md)**
— lecture obligatoire avant toute modification. L'architecture validée fait foi :
**[docs/architecture-proposee.md](docs/architecture-proposee.md)**.

Rappels non négociables :

1. **Socle est la source de vérité** des référentiels (organisations, démarches, catégories,
   usagers) — Iris les consomme, ne les redéfinit jamais. Pas de miroir complet.
2. **Jamais de clé d'un autre projet dans le navigateur** — aucun secret en `VITE_*`.
3. **La sécurité vit dans le RLS Postgres**, visibilité par sous-arbre d'organisation Socle ;
   l'UI ne fait que refléter les droits.
4. **Workflow fixe à 7 statuts**, gardes de transition côté serveur.
5. **Aucune suppression de demande** ; les notes internes ne quittent jamais Iris.
6. Interface et messages **en français**.

Vérifications avant de conclure : `npm run lint` (tsc strict), `npm test` (vitest),
`npm run build`.
