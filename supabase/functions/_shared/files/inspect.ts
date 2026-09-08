// Inspection d'un fichier reçu : taille, contenu réel, extension cohérente.
// C'est la vérification que chaque porte d'entrée applique AVANT d'écrire un
// octet dans le bucket — quelle que soit l'origine (navigateur d'un agent,
// partenaire, portail). Pure et testée.

import {
  ACCEPTED_FORMATS_LABEL,
  extensionMatches,
  extensionOf,
  sniffFile,
  type AllowedType,
} from "./magic.ts";

export type InspectFailureCode =
  | "bad_name"
  | "empty_file"
  | "payload_too_large"
  | "unsupported_media_type"
  | "extension_mismatch";

export interface InspectFailure {
  ok: false;
  code: InspectFailureCode;
  /** Message en français, relayé tel quel à l'écran ou au partenaire. */
  message: string;
}

export interface Inspected {
  ok: true;
  type: AllowedType;
  /** Nom d'affichage retenu (nettoyé, jamais utilisé comme chemin). */
  fileName: string;
}

export interface InspectInput {
  bytes: Uint8Array;
  fileName: string;
  maxBytes: number;
}

export const MAX_FILE_NAME_LENGTH = 255;

export function formatMib(bytes: number): string {
  const mib = bytes / 1_048_576;
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} Mo`;
}

export function inspectUpload(input: InspectInput): Inspected | InspectFailure {
  const fileName = input.fileName.trim();
  if (fileName === "" || fileName.length > MAX_FILE_NAME_LENGTH) {
    return { ok: false, code: "bad_name", message: "Nom de fichier absent ou trop long (255 caractères maximum)." };
  }
  if (input.bytes.length === 0) {
    return { ok: false, code: "empty_file", message: "Le fichier est vide." };
  }
  if (input.bytes.length > input.maxBytes) {
    return {
      ok: false,
      code: "payload_too_large",
      message: `Le fichier dépasse la taille maximale (${formatMib(input.maxBytes)}).`,
    };
  }
  const sniffed = sniffFile(input.bytes);
  if (sniffed.kind === "refused" && sniffed.reason === "macros") {
    return {
      ok: false,
      code: "unsupported_media_type",
      message: "Document Office avec macros refusé : enregistrez-le sans macros (.docx ou .xlsx).",
    };
  }
  if (sniffed.kind !== "type") {
    return {
      ok: false,
      code: "unsupported_media_type",
      message: `Format de fichier refusé. Formats acceptés : ${ACCEPTED_FORMATS_LABEL}.`,
    };
  }
  if (!extensionMatches(fileName, sniffed.type)) {
    const ext = extensionOf(fileName);
    return {
      ok: false,
      code: "extension_mismatch",
      message: ext === ""
        ? `Le nom du fichier doit porter l'extension de son format (${sniffed.type.label} : .${sniffed.type.extensions[0]}).`
        : `L'extension « .${ext} » ne correspond pas au contenu du fichier (${sniffed.type.label}).`,
    };
  }
  return { ok: true, type: sniffed.type, fileName };
}

/** Statut HTTP d'un refus d'inspection. */
export function httpStatusFor(code: InspectFailureCode): number {
  switch (code) {
    case "payload_too_large": return 413;
    case "unsupported_media_type": return 415;
    case "extension_mismatch": return 422;
    default: return 400;
  }
}
