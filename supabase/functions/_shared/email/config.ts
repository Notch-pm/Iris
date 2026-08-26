// Résolution du serveur d'envoi : configuration du tenant d'abord, relais de
// plateforme en repli. Module PUR (aucune dépendance Deno) — testé par vitest.
//
// Le tenant l'emporte toujours : une collectivité qui a renseigné son propre
// relais expédie depuis son domaine. Le repli plateforme (secrets d'edge
// function) existe pour qu'un tenant fraîchement provisionné — ou un compte
// rattaché à aucun tenant — reçoive quand même ses mails d'authentification.

/** Ligne renvoyée par `smtp_config_for_org` / `mail_context_for_user`. */
export interface SmtpRow {
  organization_id?: string | null;
  organization_name?: string | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  from_email?: string | null;
  from_name?: string | null;
  use_tls?: boolean | null;
}

export interface SmtpConfig {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  fromEmail: string;
  fromName: string | null;
  useTls: boolean;
  /** Journalisée côté serveur pour diagnostiquer un envoi — jamais renvoyée au navigateur. */
  source: "tenant" | "plateforme";
}

export const DEFAULT_SMTP_PORT = 587;

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nonEmpty(value: unknown): string | null {
  const v = trimmed(value);
  return v === "" ? null : v;
}

function parsePort(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(trimmed(value), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_SMTP_PORT;
}

/**
 * `use_tls` absent ⇒ true : le chiffrement est le défaut, une configuration
 * incomplète ne doit pas dégrader silencieusement vers du clair.
 */
function parseTls(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const v = trimmed(value).toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "non") return false;
  return true;
}

/** Configuration du tenant. `null` si l'essentiel manque (hôte, expéditeur). */
export function smtpFromRow(row: SmtpRow | null | undefined): SmtpConfig | null {
  if (!row) return null;
  const host = trimmed(row.host);
  const fromEmail = trimmed(row.from_email).toLowerCase();
  if (host === "" || fromEmail === "") return null;
  return {
    host,
    port: parsePort(row.port),
    username: nonEmpty(row.username),
    password: nonEmpty(row.password),
    fromEmail,
    fromName: nonEmpty(row.from_name),
    useTls: parseTls(row.use_tls),
    source: "tenant",
  };
}

/** Relais de plateforme, depuis les secrets d'edge function. */
export function smtpFromEnv(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = trimmed(env.IRIS_SMTP_HOST);
  const fromEmail = trimmed(env.IRIS_SMTP_FROM_EMAIL).toLowerCase();
  if (host === "" || fromEmail === "") return null;
  return {
    host,
    port: parsePort(env.IRIS_SMTP_PORT),
    username: nonEmpty(env.IRIS_SMTP_USERNAME),
    password: nonEmpty(env.IRIS_SMTP_PASSWORD),
    fromEmail,
    fromName: nonEmpty(env.IRIS_SMTP_FROM_NAME),
    useTls: parseTls(env.IRIS_SMTP_USE_TLS),
    source: "plateforme",
  };
}

export function resolveSmtp(
  row: SmtpRow | null | undefined,
  env: Record<string, string | undefined>,
): SmtpConfig | null {
  return smtpFromRow(row) ?? smtpFromEnv(env);
}

/** En-tête `From:` — un nom d'expédition entre guillemets, l'adresse entre chevrons. */
export function senderHeader(config: SmtpConfig): string {
  return config.fromName
    ? `"${config.fromName.replace(/"/g, "'")}" <${config.fromEmail}>`
    : config.fromEmail;
}

/**
 * `secure` de nodemailer = TLS implicite, c'est-à-dire le port 465 seulement.
 * Sur 587 la connexion démarre en clair puis passe en TLS par STARTTLS — y
 * forcer `secure` fait échouer la poignée de main (piège classique).
 */
export function useImplicitTls(config: SmtpConfig): boolean {
  return config.useTls && config.port === 465;
}
