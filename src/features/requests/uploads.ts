// Téléversement d'une pièce depuis le navigateur — par l'edge function
// `request-attachments`, jamais directement dans le bucket (2026-09-08).
//
// Le serveur vérifie le CONTENU réel du fichier (signature binaire contre la
// liste fermée des formats, extension cohérente, taille), calcule son
// empreinte et l'inscrit dans la zone d'attente. Le navigateur ne reçoit qu'un
// `upload_id`, qu'il passe ensuite à la RPC ou à l'edge function du geste
// (création, ajout de pièce, e-mail). Aucun chemin ne transite plus par ici.
//
// Deux portées : sans `requestId`, la demande n'existe pas encore (guichet) ;
// avec, la pièce est reçue POUR cette demande (instruction). Le périmètre va
// dans l'URL : les droits sont vérifiés AVANT que le serveur ne lise le corps.

import { invokeEdge, invokeEdgeForm } from "@/lib/edge";

export interface UploadReceipt {
  upload_id: string;
  file_name: string;
  /** Type DÉTECTÉ par le serveur, pas celui annoncé par le navigateur. */
  mime_type: string;
  size_bytes: number;
  /** Consultable dans l'onglet (PDF, image raster) ; sinon téléchargement seul. */
  inline: boolean;
}

export interface UploadScope {
  organizationId: string;
  requestId?: string | null;
}

export async function stageFile(file: File, scope: UploadScope): Promise<UploadReceipt> {
  const form = new FormData();
  form.append("file", file, file.name);
  const query: Record<string, string> = { organization_id: scope.organizationId };
  if (scope.requestId) query.request_id = scope.requestId;
  try {
    return await invokeEdgeForm<UploadReceipt>("request-attachments/upload", form, query);
  } catch (err) {
    const message = err instanceof Error ? err.message : "envoi refusé";
    throw new Error(`« ${file.name} » : ${message}`);
  }
}

/** Séquentiel, délibérément : un envoi à la fois, un message d'erreur qui nomme le fichier. */
export async function stageFiles(files: readonly File[], scope: UploadScope): Promise<UploadReceipt[]> {
  const out: UploadReceipt[] = [];
  for (const file of files) out.push(await stageFile(file, scope));
  return out;
}

/** Retire des pièces reçues et pas encore rattachées (propriétaire seul, côté serveur). */
export async function discardUploads(uploadIds: readonly string[]): Promise<void> {
  if (uploadIds.length === 0) return;
  try {
    await invokeEdge("request-attachments/discard", { upload_ids: [...uploadIds] });
  } catch {
    // Best-effort : la purge de la zone d'attente rattrapera ce qui reste.
  }
}
