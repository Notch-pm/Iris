// La PORTE UNIQUE de réception : tout octet qui entre dans le bucket
// `request-attachments` passe ici — qu'il vienne d'un agent (edge
// `request-attachments`), d'un partenaire (`requests-api /v1/uploads`) ou du
// serveur lui-même (`generate-request-document`). Inspection (taille, type
// réel, extension), empreinte sha256, écriture avec le type DÉTECTÉ, et rien
// d'autre : la ligne en base est l'affaire de l'appelant, qui retire l'objet
// (`discard`) si elle échoue.
//
// Le client Storage est INJECTÉ : le module reste pur et testable avec un
// double, et ne connaît ni Deno ni supabase-js.

import { inspectUpload, type InspectFailure } from "./inspect.ts";
import { sha256HexOf } from "./checksum.ts";

export interface StorageBucketLike {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

export interface ReceiveInput {
  /** Chemin d'objet DÉCIDÉ par l'appelant (staging ou demande) — jamais par le client. */
  path: string;
  bytes: Uint8Array;
  fileName: string;
  maxBytes: number;
}

export interface Received {
  ok: true;
  path: string;
  fileName: string;
  /** Type MIME détecté — celui écrit dans le bucket. */
  mime: string;
  size: number;
  /** sha256 hexadécimal. */
  checksum: string;
  inline: boolean;
}

export type ReceiveFailure =
  | InspectFailure
  | { ok: false; code: "storage_failed"; message: string };

export async function receiveFile(
  bucket: StorageBucketLike,
  input: ReceiveInput,
): Promise<Received | ReceiveFailure> {
  const inspected = inspectUpload({ bytes: input.bytes, fileName: input.fileName, maxBytes: input.maxBytes });
  if (!inspected.ok) return inspected;

  const checksum = await sha256HexOf(input.bytes);
  const { error } = await bucket.upload(input.path, input.bytes, {
    contentType: inspected.type.mime,
    upsert: false,
  });
  if (error) {
    return { ok: false, code: "storage_failed", message: `Le fichier n'a pas pu être enregistré (${error.message}).` };
  }
  return {
    ok: true,
    path: input.path,
    fileName: inspected.fileName,
    mime: inspected.type.mime,
    size: input.bytes.length,
    checksum,
    inline: inspected.type.inline,
  };
}

/** Compensation : l'objet est retiré quand la ligne qui devait le décrire n'a pas pu être écrite. */
export async function discardReceived(bucket: StorageBucketLike, path: string): Promise<void> {
  const { error } = await bucket.remove([path]);
  if (error) console.error(`receiveFile: compensation en échec sur ${path} — ${error.message}`);
}
