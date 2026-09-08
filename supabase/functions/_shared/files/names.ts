// Chemins d'objets du bucket `request-attachments` — une seule convention,
// écrite ici et nulle part ailleurs. Le chemin PORTE le RLS storage : le
// deuxième segment est relu comme identifiant de demande par les policies.
// Pure et testée.

/** Segment de la zone d'attente : n'est pas un UUID, donc invisible aux policies clientes. */
export const STAGING_SEGMENT = "_staging";

/** Nom de fichier → segment de chemin sûr (le chemin est généré, jamais fourni). */
export function slugifyFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return cleaned === "" ? "fichier" : cleaned;
}

/** Objet en attente, portée organisation : `{org}/_staging/{upload_id}`. */
export function stagingPath(organizationId: string, uploadId: string): string {
  return `${organizationId}/${STAGING_SEGMENT}/${uploadId}`;
}

/** Préfixe de tout objet appartenant à une demande. */
export function requestPrefix(organizationId: string, requestId: string): string {
  return `${organizationId}/${requestId}/`;
}

/** Objet définitif d'une demande : `{org}/{request}/{upload_id}-{slug}`. */
export function finalPath(
  organizationId: string,
  requestId: string,
  uploadId: string,
  fileName: string,
): string {
  return `${requestPrefix(organizationId, requestId)}${uploadId}-${slugifyFileName(fileName)}`;
}

export function isStagingPath(path: string): boolean {
  const segments = path.split("/");
  return segments.length === 3 && segments[1] === STAGING_SEGMENT;
}

export function belongsToRequest(path: string, organizationId: string, requestId: string): boolean {
  return path.startsWith(requestPrefix(organizationId, requestId));
}
