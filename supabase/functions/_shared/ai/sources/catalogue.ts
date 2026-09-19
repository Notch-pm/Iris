/**
 * Les sources que l'assistant peut PROPOSER de consulter — et rien d'autre.
 *
 * DEUX TEMPS (décision PO 2026-09-19) : l'assistant répond d'abord avec ce que
 * le serveur lui a composé ; s'il n'a pas la réponse, il propose de consulter
 * certaines des sources que la collectivité a DÉCLARÉES pour l'IA, et l'agent
 * approuve d'un clic avant toute lecture. Ce module dresse la liste fermée de
 * ces sources, dans l'ordre de la préséance :
 *
 *   1. les sources en ligne IA de la démarche (`knowledge_base.aiSources`) ;
 *   2. ses documents d'entraînement (`knowledge_base.trainingDocuments`) ;
 *   3. les sources recommandées par la collectivité pour TOUTES ses démarches
 *      (`recommendedSources`, Socle 1.27.0).
 *
 * Les liens et documents d'aide destinés à l'AGENT (`agentLinks`,
 * `agentDocuments`) n'y figurent pas : la collectivité ne les a pas désignés
 * pour l'assistant.
 *
 * ⚠️ CE N'EST PAS UN OUTIL. Le modèle ne déclenche aucun accès : il cite des
 * identifiants de ce catalogue, l'agent décide, Iris lit. Le catalogue est
 * RECONSTRUIT côté serveur à chaque appel depuis le Socle, et un identifiant
 * venu du navigateur ne vaut que s'il s'y trouve.
 *
 * ⚠️ LE CHEMIN D'UN DOCUMENT NE QUITTE JAMAIS LE SERVEUR : ni vers le
 * navigateur (qui ne reçoit que `SourceRef`), ni vers le modèle (qui ne lit
 * que l'identifiant et le libellé). L'identifiant est un condensé opaque du
 * chemin ; il ne se renverse pas en chemin, et ne se forge pas utilement :
 * un identifiant absent du catalogue est refusé.
 *
 * Module PUR, testé.
 */

import type { AiKnowledge, KnowledgeDocument, KnowledgeLink } from "../knowledge.ts";
import type { AgentGuidance } from "../../organizations/agentGuidance.ts";
import { isFetchableUrl } from "./urlGuard.ts";

export type SourceKind = "page" | "document";
/** D'où vient la source : la démarche, ou les recommandations générales. */
export type SourceOrigin = "demarche" | "collectivite";

/** Ce que le navigateur et le modèle connaissent d'une source. */
export interface SourceRef {
  id: string;
  kind: SourceKind;
  origin: SourceOrigin;
  label: string;
  /** Page seulement : l'adresse PUBLIQUE, montrée à l'agent. */
  url?: string;
}

/** Vue SERVEUR : porte le chemin d'un document, qui ne sort pas d'ici. */
export interface CatalogueEntry extends SourceRef {
  /** Document seulement : chemin dans le bucket du Socle. */
  path?: string;
}

/** Au-delà, une source reste citée (`condense.ts`, étape 6) mais n'est pas proposée. */
export const MAX_CATALOGUE = 40;
/** Sources consultées dans un même appel — le budget se partage entre elles. */
export const MAX_CONSULTED = 4;
/** Sources qu'une proposition peut nommer à la fois. */
export const MAX_PROPOSED = 3;

const ID_RE = /^s-[0-9a-z]{1,8}$/;

/** Condensé FNV-1a 32 bits : stable d'un appel à l'autre, opaque, court. */
export function sourceId(kind: SourceKind, ref: string): string {
  let hash = 0x811c9dc5;
  const input = `${kind}\n${ref}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `s-${hash.toString(36)}`;
}

const UPLOAD_PREFIX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{10,})-(?=.)/i;

/**
 * Le nom affiché d'un document. `parseDocuments` retombe sur le CHEMIN quand
 * le Socle n'a pas de nom d'origine : on n'en garde alors que le nom de
 * fichier, débarrassé du préfixe unique posé au téléversement — jamais le
 * chemin entier, qui nomme l'organisation et la démarche du bucket.
 */
export function documentLabel(doc: KnowledgeDocument): string {
  const name = doc.name.trim();
  if (name !== "" && name !== doc.path) return name;
  const file = doc.path.split("/").pop() ?? "";
  return file.replace(UPLOAD_PREFIX, "") || "Document";
}

/** Libellé d'une page : sa description, sinon son adresse sans le schéma. */
export function pageLabel(link: KnowledgeLink): string {
  if (link.description.trim() !== "") return link.description.trim();
  try {
    const url = new URL(link.url);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return link.url;
  }
}

export interface CatalogueOptions {
  /**
   * Racine Socle du tenant VÉRIFIÉ. Un document dont le chemin ne commence pas
   * par elle est écarté : les chemins du bucket sont `{organisation}/{démarche}/
   * training/…`, et un administrateur de collectivité ne doit pas pouvoir faire
   * lire à Iris le document d'une AUTRE collectivité en recopiant son chemin
   * dans sa démarche — Iris lit avec une clé de plateforme.
   */
  socleOrgId?: string;
}

export function buildCatalogue(
  kb: AiKnowledge,
  guidance: AgentGuidance | null,
  options: CatalogueOptions = {},
): CatalogueEntry[] {
  const entries: CatalogueEntry[] = [];
  const ids = new Set<string>();
  const urls = new Set<string>();

  const push = (entry: CatalogueEntry) => {
    // Une collision de condensé entre deux sources d'une même démarche est
    // astronomiquement improbable ; si elle arrive, la seconde reste citée.
    if (entries.length >= MAX_CATALOGUE || ids.has(entry.id)) return;
    ids.add(entry.id);
    entries.push(entry);
  };
  // Une page qu'Iris n'irait pas lire (http, réseau local…) n'est pas
  // proposée : elle reste citée, comme avant.
  const addPage = (link: KnowledgeLink, origin: SourceOrigin) => {
    const url = link.url.trim();
    if (!isFetchableUrl(url) || urls.has(url)) return;
    urls.add(url);
    push({ id: sourceId("page", url), kind: "page", origin, label: pageLabel(link), url });
  };

  for (const link of kb.aiSources) addPage(link, "demarche");
  for (const doc of kb.trainingDocuments) {
    if (options.socleOrgId !== undefined && !doc.path.startsWith(`${options.socleOrgId}/`)) continue;
    push({
      id: sourceId("document", doc.path),
      kind: "document",
      origin: "demarche",
      label: documentLabel(doc),
      path: doc.path,
    });
  }
  for (const link of guidance?.recommendedSources ?? []) addPage(link, "collectivite");
  return entries;
}

/** La vue qui peut sortir du serveur : sans le chemin d'un document. */
export function toRef(entry: CatalogueEntry): SourceRef {
  const ref: SourceRef = { id: entry.id, kind: entry.kind, origin: entry.origin, label: entry.label };
  if (entry.url) ref.url = entry.url;
  return ref;
}

/** Les adresses de pages que le catalogue PROPOSE — elles ne sont plus « citées ». */
export function catalogueUrls(entries: CatalogueEntry[]): Set<string> {
  return new Set(entries.flatMap((e) => (e.url ? [e.url] : [])));
}

export type ParsedIds =
  | { ok: true; ids: string[] }
  | { ok: false; message: string };

/**
 * Les identifiants envoyés par le navigateur — une entrée NON FIABLE. Absents
 * = aucune source. Forme contrôlée ici, existence contrôlée par
 * `resolveSources` une fois le catalogue relu.
 */
export function parseSourceIds(raw: unknown): ParsedIds {
  if (raw === undefined || raw === null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "sources : tableau d'identifiants attendu." };
  if (raw.length > MAX_CONSULTED) {
    return { ok: false, message: `sources : ${MAX_CONSULTED} au plus.` };
  }
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !ID_RE.test(value)) {
      return { ok: false, message: "sources : identifiant invalide." };
    }
    if (!ids.includes(value)) ids.push(value);
  }
  return { ok: true, ids };
}

export type Resolved =
  | { ok: true; entries: CatalogueEntry[]; missing: string[] }
  | { ok: false; unknown: string[] };

/**
 * Confronte les identifiants demandés au catalogue relu.
 *
 * `partial` : le Socle n'a répondu qu'en partie (démarche ou recommandations
 * illisibles). Un identifiant introuvable n'est alors pas une faute du
 * navigateur — la source existe peut-être, on ne peut simplement pas la lire
 * maintenant : elle passe dans `missing`, jamais en erreur. Sinon, un
 * identifiant introuvable est refusé.
 */
export function resolveSources(catalogue: CatalogueEntry[], ids: string[], partial: boolean): Resolved {
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0 && !partial) return { ok: false, unknown };
  return {
    ok: true,
    // L'ordre du CATALOGUE, pas celui de la demande : c'est l'ordre de la
    // préséance, et le prompt le reproduit.
    entries: catalogue.filter((e) => ids.includes(e.id)),
    missing: unknown,
  };
}
