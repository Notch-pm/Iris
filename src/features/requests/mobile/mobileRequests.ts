// Page « Mes demandes » et fiche mobile — logique PURE (sans DOM ni réseau),
// testée. Le bureau garde ses propres modules (`instruction.ts`, `statuts.ts`) ;
// ce fichier ne porte que ce qui est SPÉCIFIQUE aux écrans mobiles : le filtre
// de la liste (« Affectées » / par statut), le temps relatif des cartes, la
// bannière d'échéances du jour, la ligne « usager · référence », les points
// d'avancement à dessiner et la conséquence d'une transition en une ligne.
//
// Rien ici ne protège quoi que ce soit : `statuts.ts` et le RLS restent
// l'autorité. Ce module explique et présente, il ne rejoue aucune garde.

import { normalizeSearch } from "../creation/procedureSearch";
import { requesterIdentity, type StageState, type StageView } from "../instruction/instruction";
import type { RequestStatus } from "../statuts";

// ---------------------------------------------------------------------------
// Filtre de la liste (« ?filtre= »)
// ---------------------------------------------------------------------------

export type MobileListFilter = "affectees" | "a_traiter" | "en_instruction" | "en_attente";

export const FILTER_LABELS: Record<MobileListFilter, string> = {
  affectees: "Affectées",
  a_traiter: "À traiter",
  en_instruction: "En instruction",
  en_attente: "En attente",
};

/** Lu depuis `?filtre=` : toute valeur inconnue retombe sur « Affectées », l'onglet d'accueil. */
export function parseFilter(raw: string | null | undefined): MobileListFilter {
  return raw === "a_traiter" || raw === "en_instruction" || raw === "en_attente" ? raw : "affectees";
}

// ---------------------------------------------------------------------------
// Temps relatif d'une carte
// ---------------------------------------------------------------------------

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * « à l'instant » / « il y a 12 min » / « il y a 2 h » / « hier » /
 * « il y a 3 j », sinon une date compacte (« 08/09/2026 »). `now` est injecté :
 * pur, testable sans horloge système.
 */
export function relativeTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Le jour CALENDAIRE décide d'abord (« hier » à 20 h la veille n'a que
  // quelques heures, mais n'est déjà plus « aujourd'hui ») ; les minutes et
  // heures ne s'appliquent qu'À L'INTÉRIEUR du jour courant.
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (dayDiff === 0) {
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000);
    if (diffMin < 1) return "à l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    return `il y a ${Math.floor(diffMin / 60)} h`;
  }
  if (dayDiff === 1) return "hier";
  if (dayDiff >= 2 && dayDiff < 7) return `il y a ${dayDiff} j`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Échéances du jour
// ---------------------------------------------------------------------------

/** Jour local (`AAAA-MM-JJ`) d'un instant ISO — chaîne vide si illisible. */
function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * L'échéance tombe-t-elle AUJOURD'HUI, au jour LOCAL de l'agent ? `today` est
 * produit côté appelant par `isoDay(new Date())` (`interventions/interventions.ts`) —
 * ici on ne fait que comparer des chaînes `AAAA-MM-JJ`.
 */
export function isDueToday(dueAt: string | null, today: string): boolean {
  return dueAt !== null && localDay(dueAt) === today;
}

export function dueTodayCount(items: readonly { due_at: string | null }[], today: string): number {
  return items.filter((i) => isDueToday(i.due_at, today)).length;
}

/** Bandeau d'échéances de la liste — `null` s'il n'y a rien à signaler. */
export function deadlineBanner(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 demande arrive à échéance aujourd'hui"
    : `${count} demandes arrivent à échéance aujourd'hui`;
}

// ---------------------------------------------------------------------------
// Effectifs des quatre puces de filtre
// ---------------------------------------------------------------------------

export interface MobileRequestCounts {
  affectees: number;
  a_traiter: number;
  en_instruction: number;
  en_attente: number;
}

export interface CountableRequest {
  status: string;
  assigned_to: string | null;
}

/**
 * Dérive les quatre effectifs d'une seule lecture des statuts OUVERTS — miroir
 * exact des deux formes de filtre de `useMobileRequestsList` : « affectées »
 * compte l'agent COURANT quel que soit son statut ouvert, les trois autres
 * comptent leur statut sans regarder l'affectation.
 */
export function mobileCounts(rows: readonly CountableRequest[], userId: string | null): MobileRequestCounts {
  return {
    affectees: rows.filter((r) => r.assigned_to === userId).length,
    a_traiter: rows.filter((r) => r.status === "a_traiter").length,
    en_instruction: rows.filter((r) => r.status === "en_instruction").length,
    en_attente: rows.filter((r) => r.status === "en_attente").length,
  };
}

// ---------------------------------------------------------------------------
// Ligne « usager · référence »
// ---------------------------------------------------------------------------

/**
 * « Jacquot Laurent · DEM-2026-000052 ». Le nom est OMIS pour une identité non
 * connue (`!known` — dépôt anonyme compris) : mieux vaut la seule référence
 * qu'un mot d'écran de gestion (« Identité déclarée ») affiché comme un nom.
 */
export function requesterLine(snapshot: unknown, identityStatus: string, reference: string): string {
  const identity = requesterIdentity(snapshot, identityStatus);
  return identity.known ? `${identity.name} · ${reference}` : reference;
}

// ---------------------------------------------------------------------------
// Recherche côté client (liste déjà chargée, aucun nouvel appel serveur)
// ---------------------------------------------------------------------------

export interface SearchableRequest {
  reference: string;
  subject: string;
  socle_procedure_label: string | null;
  requester_snapshot: unknown;
  identity_status: string;
}

/** ≥ 3 caractères côté appelant : ici, un texte vide accepte tout. */
export function matchesQuery(item: SearchableRequest, query: string): boolean {
  const q = normalizeSearch(query);
  if (q === "") return true;
  const identity = requesterIdentity(item.requester_snapshot, item.identity_status);
  const haystack = normalizeSearch(
    [item.reference, item.subject, item.socle_procedure_label ?? "", identity.known ? identity.name : ""].join(" "),
  );
  return haystack.includes(q);
}

// ---------------------------------------------------------------------------
// Avancement horizontal de la fiche
// ---------------------------------------------------------------------------

/**
 * Les points à dessiner depuis `buildStages()` (5 étapes) : la dernière,
 * « Archivée », n'est montrée que si elle est atteinte ou en cours — sur les
 * six autres statuts, une case « Archivée » toujours grise n'apprendrait rien.
 */
export function stageDots(stages: StageView[]): StageView[] {
  return stages.filter((s) => s.key !== "archivee" || s.state === "current" || s.state === "done");
}

export function stageDotLit(state: StageState): boolean {
  return state === "done" || state === "current";
}

// ---------------------------------------------------------------------------
// Conséquence d'une transition, en une ligne (feuille « Changer le statut »)
// ---------------------------------------------------------------------------

const TRANSITION_HINTS: Record<RequestStatus, string> = {
  a_traiter: "remise en file du service",
  en_instruction: "prise en charge par un agent",
  en_attente: "pièce ou précision demandée à l'usager",
  resolue_positive: "clôture favorable, l'usager est prévenu",
  resolue_negative: "clôture défavorable, l'usager est prévenu",
  annulee: "sans suite",
  archivee: "sortie des listes",
};

export function transitionHint(to: RequestStatus): string {
  return TRANSITION_HINTS[to];
}

// ---------------------------------------------------------------------------
// Composeur « Écrire à l'usager »
// ---------------------------------------------------------------------------

/** « Votre demande DEM-2026-000052 » — objet par défaut du composeur mobile. */
export function defaultEmailSubject(reference: string): string {
  return `Votre demande ${reference}`;
}
