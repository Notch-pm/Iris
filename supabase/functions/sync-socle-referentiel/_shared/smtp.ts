// Serveur d'envoi du tenant : correspondance API Socle → miroir Iris.
// Logique pure, testée par vitest — aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/organizations/{id}/smtp`, scope
// `smtp`). Iris ne fait que recopier ce qu'il déclare, et RIEN d'autre : ce
// module décide seulement si la déclaration est exploitable.
//
// Prudence assumée : au moindre doute (hôte manquant, adresse d'expédition
// absurde, `configured: false`), on renvoie `null` → l'appelant EFFACE le
// miroir et l'envoi retombe sur le relais de plateforme. Un relais à moitié
// configuré n'expédie pas, il fait échouer des mails d'authentification.

import type { TenantRef } from "./mapping.ts";

/** Réponse de `GET /v1/organizations/{id}/smtp` (contrat public Socle). */
export interface SocleSmtpDto {
  organization_id?: string | null;
  configured?: boolean | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  from_email?: string | null;
  from_name?: string | null;
  use_tls?: boolean | null;
  updated_at?: string | null;
}

/** Arguments de la RPC de service `sync_smtp_settings_from_socle`. */
export interface SmtpMirrorArgs {
  p_org_id: string;
  p_socle_org_id: string;
  p_host: string;
  p_port: number;
  p_username: string | null;
  p_password: string | null;
  p_from_email: string;
  p_from_name: string | null;
  p_use_tls: boolean;
  p_socle_updated_at: string | null;
}

export const DEFAULT_SMTP_PORT = 587;

/** Même forme que la validation serveur (RPC) — une adresse, pas une phrase. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nonEmpty(value: unknown): string | null {
  const v = trimmed(value);
  return v === "" ? null : v;
}

function port(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(trimmed(value), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_SMTP_PORT;
}

/**
 * Déclaration du Socle → arguments de la RPC, ou `null` si le tenant n'a pas de
 * relais exploitable (le miroir doit alors être effacé).
 *
 * Le mot de passe n'est jamais élagué (une espace peut en faire partie) et
 * n'apparaît nulle part ailleurs : ni journal, ni compteur, ni message d'erreur.
 */
export function smtpMirrorArgs(tenant: TenantRef, dto: SocleSmtpDto | null | undefined): SmtpMirrorArgs | null {
  if (!dto || dto.configured !== true) return null;
  const host = nonEmpty(dto.host);
  const fromEmail = trimmed(dto.from_email).toLowerCase();
  if (host === null || !EMAIL_RE.test(fromEmail)) return null;
  return {
    p_org_id: tenant.organizationId,
    p_socle_org_id: tenant.socleOrgId,
    p_host: host,
    p_port: port(dto.port),
    p_username: nonEmpty(dto.username),
    p_password: typeof dto.password === "string" && dto.password !== "" ? dto.password : null,
    p_from_email: fromEmail,
    p_from_name: nonEmpty(dto.from_name),
    // Absent ⇒ chiffrement : une configuration incomplète ne dégrade jamais
    // silencieusement vers du clair (même règle que `_shared/email/config.ts`).
    p_use_tls: dto.use_tls !== false,
    p_socle_updated_at: nonEmpty(dto.updated_at),
  };
}

/**
 * Message d'avertissement d'un tenant dont le relais n'a pas pu être relu.
 * Journalisé dans `sync_runs.counters.warnings` : il doit dire quoi faire, et
 * ne jamais porter d'identifiant secret.
 */
export function smtpWarning(tenant: TenantRef, status: number): string {
  const prefix = `serveur d'envoi (tenant ${tenant.organizationId})`;
  if (status === 403) {
    return `${prefix} : la clé Socle ne porte pas le scope « smtp » — miroir inchangé.`;
  }
  if (status === 404) {
    return `${prefix} : organisation hors périmètre de la clé, ou API Socle sans la route /smtp — miroir inchangé.`;
  }
  return `${prefix} : réponse ${status} du Socle — miroir inchangé.`;
}
