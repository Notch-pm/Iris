// Demandes liées — score et explication des demandes APPROCHANTES (lot L2 de
// docs/demandes-liees.md).
//
// La recherche vit au serveur (`find_similar_requests[_for]`, SECURITY INVOKER,
// bornée par le RLS) et rend des SIGNAUX BRUTS : distance, proximité d'adresse,
// proximité de texte, même démarche. Ce module en fait un score lisible et,
// surtout, une EXPLICATION — « à 40 m · déposée il y a 2 j · description
// proche » : l'agent décide, il doit voir pourquoi on lui propose une demande.
//
// ⚠️ À ne pas confondre avec `creation/proches.ts` : les « demandes proches »
// rapprochent un même USAGER ; ici, des usagers différents pour un même LIEU.

import { dataKey, flatFields, parseLocationValue, type FormSchema, type FormValues } from "@fn/create-request-from-procedure/_shared/procedureForm";
import { interventionLocation } from "@/features/requests/instruction/lieu";

/** Une ligne de `find_similar_requests` (mêmes noms que la RPC). */
export interface SimilarCandidate {
  request_id: string;
  reference: string;
  subject: string;
  status: string;
  received_at: string;
  closed_at: string | null;
  socle_procedure_id: string | null;
  procedure_label: string | null;
  organisme: string | null;
  group_id: string | null;
  distance_m: number | null;
  address_similarity: number | null;
  text_similarity: number | null;
  same_procedure: boolean;
  radius_m: number;
}

export type SimilarTone = "haute" | "moyenne" | "faible";

export interface ScoredSimilar extends SimilarCandidate {
  score: number;
  tone: SimilarTone;
  /** Le signalement porte très probablement sur le même incident. */
  likely: boolean;
  reasons: string[];
}

/** Au-delà, la demande est mise en avant (« même incident probable »). */
export const LIKELY_THRESHOLD = 60;
/** En deçà, la demande n'est pas proposée du tout : du bruit, pas une piste. */
export const MIN_SCORE = 20;
/** Combien de propositions au plus. */
export const MAX_PROPOSALS = 10;

const OPEN = new Set(["a_traiter", "en_instruction", "en_attente"]);
const DAY_MS = 86_400_000;

/** « même point », « à 40 m », « à 1,2 km ». */
export function distanceLabel(meters: number): string {
  if (meters < 10) return "même point";
  if (meters < 1000) return `à ${Math.round(meters / 5) * 5} m`;
  return `à ${(meters / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
}

function ageLabel(receivedAt: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(receivedAt).getTime()) / DAY_MS);
  if (days <= 0) return "déposée aujourd'hui";
  if (days === 1) return "déposée hier";
  return `déposée il y a ${days} j`;
}

/** Proximité de LIEU, 0..1 : le point d'abord, l'adresse à défaut. */
function placeProximity(c: SimilarCandidate): number {
  if (c.distance_m !== null && c.distance_m <= c.radius_m) {
    return Math.max(0, 1 - c.distance_m / Math.max(c.radius_m, 1));
  }
  const a = c.address_similarity ?? 0;
  return a >= 0.5 ? a : 0;
}

export function scoreSimilar(c: SimilarCandidate, now: Date): ScoredSimilar {
  const place = placeProximity(c);
  const text = Math.max(0, Math.min(1, c.text_similarity ?? 0));
  const open = OPEN.has(c.status);
  const raw = 60 * place + 25 * text + (c.same_procedure ? 10 : 0) + (open ? 5 : 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const reasons: string[] = [];
  if (c.distance_m !== null && c.distance_m <= c.radius_m) {
    reasons.push(distanceLabel(c.distance_m));
  } else if ((c.address_similarity ?? 0) >= 0.8) {
    reasons.push("même adresse");
  } else if ((c.address_similarity ?? 0) >= 0.5) {
    reasons.push("adresse proche");
  }
  if (text >= 0.5) reasons.push("description très proche");
  else if (text >= 0.3) reasons.push("description proche");
  if (!c.same_procedure) reasons.push(`autre démarche${c.procedure_label ? ` : ${c.procedure_label}` : ""}`);
  reasons.push(ageLabel(c.received_at, now));
  if (!open) reasons.push("déjà résolue");
  if (c.group_id) reasons.push("déjà liée à d'autres demandes");

  return {
    ...c,
    score,
    tone: score >= LIKELY_THRESHOLD ? "haute" : score >= 35 ? "moyenne" : "faible",
    likely: score >= LIKELY_THRESHOLD,
    reasons,
  };
}

/** Propositions à montrer : scorées, débarrassées du bruit, les meilleures d'abord. */
export function rankSimilar(candidates: SimilarCandidate[], now: Date, max = MAX_PROPOSALS): ScoredSimilar[] {
  return candidates
    .map((c) => scoreSimilar(c, now))
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.received_at.localeCompare(a.received_at))
    .slice(0, max);
}

/** Ce que le guichet envoie à `find_similar_requests` pour une demande en cours de saisie. */
export interface DraftSimilarityInput {
  lat: number | null;
  lon: number | null;
  address: string | null;
  text: string | null;
}

/**
 * Lieu et texte d'une saisie en cours. Les réponses du guichet sont indexées
 * par IDENTIFIANT de champ ; `interventionLocation` lit un `form_data`, indexé
 * par CLÉ machine — d'où la conversion. Même reconnaissance du lieu qu'à la
 * fiche : le champ `location` (point déclaré) d'abord, l'ancien bloc ensuite.
 * Rien n'est géocodé.
 */
export function draftSimilarityInput(
  schema: FormSchema | null,
  values: FormValues,
  subject: string,
  body: string,
): DraftSimilarityInput {
  let lat: number | null = null;
  let lon: number | null = null;
  let address: string | null = null;
  if (schema) {
    const formData: Record<string, unknown> = {};
    for (const entry of flatFields(schema)) formData[dataKey(entry.field)] = values[entry.field.id];
    const location = flatFields(schema).find((e) => e.field.type === "location");
    const parsed = location ? parseLocationValue(values[location.field.id]) : null;
    if (parsed && parsed.lat !== null && parsed.lon !== null) {
      lat = parsed.lat;
      lon = parsed.lon;
    }
    const lieu = interventionLocation({ form_schema: schema }, formData);
    if (lieu && !lieu.empty && lieu.query.trim() !== "") address = lieu.query.trim();
    if (lat === null && lieu?.point) {
      lat = lieu.point.lat;
      lon = lieu.point.lon;
    }
  }
  const text = `${subject} ${body}`.trim();
  return { lat, lon, address, text: text === "" ? null : text };
}

/** Faut-il seulement interroger le serveur ? Sans lieu ni texte, la question est vide. */
export function draftIsSearchable(input: DraftSimilarityInput): boolean {
  return (input.lat !== null && input.lon !== null) || input.address !== null || (input.text?.length ?? 0) >= 5;
}
