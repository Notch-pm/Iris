# Profils de droits

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Profils de droits** (décision PO, 2026-08-22, remplace le rôle binaire `agent |
  administrateur`) : les droits effectifs d'un utilisateur se combinent par **couple**
  (organisation porteuse Socle, démarche) — trois droits indépendants `création`/`instruction`/
  `clôture` impliquant chacun `consultation`, plus des droits par défaut (démarches non listées,
  y compris futures ; valeur initiale « aucun », *fail closed*). L'**administration** est un
  attribut de profil indépendant : elle **n'accorde par elle-même aucun droit** sur les
  demandes. Depuis le 2026-09-14, un second attribut, **intervenant** (`is_intervenant`) :
  sollicitable pour une **intervention** sur les demandes du périmètre pendant
  l'instruction ; il n'ouvre rien par lui-même, c'est la **sollicitation**
  (`request_interventions`, deux RPC seules portes) qui ouvre la demande à l'intervenant —
  sans les notes internes ni les échanges (`can_consult_request`). Depuis le 2026-09-18, un
  troisième, **base de connaissances** (`knowledge_base_access`, marche/arrêt, activé sur
  les profils existants) : il ouvre l'écran du même nom — un ÉCRAN, pas une frontière de
  données (tout ce qu'il montre est lisible par tout membre) ; seule la garde de
  l'assistant en mode démarche en dépend côté serveur. Les 5 tables
  `permission_*` n'ont aucune policy d'écriture cliente : les RPC
  (`save_permission_profile`…) sont l'unique porte. `organization_members.role` subsiste en
  **colonne dérivée transitoire**. Détail complet : [`docs/droits.md`](../droits.md).

- **Profils de droits** (10 migrations `20260822100000` à `20260822100900`) : 5 tables
  `permission_*`, moteur de combinaison par couple (`permission_pairs_of`), `requests.
  socle_scope_org_id`, garde unique `requests_guard_write`, reprise (deux profils par tenant),
  `organization_members.role` dérivé, bascule des policies. Détail : [`docs/droits.md`](../droits.md)
  et [`docs/data-model.md`](../data-model.md) ; rollback dédié dans `supabase/rollback/`
  (jamais via `apply_migration`).
