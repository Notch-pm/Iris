// Modèles de document d'une démarche — CONTRAT SOCLE, lu et filtré. Module PUR
// (aucune dépendance, aucun réseau), testé par vitest et partagé par les trois
// consommateurs : `socle-proxy` (whitelist de la fiche démarche),
// `generate-request-document` (le modèle demandé est-il bien de cette
// démarche ?) et l'écran (la liste proposée à l'agent).
//
// Source : brief Socle du 2026-09-01, contrat public-api 1.6.0 —
// `GET /v1/procedures/{id}` porte désormais un bloc `documents`.
//
// ⚠️ LE PIÈGE DU CONTRAT, écrit noir sur blanc par le Socle : les conditions de
// visibilité sont CONSERVÉES quand le paramétreur désactive la restriction.
// Un modèle peut donc porter `visibility: "negative"` alors que
// `restrict_visibility` est faux — il doit alors s'afficher TOUJOURS. Lire
// `visibility` sans lire `restrict_visibility` d'abord masquerait des documents
// que la collectivité a délibérément rendus visibles.

/** Qualification fine du catalogue Socle. */
export type TemplateType = "interne" | "externe" | "courrier";
/** Découpage d'écran voulu par le Socle : deux sections, pas trois. */
export type TemplateGroup = "document" | "courrier";
/** Condition d'affichage, à ne lire qu'après `restrict_visibility`. */
export type TemplateVisibility = "toujours" | "positive" | "negative";

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string | null;
  type: TemplateType;
  group: TemplateGroup;
  file_name: string;
  visibility: TemplateVisibility;
}

export interface ProcedureDocuments {
  restrict_visibility: boolean;
  /** Dans l'ORDRE DU PARAMÉTRAGE — documents puis courriers. À respecter. */
  items: DocumentTemplate[];
}

export function emptyDocuments(): ProcedureDocuments {
  return { restrict_visibility: false, items: [] };
}

const TYPES = new Set<string>(["interne", "externe", "courrier"]);
const GROUPS = new Set<string>(["document", "courrier"]);
const VISIBILITIES = new Set<string>(["toujours", "positive", "negative"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Le bloc `documents` d'une fiche démarche, ramené au contrat. Whitelist stricte
 * (rien d'autre ne franchit la frontière) et TOLÉRANTE aux nouveautés : un
 * champ inconnu est ignoré, un item incomplet est écarté plutôt que de faire
 * échouer la lecture — une démarche jamais passée par l'étape Communication
 * rend `{ restrict_visibility: false, items: [] }`.
 */
export function parseProcedureDocuments(raw: unknown): ProcedureDocuments {
  if (!isRecord(raw)) return emptyDocuments();
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: DocumentTemplate[] = [];
  for (const entry of rawItems) {
    if (!isRecord(entry)) continue;
    const id = text(entry.id);
    const name = text(entry.name);
    const type = text(entry.type);
    const group = text(entry.group);
    const visibility = text(entry.visibility);
    if (id === "" || name === "" || !TYPES.has(type)) continue;
    items.push({
      id,
      name,
      description: text(entry.description) || null,
      type: type as TemplateType,
      // Le groupe est le découpage d'écran ; à défaut, un courrier va aux
      // courriers et le reste aux documents.
      group: (GROUPS.has(group) ? group : type === "courrier" ? "courrier" : "document") as TemplateGroup,
      file_name: text(entry.file_name),
      visibility: (VISIBILITIES.has(visibility) ? visibility : "toujours") as TemplateVisibility,
    });
  }
  return { restrict_visibility: raw.restrict_visibility === true, items };
}

/** Sort d'une demande close, du seul point de vue de ces conditions. */
export type ClosureOutcome = "positive" | "negative" | null;

/**
 * Le sort d'une demande, tel que la règle du Socle l'attend. `annulee` et
 * `archivee` ne sont NI positives NI négatives : seuls les modèles « toujours »
 * s'y proposent — le Socle ignore nos statuts, c'est à nous de traduire.
 */
export function closureOutcome(status: string): ClosureOutcome {
  if (status === "resolue_positive") return "positive";
  if (status === "resolue_negative") return "negative";
  return null;
}

/**
 * LA règle d'affichage du brief, dans cet ordre exact :
 *   · `restrict_visibility` faux ⇒ tout s'affiche (conditions ignorées) ;
 *   · sinon : « toujours », plus « positive »/« negative » selon le sort.
 * Tant que la demande n'est pas close, ni « positive » ni « negative ».
 */
export function visibleTemplates(
  documents: ProcedureDocuments,
  outcome: ClosureOutcome,
): DocumentTemplate[] {
  if (!documents.restrict_visibility) return documents.items;
  return documents.items.filter((item) =>
    item.visibility === "toujours" || item.visibility === outcome
  );
}

/** Les deux sections d'écran, dans l'ordre du paramétrage. */
export function groupTemplates(items: readonly DocumentTemplate[]): {
  documents: DocumentTemplate[];
  courriers: DocumentTemplate[];
} {
  return {
    documents: items.filter((i) => i.group === "document"),
    courriers: items.filter((i) => i.group === "courrier"),
  };
}

export function findTemplate(
  documents: ProcedureDocuments,
  templateId: string,
): DocumentTemplate | null {
  return documents.items.find((item) => item.id === templateId) ?? null;
}

/**
 * Nature Iris d'un modèle Socle. Le `type` du catalogue décide seul : l'agent
 * n'a pas à re-déclarer si un document est interne — le paramétreur l'a dit.
 */
export function kindOfTemplate(type: TemplateType): "instruction_interne" | "instruction_externe" | "courrier" {
  if (type === "interne") return "instruction_interne";
  if (type === "externe") return "instruction_externe";
  return "courrier";
}

/**
 * Le Socle rend les fichiers TELS QU'ILS ONT ÉTÉ DÉPOSÉS : `.doc`, `.docx` ou
 * `.odt`. La fusion ne sait ouvrir que le `.docx` (un zip d'XML) : `.doc` est
 * un format binaire d'un autre âge, `.odt` un autre standard. Le dire tôt et
 * clairement vaut mieux qu'un échec de dézippage.
 */
export function isMergeable(fileName: string): boolean {
  return /\.docx$/i.test(fileName.trim());
}

/** Ce qu'on affiche quand un modèle n'est pas fusionnable. */
export function unmergeableReason(fileName: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  const nom = ext ? `.${ext}` : "ce format";
  return `Le modèle est au format ${nom} : la fusion ne sait ouvrir que le .docx. ` +
    "Redéposez-le en .docx dans le Référentiel (Enregistrer sous → Document Word).";
}
