// Lire les sources que l'agent a autorisé l'assistant à consulter — SEULE
// brique de ce dossier à faire du réseau et à dépendre de bibliothèques
// (`unpdf` pour les PDF, `fflate` pour les archives bureautiques). Tout ce qui
// DÉCIDE vit dans les modules purs voisins, testés par vitest : la garde
// d'adresse, le choix de l'extracteur, le filtre de décompression, la
// réduction du HTML et des formats bureautiques, le verdict « PDF scanné ».
// Motif `document/pdfRender.ts`.
//
// ⚠️ RIEN DE LA DEMANDE NE SORT VERS LE SITE CONSULTÉ : un GET nu sur
// l'adresse déclarée dans le Socle — aucun paramètre ajouté, ni cookie, ni
// Referer. Le site apprend qu'Iris l'a lu, rien de plus.
//
// ⚠️ SSRF : une page n'est suivie que si `isFetchableUrl` l'accepte, à CHAQUE
// redirection, et si son nom ne se résout pas vers une adresse privée
// (`isPublicAddress`, quand le runtime expose la résolution DNS). Reste
// l'écart entre cette résolution et celle du `fetch` (DNS complaisant) : il est
// borné par `https` sur le port 443 — un service interne ne présente pas le
// certificat du nom demandé.
//
// ⚠️ DOCUMENTS : le chemin vient du catalogue, donc de la démarche RELUE dans
// le Socle — jamais du navigateur — et commence par la racine du tenant
// (`buildCatalogue`). L'URL signée (5 min) est demandée au Socle et ne quitte
// pas ce processus : ni le navigateur ni le modèle ne la voient.
//
// ⚠️ LE CONTENU VIENT D'UN TIERS, ET LA FONCTION A DES LIMITES (256 Mo, 2 s de
// CPU) : une archive n'est décompressée que dans ses parties utiles et sous
// plafonds (`unzipFilter` — sans lui, 2 Mo de « DOCX » demandent 2 Go), un PDF
// au-delà de 10 Mo n'est pas ouvert et n'est lu que sur ses premières pages,
// une page en ligne ne peut être qu'un texte, du HTML ou un PDF, les documents
// sont lus UN PAR UN (quatre fois 25 Mo en parallèle frôleraient la mémoire),
// et toute extraction s'arrête bien au-delà de ce que l'enveloppe servira.
//
// ⚠️ TEMPS : une échéance GLOBALE de 20 s, puis la chaîne du guichet
// (55 < 60 < 75 s). Une source lente est écartée et NOMMÉE, jamais bloquante.
//
// Caches EN MÉMOIRE, par instance, et par TENANT (un texte lu pour une
// collectivité n'est jamais servi à une autre sans repasser par le Socle) :
// 30 min pour un document (son chemin porte un identifiant unique : un fichier
// remplacé change de chemin), 10 min pour une page, 2 min pour un ÉCHEC — une
// source cassée ne se relit pas à chaque question. Aucune table : rien de ce
// qui est lu n'est conservé au-delà.

import { getDocumentProxy } from "npm:unpdf@1.8.1";
import { unzipSync } from "npm:fflate@0.8.2";
import type { CatalogueEntry } from "./catalogue.ts";
import { MAX_EXTRACT_CHARS, type SourceRead } from "./consult.ts";
import { decodeText, extractorFor, pageExtractor, pdfPagesToText, type Extractor } from "./format.ts";
import { htmlToText } from "./htmlText.ts";
import { officeText, unzipFilter } from "./officeText.ts";
import { isFetchableUrl, isPublicAddress } from "./urlGuard.ts";

const READ_DEADLINE_MS = 20_000;
const PAGE_TIMEOUT_MS = 8_000;
const DOCUMENT_TIMEOUT_MS = 12_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Le plafond du bucket du Socle : un document plus gros n'existe pas. */
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Au-delà, un PDF n'est pas ouvert : pdf.js décompresse ses flux en mémoire. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_PDF_PAGES = 40;
const PAGE_TTL_MS = 10 * 60_000;
const DOCUMENT_TTL_MS = 30 * 60_000;
const FAILURE_TTL_MS = 2 * 60_000;
const USER_AGENT = "Iris (assistant d'instruction ; lecture d'une source déclarée par la collectivité)";
const TOO_SLOW = "lecture trop lente";

export interface ReadContext {
  /** Base de `public-api` du Socle. */
  socleApiBase: string;
  socleKey: string;
  /** Racine Socle du tenant VÉRIFIÉ — jamais une valeur du navigateur. */
  socleOrgId: string;
}

type Fetched = { bytes: Uint8Array; contentType: string | null; name: string };
type Failure = { reason: string };

const texts = new Map<string, { text: string; at: number }>();
const failures = new Map<string, { reason: string; at: number }>();

function cacheKey(entry: CatalogueEntry, ctx: ReadContext): string {
  return `${ctx.socleOrgId}\n${entry.kind}\n${entry.url ?? entry.path ?? ""}`;
}

function clip(text: string): string {
  return text.length > MAX_EXTRACT_CHARS ? text.slice(0, MAX_EXTRACT_CHARS) : text;
}

/**
 * Le corps, sous plafond, dans UN tampon : préalloué d'après `content-length`
 * quand il est annoncé, agrandi sinon — jamais une liste de morceaux PLUS une
 * copie finale, qui doublerait la mémoire.
 */
async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  let buffer = new Uint8Array(Number.isFinite(declared) && declared > 0 ? declared : 64 * 1024);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    if (length + value.length > buffer.length) {
      const grown = new Uint8Array(Math.min(cap, Math.max(buffer.length * 2, length + value.length)));
      grown.set(buffer.subarray(0, length));
      buffer = grown;
    }
    buffer.set(value, length);
    length += value.length;
  }
  return buffer.subarray(0, length);
}

/**
 * Le nom se résout-il vers des adresses PUBLIQUES seulement ? Quand le
 * runtime n'expose pas la résolution, ou la refuse, on laisse faire le
 * `fetch` : `https` sur 443 garde alors la porte (voir l'en-tête). Une
 * résolution qui aboutit sans aucune adresse ferme.
 */
async function resolvesPublicly(host: string, signal: AbortSignal): Promise<boolean> {
  const resolve = (Deno as unknown as {
    resolveDns?: (name: string, type: "A" | "AAAA", options?: { signal?: AbortSignal }) => Promise<string[]>;
  }).resolveDns;
  if (typeof resolve !== "function") return true;
  const results = await Promise.all((["A", "AAAA"] as const).map((type) =>
    resolve(host, type, { signal }).then(
      (addresses) => ({ ok: true, addresses }),
      () => ({ ok: false, addresses: [] as string[] }),
    )
  ));
  if (results.every((r) => !r.ok)) return true;
  const addresses = results.flatMap((r) => r.addresses);
  return addresses.length > 0 && addresses.every(isPublicAddress);
}

async function fetchPage(url: string, signal: AbortSignal): Promise<Fetched | Failure> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableUrl(current)) {
      return { reason: hop === 0 ? "adresse non autorisée" : "redirigée vers une adresse non autorisée" };
    }
    if (!(await resolvesPublicly(new URL(current).hostname, signal))) {
      return { reason: "adresse non autorisée" };
    }
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) return { reason: `page injoignable (${res.status})` };
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { reason: `page injoignable (${res.status})` };
    }
    const bytes = await readCapped(res, MAX_PAGE_BYTES);
    if (bytes === null) return { reason: "page trop volumineuse" };
    return { bytes, contentType: res.headers.get("content-type"), name: new URL(current).pathname };
  }
  return { reason: "trop de redirections" };
}

async function fetchDocument(entry: CatalogueEntry, ctx: ReadContext, signal: AbortSignal): Promise<Fetched | Failure> {
  const path = entry.path ?? "";
  const timed = AbortSignal.any([signal, AbortSignal.timeout(DOCUMENT_TIMEOUT_MS)]);
  const signedRes = await fetch(
    `${ctx.socleApiBase}/v1/documents/signed-url?path=${encodeURIComponent(path)}`,
    {
      headers: { Authorization: `Bearer ${ctx.socleKey}`, "X-Organization-Id": ctx.socleOrgId },
      signal: timed,
    },
  );
  if (!signedRes.ok) {
    await signedRes.body?.cancel().catch(() => {});
    return { reason: signedRes.status === 404 ? "document introuvable dans le référentiel" : "référentiel injoignable" };
  }
  const signed = await signedRes.json().catch(() => null) as { url?: unknown } | null;
  if (typeof signed?.url !== "string" || !signed.url.startsWith("https://")) {
    return { reason: "référentiel injoignable" };
  }
  const res = await fetch(signed.url, { signal: timed });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { reason: "document illisible" };
  }
  const bytes = await readCapped(res, MAX_DOCUMENT_BYTES);
  if (bytes === null) return { reason: "document trop volumineux" };
  return { bytes, contentType: res.headers.get("content-type"), name: path };
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string } | Failure> {
  if (bytes.length > MAX_PDF_BYTES) return { reason: "PDF trop volumineux pour être lu (plus de 10 Mo)" };
  // deno-lint-ignore no-explicit-any
  let pdf: any;
  try {
    // `stopAtErrors` : un PDF malformé échoue au lieu d'être rattrapé à grands
    // frais. (Le pdf.js embarqué n'a plus d'`eval` à désactiver.)
    pdf = await getDocumentProxy(bytes, { disableFontFace: true, stopAtErrors: true });
  } catch {
    return { reason: "PDF illisible" };
  }
  try {
    const pages: string[] = [];
    let total = 0;
    const count = Math.min(pdf.numPages as number, MAX_PDF_PAGES);
    for (let i = 1; i <= count && total < MAX_EXTRACT_CHARS; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = (content.items as { str?: string; hasEOL?: boolean }[])
        .map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : ""))
        .join("");
      pages.push(text);
      total += text.length;
    }
    const { text, scanned } = pdfPagesToText(pages);
    if (scanned) return { reason: "document scanné — lecture par reconnaissance de caractères non activée" };
    return { text: clip(text) };
  } catch {
    return { reason: "PDF illisible" };
  } finally {
    await pdf.destroy?.().catch?.(() => {});
  }
}

async function extract(extractor: Extractor, fetched: Fetched): Promise<{ text: string } | Failure> {
  switch (extractor) {
    case "text":
      // Au-delà, un fichier texte ne servirait de toute façon pas : on ne
      // décode pas 25 Mo pour en garder 120 000 caractères.
      return { text: clip(decodeText(fetched.bytes.subarray(0, MAX_EXTRACT_CHARS * 4), fetched.contentType)) };
    case "html":
      return { text: clip(htmlToText(decodeText(fetched.bytes, fetched.contentType, true)).text) };
    case "pdf":
      return await pdfText(fetched.bytes);
    default: {
      let files: Record<string, Uint8Array>;
      try {
        files = unzipSync(fetched.bytes, { filter: unzipFilter(extractor) });
      } catch {
        return { reason: "archive illisible" };
      }
      return { text: clip(officeText(extractor, files, MAX_EXTRACT_CHARS)) };
    }
  }
}

async function readOne(entry: CatalogueEntry, ctx: ReadContext, signal: AbortSignal): Promise<SourceRead> {
  const key = cacheKey(entry, ctx);
  const now = Date.now();
  const hit = texts.get(key);
  if (hit && now - hit.at < (entry.kind === "document" ? DOCUMENT_TTL_MS : PAGE_TTL_MS)) {
    return { entry, text: hit.text };
  }
  const failed = failures.get(key);
  if (failed && now - failed.at < FAILURE_TTL_MS) return { entry, text: null, reason: failed.reason };
  if (signal.aborted) return { entry, text: null, reason: TOO_SLOW };

  const outcome = await readUncached(entry, ctx, signal);
  if ("reason" in outcome) {
    // Une lecture coupée par l'échéance COMMUNE ne dit rien de la source : on
    // ne la retient pas comme un échec.
    if (outcome.reason !== TOO_SLOW) failures.set(key, { reason: outcome.reason, at: Date.now() });
    return { entry, text: null, reason: outcome.reason };
  }
  texts.set(key, { text: outcome.text, at: Date.now() });
  failures.delete(key);
  return { entry, text: outcome.text };
}

async function readUncached(
  entry: CatalogueEntry,
  ctx: ReadContext,
  signal: AbortSignal,
): Promise<{ text: string } | Failure> {
  try {
    const fetched = entry.kind === "page"
      ? await fetchPage(entry.url ?? "", signal)
      : await fetchDocument(entry, ctx, signal);
    if ("reason" in fetched) return fetched;

    // Une page : le type servi fait foi, et seuls texte, HTML et PDF passent.
    // Un document : son extension, celle que le Socle a acceptée au
    // téléversement — lue sur le libellé, qui garde le nom d'origine, sinon
    // sur le chemin.
    const choice = entry.kind === "page"
      ? pageExtractor(fetched.name, fetched.contentType)
      : extractorFor(/\.[a-z0-9]+$/i.test(entry.label) ? entry.label : fetched.name, fetched.contentType);
    if (!choice.ok) return { reason: choice.reason };

    const extracted = await extract(choice.extractor, fetched);
    if ("reason" in extracted) return extracted;
    if (extracted.text.trim() === "") return { reason: "aucun texte lisible" };
    return extracted;
  } catch (error) {
    console.error(`request-assistant: source ${entry.id} illisible — ${error instanceof Error ? error.name : "erreur"}`);
    return { reason: signal.aborted ? TOO_SLOW : "source injoignable" };
  }
}

/**
 * Lit les sources sous une échéance commune : les pages en parallèle (2 Mo
 * chacune au plus), les documents UN PAR UN (25 Mo chacun). Ne lève jamais :
 * chaque échec devient un motif, montré à l'agent. Rend les lectures dans
 * l'ordre des entrées.
 */
export async function readSources(entries: CatalogueEntry[], ctx: ReadContext): Promise<SourceRead[]> {
  if (entries.length === 0) return [];
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), READ_DEADLINE_MS);
  try {
    const pages = entries.filter((e) => e.kind === "page");
    const documents = entries.filter((e) => e.kind === "document");
    const [pageReads, documentReads] = await Promise.all([
      Promise.all(pages.map((e) => readOne(e, ctx, deadline.signal))),
      (async () => {
        const out: SourceRead[] = [];
        for (const e of documents) out.push(await readOne(e, ctx, deadline.signal));
        return out;
      })(),
    ]);
    const byId = new Map([...pageReads, ...documentReads].map((r) => [r.entry.id, r]));
    return entries.map((e) => byId.get(e.id) ?? { entry: e, text: null, reason: "source injoignable" });
  } finally {
    clearTimeout(timer);
  }
}
