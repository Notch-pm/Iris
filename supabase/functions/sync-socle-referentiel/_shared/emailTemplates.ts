// Modèles de courriels du tenant : correspondance API Socle → miroir Iris.
// Logique pure, testée par vitest — aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/email-templates?organization_id=
// <racine>&application=iris`, public-api ≥ 1.45.0). Iris recopie, et ne garde
// que ce qu'il sait servir : les modèles de SA racine, cochés pour `iris`,
// avec un objet et un corps. Un modèle malformé est écarté, jamais réparé.

import type { TenantRef } from "./mapping.ts";

/** Un élément de `GET /v1/email-templates` (contrat public Socle 1.45.0). */
export interface SocleEmailTemplateDto {
  id?: string | null;
  key?: string | null;
  organization_id?: string | null;
  name?: string | null;
  description?: string | null;
  subject?: string | null;
  body?: string | null;
  applications?: string[] | null;
  organization_ids?: string[] | null;
  is_system?: boolean | null;
  is_customized?: boolean | null;
  variables?: string[] | null;
  updated_at?: string | null;
}

/** Ce que reçoit la RPC de service `sync_email_templates_from_socle` (`p_templates`). */
export interface EmailTemplateMirrorRow {
  id: string | null;
  key: string | null;
  name: string;
  description: string | null;
  subject: string;
  body: string;
  organization_ids: string[] | null;
  variables: string[];
  is_customized: boolean;
  updated_at: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Les lignes du miroir d'UN tenant. `null` si la réponse n'est pas une liste
 * (Socle trop ancien, réponse inattendue) : l'appelant garde alors le miroir en
 * l'état plutôt que de l'effacer sur un malentendu.
 */
export function emailTemplateMirrorRows(
  tenant: TenantRef,
  payload: unknown,
): EmailTemplateMirrorRow[] | null {
  if (!Array.isArray(payload)) return null;
  const rows: EmailTemplateMirrorRow[] = [];
  for (const raw of payload as SocleEmailTemplateDto[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.organization_id !== tenant.socleOrgId) continue;
    if (!strings(raw.applications).includes("iris")) continue;
    const subject = text(raw.subject);
    const body = text(raw.body);
    const name = text(raw.name);
    if (!subject || !body || !name) continue;
    const key = typeof raw.key === "string" && KEY_RE.test(raw.key) ? raw.key : null;
    const id = typeof raw.id === "string" && UUID_RE.test(raw.id) ? raw.id : null;
    // Un modèle créé a un identifiant ; un courriel système, une clé.
    if (!key && !id) continue;
    rows.push({
      id,
      key,
      name,
      description: text(raw.description),
      subject,
      body,
      // Un courriel système vaut partout (null) ; un modèle créé n'est proposé
      // que dans ses organismes — liste vide = nulle part.
      organization_ids: key ? null : strings(raw.organization_ids).filter((v) => UUID_RE.test(v)),
      variables: strings(raw.variables),
      is_customized: raw.is_customized === true,
      updated_at: text(raw.updated_at),
    });
  }
  return rows;
}

/** Avertissement d'une lecture refusée, dans le vocabulaire de `smtpWarning`. */
export function emailTemplatesWarning(tenant: TenantRef, status: number): string {
  if (status === 404) {
    return `modèles de courriels (tenant ${tenant.organizationId}) : le Socle ne sert pas encore /v1/email-templates (public-api ≥ 1.45.0) — textes d'origine d'Iris conservés`;
  }
  return `modèles de courriels (tenant ${tenant.organizationId}) : le Socle répond ${status} — miroir conservé en l'état`;
}
