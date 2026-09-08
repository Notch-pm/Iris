// Lecture d'un envoi `multipart/form-data` portant UN fichier — la forme
// commune aux trois portes (navigateur, partenaire, portail). Pure vis-à-vis
// de Deno : ne dépend que des API Web (`Request`, `FormData`), donc testable
// sous Node.
//
// ⚠️ `Content-Length` est vérifié AVANT de lire le corps : un envoi de 300 Mo
// est refusé sans être chargé en mémoire. La taille exacte du fichier est
// revérifiée après lecture (le corps multipart n'est pas le fichier).

export interface MultipartFile {
  bytes: Uint8Array;
  /** Nom tel que fourni par le client (à nettoyer par l'appelant). */
  name: string;
  /** Type ANNONCÉ — informatif seulement, jamais cru. */
  declaredType: string;
}

export type MultipartResult =
  | { ok: true; file: MultipartFile; fields: Record<string, string> }
  | { ok: false; code: "bad_request" | "payload_too_large"; message: string };

export interface MultipartOptions {
  /** Taille maximale du FICHIER. Le corps peut la dépasser de l'enrobage multipart. */
  maxBytes: number;
  /** Nom du champ fichier (défaut `file`). */
  fileField?: string;
}

/** Marge d'enrobage multipart tolérée au-delà de `maxBytes` (limites, en-têtes, champs texte). */
const ENVELOPE_ALLOWANCE = 64 * 1024;

function isBlobLike(value: unknown): value is Blob & { name?: string } {
  return typeof value === "object" && value !== null
    && typeof (value as Blob).arrayBuffer === "function"
    && typeof (value as Blob).size === "number";
}

export async function readSingleFileForm(
  req: Request,
  options: MultipartOptions,
): Promise<MultipartResult> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType)) {
    return { ok: false, code: "bad_request", message: "Envoi multipart/form-data attendu." };
  }
  const declaredLength = Number.parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes + ENVELOPE_ALLOWANCE) {
    return {
      ok: false,
      code: "payload_too_large",
      message: `Le fichier dépasse la taille maximale (${Math.round(options.maxBytes / 1_048_576)} Mo).`,
    };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, code: "bad_request", message: "Corps multipart illisible." };
  }

  const fieldName = options.fileField ?? "file";
  const fields: Record<string, string> = {};
  let file: MultipartFile | null = null;
  for (const [key, value] of form.entries()) {
    if (isBlobLike(value)) {
      if (key !== fieldName) {
        return { ok: false, code: "bad_request", message: `Un seul fichier attendu, dans le champ « ${fieldName} ».` };
      }
      if (file !== null) {
        return { ok: false, code: "bad_request", message: "Un seul fichier par envoi." };
      }
      if (value.size > options.maxBytes) {
        return {
          ok: false,
          code: "payload_too_large",
          message: `Le fichier dépasse la taille maximale (${Math.round(options.maxBytes / 1_048_576)} Mo).`,
        };
      }
      file = {
        bytes: new Uint8Array(await value.arrayBuffer()),
        name: typeof value.name === "string" ? value.name : "",
        declaredType: value.type ?? "",
      };
    } else if (typeof value === "string") {
      fields[key] = value;
    }
  }
  if (file === null) {
    return { ok: false, code: "bad_request", message: `Fichier absent (champ « ${fieldName} »).` };
  }
  return { ok: true, file, fields };
}
