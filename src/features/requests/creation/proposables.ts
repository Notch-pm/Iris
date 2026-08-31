// Ce qui est PROPOSABLE au guichet : le croisement des quatre règles.
//
// Une démarche n'est offerte à la création, pour un organisme donné, que si
// les quatre sont vraies (spécification PO du 2026-08-31) :
//
//   1. elle est **activée pour cet organisme** dans le Socle
//      (`organization_procedures.is_enabled`, miroitée par la synchro) ;
//   2. son paramétrage est **en production** (ni brouillon) ;
//   3. elle est **dans sa période de publication**, et externe ;
//   4. l'agent détient le droit de **création** sur le couple.
//
// Les règles 2 et 3 sont déjà appliquées en amont — `useSocleProcedureRows` ne
// rend que des démarches proposables — donc `cacheIds` les porte déjà. Ce
// module croise la 1 et la 4, et rend le résultat par organisme : c'est
// exactement ce dont l'étape 0 (quels organismes proposer ?) et l'étape 1
// (quelles démarches pour celui-ci ?) ont besoin, sans que l'une puisse
// diverger de l'autre.
//
// ⚠️ L'activation est un **opt-in strict** : une organisation absente de
// `activated` n'a AUCUNE démarche, ce n'est pas « toutes ». Le miroir ne porte
// que ce que le Socle a explicitement activé — même règle que la table source.
//
// ⚠️ Module PUR, et il ne protège rien : la vérité est le trigger
// `t18_requests_require_procedure_active`, qui refuse à l'insertion un couple
// non activé, service_role compris.

import { creatableProceduresOn, type MyRights } from "@/features/rights/rights";

/** Une ligne du miroir : cette organisation propose cette démarche. */
export interface ActivationPair {
  socle_org_id: string;
  socle_procedure_id: string;
}

/** Démarches activées, indexées par organisation Socle. */
export function activationsByOrganisation(
  pairs: readonly ActivationPair[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const set = out.get(pair.socle_org_id) ?? new Set<string>();
    set.add(pair.socle_procedure_id);
    out.set(pair.socle_org_id, set);
  }
  return out;
}

/**
 * Pour chaque organisation : les démarches que l'agent peut y créer — activées
 * ET dans son droit. Les organisations qui n'en ont aucune sont **absentes** de
 * la table rendue, ce qui suffit à ne jamais les proposer à l'étape 0
 * (décision PO : pas d'organisme en cul-de-sac).
 */
export function creatableByOrganisation(
  my: MyRights,
  cacheIds: readonly string[],
  activated: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [orgId, activatedHere] of activated) {
    const creatable = creatableProceduresOn(my, orgId, cacheIds);
    const both = new Set<string>();
    for (const procedureId of creatable) {
      if (activatedHere.has(procedureId)) both.add(procedureId);
    }
    if (both.size > 0) out.set(orgId, both);
  }
  return out;
}
