// Brouillon local du parcours de création — logique pure de (dé)sérialisation.
// Le brouillon vit dans le localStorage du poste de l'agent (un par tenant et
// par utilisateur) : il ne transporte que des identifiants et des saisies,
// JAMAIS une fiche usager (l'usager rapproché est relu depuis le Socle à la
// reprise — aucun miroir local) ni un snapshot de démarche (rechargé).
// Les fichiers ne sont pas persistables : ils sont à déposer de nouveau.

import type { Audience, FormValues } from "@fn/create-request-from-procedure/_shared/procedureForm";
import type { RequesterResolution } from "@/features/contacts/rapprochement";

export const DRAFT_VERSION = 1;

export type DraftRequester =
  | { kind: "contact"; audience: Audience; socleContactId: string }
  | { kind: "sans_rapprochement"; audience: Audience; declared: Record<string, string> }
  | { kind: "anonyme" };

export interface LinkedDraftRequest {
  id: string;
  reference: string;
}

export interface CreationDraft {
  v: typeof DRAFT_VERSION;
  savedAt: string;
  draftId: string;
  step: 1 | 2 | 3 | 4;
  procedureId: string;
  destinationId: string;
  requester: DraftRequester | null;
  subject: string;
  body: string;
  priority: string;
  values: FormValues;
  linked: LinkedDraftRequest[];
  dupDismissed: boolean;
}

export function draftStorageKey(orgId: string, userId: string): string {
  return `iris.draft.${orgId}.${userId}`;
}

const AUDIENCES: readonly string[] = ["citoyen", "entreprise", "association"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseRequester(raw: unknown): DraftRequester | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "anonyme") return { kind: "anonyme" };
  if (typeof raw.audience !== "string" || !AUDIENCES.includes(raw.audience)) return null;
  const audience = raw.audience as Audience;
  if (raw.kind === "contact") {
    if (typeof raw.socleContactId !== "string" || !UUID_RE.test(raw.socleContactId)) return null;
    return { kind: "contact", audience, socleContactId: raw.socleContactId };
  }
  if (raw.kind === "sans_rapprochement") {
    if (!isRecord(raw.declared)) return null;
    const declared: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.declared)) {
      if (typeof v === "string") declared[k] = v;
    }
    return { kind: "sans_rapprochement", audience, declared };
  }
  return null;
}

/**
 * JSON stocké → brouillon valide, ou null (version inconnue, structure
 * invalide, démarche absente). Tolérant sur les champs secondaires.
 */
export function parseDraft(raw: string | null): CreationDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== DRAFT_VERSION) return null;
  if (typeof parsed.procedureId !== "string" || !UUID_RE.test(parsed.procedureId)) return null;
  if (typeof parsed.draftId !== "string" || !UUID_RE.test(parsed.draftId)) return null;
  if (typeof parsed.savedAt !== "string" || Number.isNaN(Date.parse(parsed.savedAt))) return null;

  const step = typeof parsed.step === "number" && [1, 2, 3, 4].includes(parsed.step)
    ? (parsed.step as CreationDraft["step"])
    : 1;
  const linked: LinkedDraftRequest[] = Array.isArray(parsed.linked)
    ? parsed.linked
        .filter((l): l is { id: string; reference: string } =>
          isRecord(l) && typeof l.id === "string" && UUID_RE.test(l.id) && typeof l.reference === "string")
        .map((l) => ({ id: l.id, reference: l.reference }))
    : [];

  return {
    v: DRAFT_VERSION,
    savedAt: parsed.savedAt,
    draftId: parsed.draftId,
    step,
    procedureId: parsed.procedureId,
    destinationId: typeof parsed.destinationId === "string" ? parsed.destinationId : "",
    requester: parseRequester(parsed.requester),
    subject: typeof parsed.subject === "string" ? parsed.subject : "",
    body: typeof parsed.body === "string" ? parsed.body : "",
    priority: typeof parsed.priority === "string" ? parsed.priority : "normale",
    values: isRecord(parsed.values) ? parsed.values : {},
    linked,
    dupDismissed: parsed.dupDismissed === true,
  };
}

export function serializeDraft(draft: CreationDraft): string {
  return JSON.stringify(draft);
}

/** Résolution du demandeur → forme persistable (identifiant seul pour un contact Socle). */
export function draftRequesterFromResolution(resolution: RequesterResolution | null): DraftRequester | null {
  if (!resolution) return null;
  if (resolution.kind === "anonyme") return { kind: "anonyme" };
  if (resolution.kind === "contact") {
    return { kind: "contact", audience: resolution.audience, socleContactId: resolution.contact.id };
  }
  return { kind: "sans_rapprochement", audience: resolution.audience, declared: resolution.declared };
}

/** « Brouillon enregistré à l'instant / il y a 12 s / il y a 3 min / à 14:32 ». */
export function savedAgoLabel(savedAt: string | null, now: Date): string {
  if (!savedAt) return "Brouillon non enregistré";
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return "Brouillon enregistré";
  const seconds = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (seconds < 5) return "Brouillon enregistré à l'instant";
  if (seconds < 60) return `Brouillon enregistré il y a ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Brouillon enregistré il y a ${minutes} min`;
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Brouillon enregistré à ${hh}:${mm}`;
}

/** Date lisible d'un brouillon pour la proposition de reprise. */
export function draftDateLabel(savedAt: string): string {
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
