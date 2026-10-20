# Tests de la vue usager d'Iris (`/v1/citizen/*`, contrat 2.7.0)

```bash
npx vitest run supabase/functions/requests-api   # contrat anti-fuite + SQL + jeton
npx vitest run supabase/functions/_shared/identity
```

- `harness/` : `requests-api/index.ts` réel (Deno minimal), client Supabase remplacé par
  PGlite (schéma réduit + VRAIES migrations `20261019150000` et `20261020150000`).
- `citizen.contract.test.ts` : authentification et scopes, jeton court (signature, collectivité,
  durée), propriété d'une demande (compte et invité), liste blanche (jamais `closure_motif`,
  `request_messages`, `instruction_interne`, agents), pièces, accès par code (verrou, plancher
  de 400 ms, refus uniformes), journal d'audit.
- `migrations.sql.test.ts` : `citizen_visible`, t13 (Clara masquée), t14 (droit d'instruction),
  `check_request_access`, `register_request_access`, fermeture (RLS, droits).
- `_shared/citizenToken.contract.test.ts` : jetons signés PAR NORA (vecteurs partagés).
- `_shared/identity/declared.rattachement.test.ts` : `isSafeIngestMatch`, table de vérité complète.
