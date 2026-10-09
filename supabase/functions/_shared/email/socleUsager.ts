// Ce que le Socle dit d'un usager et d'une collectivité au moment d'écrire à
// l'usager — PARTAGÉ par `send-request-email` et `notifications-mailer`
// (accusé de réception). Lectures réseau côté serveur, clé de service : rien de
// ceci ne s'exécute dans un navigateur, et rien n'est conservé.

import { charteFromSocle, type EmailCharte, type SocleBrandingDto } from "./charte.ts";
import { declaredIdentity, type RecipientIdentity } from "./destinataire.ts";

function publicApiBase(): string {
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "");
}

function contactsApiBase(): string {
  const explicit = Deno.env.get("SOCLE_CONTACTS_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return publicApiBase().replace("public-api", "contacts-api");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * L'identité portée AUJOURD'HUI par la fiche Socle de l'usager (contacts-api,
 * périmètre porté par `X-Organization-Id` = racine Socle du tenant).
 *
 * `undefined` = fiche non lisible (Socle injoignable, non configuré, fiche
 * supprimée) : l'appelant retombe sur le dépôt. Une fiche lue SANS adresse, elle,
 * est une réponse, pas une panne — on ne ressuscite pas une adresse que l'usager
 * a fait retirer du référentiel.
 */
export async function socleContactIdentity(
  socleContactId: string,
  socleRootId: string | null,
  logTag: string,
): Promise<RecipientIdentity | undefined> {
  const base = contactsApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key || !socleRootId) return undefined;
  const res = await fetch(`${base}/v1/contacts/${socleContactId}`, {
    headers: { Authorization: `Bearer ${key}`, "X-Organization-Id": socleRootId },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`${logTag}: fiche Socle ${socleContactId} illisible (${res?.status ?? "réseau"})`);
    return undefined;
  }
  const contact = await res.json().catch(() => null);
  if (!isRecord(contact)) return undefined;
  return declaredIdentity(contact);
}

// ---- La charte graphique de la collectivité --------------------------------
// Le bandeau et le bouton d'un message à l'usager portent SES couleurs et SON
// logo. La source est le Socle, et rien d'autre :
// `GET /v1/organizations/{id}/branding` sur l'organisation PORTEUSE de la
// demande (`socle_scope_org_id`). La route RÉSOUT l'héritage elle-même — « le
// logo de l'organisme concerné, ou à défaut celui de son organisation parente »
// est donc déjà répondu quand Iris lit, sans remonter aucun arbre.
//
// ⚠️ Ne JAMAIS reconstituer la charte depuis `/v1/organizations/{id}` : les
// colonnes brutes d'une organisation qui hérite sont nulles.
//
// ⚠️ DÉCORATIF, DONC JAMAIS BLOQUANT. Délai court et échec silencieux : un
// Socle lent ou muet fait partir le message en habillage Iris, il ne l'empêche
// pas de partir. C'est l'inverse exact du relais d'envoi, dont l'absence est,
// elle, un refus — sans relais il n'y a pas de message ; sans charte il y a un
// message sobre.
//
// Cache court en mémoire du worker (5 min, motif `getKeyRoots` de socle-proxy).
// Une charte graphique change deux fois par décennie, et le Socle demande de ne
// pas recopier durablement son référentiel : ni table, ni miroir, ni migration.
const BRANDING_TTL_MS = 300_000;
const charteCache = new Map<string, { charte: EmailCharte | null; at: number }>();

export async function charteFor(socleOrgId: string | null, logTag: string): Promise<EmailCharte | null> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key || !socleOrgId) return null;

  const hit = charteCache.get(socleOrgId);
  if (hit && Date.now() - hit.at < BRANDING_TTL_MS) return hit.charte;

  const res = await fetch(`${base}/v1/organizations/${socleOrgId}/branding`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!res?.ok) {
    // 404 = hors du périmètre de la clé Socle (le Socle ne révèle pas
    // l'existence de ce qu'on n'a pas le droit de voir) ; le reste est une
    // panne. Dans les deux cas : habillage Iris, une ligne de journal, et
    // surtout PAS de mise en cache — une panne d'une seconde ne doit pas
    // dépeindre les messages des cinq minutes suivantes.
    console.error(`${logTag}: charte de ${socleOrgId} illisible (${res?.status ?? "réseau"})`);
    return null;
  }
  const dto = (await res.json().catch(() => null)) as SocleBrandingDto | null;
  const charte = charteFromSocle(dto);
  charteCache.set(socleOrgId, { charte, at: Date.now() });
  return charte;
}
