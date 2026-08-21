// Détection best-effort des « demandes proches » pendant la saisie — logique
// pure. La décision reste humaine (architecture §doublon métier) : ce module
// ne fait que classer des candidates déjà visibles par le RLS, il ne lie ni ne
// clôture rien. Une similitude de nom déclaré n'atteint JAMAIS le seuil de
// doublon probable (règle : pas de rapprochement sur le seul nom).

export type NearbyBasis = "contact" | "nom_declare";

export interface NearbyCandidate {
  id: string;
  reference: string;
  subject: string;
  status: string;
  created_at: string;
  socle_procedure_id: string | null;
  socle_procedure_label: string | null;
}

export interface NearbyScored extends NearbyCandidate {
  score: number;
  reasons: string[];
  likelyDuplicate: boolean;
}

export const DUPLICATE_THRESHOLD = 85;

const OPEN_STATUSES = new Set(["a_traiter", "en_instruction", "en_attente"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function isOpenStatus(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

function daysBetween(iso: string, now: Date): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

export interface NearbyContext {
  basis: NearbyBasis;
  procedureId: string;
  now: Date;
}

/**
 * Score 0-100 : usager rapproché identique (45) ou même nom déclaré (25),
 * même démarche (+30), demande encore ouverte (+15), récence (+10 < 30 j,
 * +4 < 180 j). Tri décroissant ; `likelyDuplicate` au-delà du seuil.
 */
export function scoreNearbyRequests(
  candidates: NearbyCandidate[],
  ctx: NearbyContext,
): NearbyScored[] {
  return candidates
    .map((c) => {
      const reasons: string[] = [];
      let score = ctx.basis === "contact" ? 45 : 25;
      reasons.push(ctx.basis === "contact" ? "Même usager" : "Même nom déclaré");

      if (c.socle_procedure_id && c.socle_procedure_id === ctx.procedureId) {
        score += 30;
        reasons.push("même démarche");
      }
      if (isOpenStatus(c.status)) {
        score += 15;
        reasons.push("encore en cours");
      }
      const age = daysBetween(c.created_at, ctx.now);
      if (age < 30) {
        score += 10;
        reasons.push("déposée ce mois-ci");
      } else if (age < 180) {
        score += 4;
      }

      const bounded = Math.min(100, score);
      return { ...c, score: bounded, reasons, likelyDuplicate: bounded >= DUPLICATE_THRESHOLD };
    })
    .sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at));
}

export type ScoreTone = "haute" | "moyenne" | "faible";

export function scoreTone(score: number): ScoreTone {
  if (score >= DUPLICATE_THRESHOLD) return "haute";
  if (score >= 60) return "moyenne";
  return "faible";
}

/** « déposée aujourd'hui » / « il y a N jours » / « le JJ/MM/AAAA ». */
export function depositLabel(iso: string, now: Date): string {
  const age = daysBetween(iso, now);
  if (age === 0) return "déposée aujourd'hui";
  if (age === 1) return "déposée hier";
  if (age < 30) return `déposée il y a ${age} jours`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date inconnue";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `déposée le ${dd}/${mm}/${d.getFullYear()}`;
}
