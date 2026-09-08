// Réconciliation du bucket des pièces — logique pure (sans réseau), testée.
//
// Deux questions, et rien d'autre :
//   · quels OBJETS du bucket ne sont plus décrits par aucune ligne — ni
//     `request_attachments`, ni `attachment_uploads` (consommée ou en
//     attente) ? Ce sont des orphelins : ils coûtent et ne servent à rien.
//     Ils partent par l'outbox, jamais directement, et seulement passé un
//     délai de grâce : un objet tout juste écrit par une edge function n'a
//     pas encore sa ligne.
//   · quelles LIGNES de pièces n'ont plus d'objet ? Elles passent en
//     `copy_status = 'error'` : l'écran dira « indisponible » au lieu d'une
//     URL signée qui échoue.

export interface BucketObject {
  name: string;
  createdAt: string;
}

export interface KnownPath {
  path: string;
  /** D'où vient la connaissance du chemin. */
  source: "attachment" | "upload";
}

export interface ReconciliationPlan {
  /** Objets sans aucune ligne, au-delà du délai de grâce : à enfiler dans l'outbox. */
  orphans: string[];
  /** Chemins de pièces (`request_attachments`) sans objet : à marquer en erreur. */
  missing: string[];
  /** Objets trop récents pour être jugés (en cours d'écriture, probablement). */
  deferred: number;
}

export interface ReconciliationInput {
  objects: readonly BucketObject[];
  known: readonly KnownPath[];
  now: Date;
  /** Âge minimal d'un objet pour être déclaré orphelin (défaut 60 min). */
  graceMinutes?: number;
}

export function planReconciliation(input: ReconciliationInput): ReconciliationPlan {
  const grace = (input.graceMinutes ?? 60) * 60_000;
  const knownPaths = new Set(input.known.map((k) => k.path));
  const objectNames = new Set(input.objects.map((o) => o.name));

  const orphans: string[] = [];
  let deferred = 0;
  for (const o of input.objects) {
    if (knownPaths.has(o.name)) continue;
    const age = input.now.getTime() - new Date(o.createdAt).getTime();
    if (!(age >= grace)) {
      deferred += 1;
      continue;
    }
    orphans.push(o.name);
  }

  const missing = [...new Set(
    input.known
      .filter((k) => k.source === "attachment" && !objectNames.has(k.path))
      .map((k) => k.path),
  )];

  return { orphans: orphans.sort(), missing: missing.sort(), deferred };
}
