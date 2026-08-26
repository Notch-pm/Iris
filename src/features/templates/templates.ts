// Modèles d'e-mail — logique pure, sans DOM ni réseau.
//
// Un modèle est du TEXTE BRUT (objet + corps) parsemé de variables
// `{{groupe.cle}}` remplacées, au moment de l'usage, par les informations de la
// demande et de son usager. Ni HTML, ni PDF : la mise en page d'un pli est le
// métier de Clara (décision D7, question Q8 restée ouverte).
//
// ⚠️ LE CATALOGUE EST UN CONTRAT, et il a un JUMEAU EN BASE
// (`public.email_template_variables()`). C'est la base qui refuse une variable
// inconnue — trigger `t03_email_templates_guard_variables` : ce module ne fait
// que dire la même chose plus tôt, en français, avant d'envoyer une écriture
// qu'on sait vouée à l'échec. Ajouter une variable ici SANS migration donnerait
// un écran qui promet ce que le serveur refuse.

export type VariableGroup = "usager" | "demande" | "agent" | "organisation";

export interface TemplateVariable {
  /** Clé écrite dans le modèle, sans les accolades : `usager.nom`. */
  key: string;
  group: VariableGroup;
  label: string;
  /** Valeur affichée dans l'aperçu — jamais une vraie donnée. */
  sample: string;
  /** Précision affichée dans la liste quand la source mérite un mot. */
  hint?: string;
}

export const VARIABLE_GROUP_LABELS: Record<VariableGroup, string> = {
  usager: "Usager",
  demande: "Demande",
  agent: "Agent",
  organisation: "Organisation",
};

/**
 * Catalogue complet. Chaque entrée correspond à une donnée qu'Iris possède
 * réellement — colonne de `requests`, identité figée dans `requester_snapshot`,
 * ou événement du journal.
 */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // — Usager : identité retenue au dépôt (requester_snapshot.declared) ------
  { key: "usager.civilite", group: "usager", label: "Civilité", sample: "Madame" },
  { key: "usager.prenom", group: "usager", label: "Prénom", sample: "Marie" },
  { key: "usager.nom", group: "usager", label: "Nom", sample: "Durand" },
  {
    key: "usager.nom_complet", group: "usager", label: "Nom complet", sample: "Marie Durand",
    hint: "Prénom et nom, ou la raison sociale pour une entreprise",
  },
  { key: "usager.raison_sociale", group: "usager", label: "Raison sociale", sample: "Boulangerie Durand" },
  { key: "usager.courriel", group: "usager", label: "Courriel", sample: "marie.durand@exemple.fr" },
  { key: "usager.telephone", group: "usager", label: "Téléphone", sample: "06 41 22 87 03" },
  { key: "usager.adresse", group: "usager", label: "Adresse", sample: "12 rue des Lilas, 44210 Saint-Aubin" },

  // — Demande ---------------------------------------------------------------
  { key: "demande.reference", group: "demande", label: "Référence", sample: "DEM-2026-000042" },
  { key: "demande.objet", group: "demande", label: "Objet", sample: "Nid-de-poule rue des Lilas" },
  { key: "demande.description", group: "demande", label: "Description", sample: "Un affaissement s'est formé devant le numéro 12." },
  { key: "demande.statut", group: "demande", label: "Statut", sample: "En cours d'instruction" },
  { key: "demande.priorite", group: "demande", label: "Priorité", sample: "Normale" },
  {
    key: "demande.demarche", group: "demande", label: "Démarche", sample: "Signalement de voirie",
    hint: "Le « type de demande » : la démarche Socle dont elle est issue",
  },
  { key: "demande.categorie", group: "demande", label: "Catégorie", sample: "Cadre de vie" },
  { key: "demande.destinataire", group: "demande", label: "Organisation destinataire", sample: "Direction de la voirie" },
  { key: "demande.canal", group: "demande", label: "Canal de dépôt", sample: "Guichet" },
  { key: "demande.date_depot", group: "demande", label: "Date de dépôt", sample: "21 août 2026" },
  {
    key: "demande.date_instruction", group: "demande", label: "Date de prise en charge",
    sample: "22 août 2026",
    hint: "Premier passage au statut « En cours d'instruction »",
  },
  { key: "demande.date_cloture", group: "demande", label: "Date de clôture", sample: "28 août 2026" },
  { key: "demande.date_echeance", group: "demande", label: "Date d'échéance", sample: "4 septembre 2026" },
  { key: "demande.motif_cloture", group: "demande", label: "Motif de clôture", sample: "Irrecevable" },

  // — Qui traite, et pour qui ----------------------------------------------
  { key: "agent.nom", group: "agent", label: "Agent en charge", sample: "Camille Martin" },
  { key: "organisation.nom", group: "organisation", label: "Collectivité", sample: "Ville de Saint-Aubin" },
];

const VARIABLE_KEYS = new Set(TEMPLATE_VARIABLES.map((v) => v.key));

/** Jumeau exact du motif SQL : `{{groupe.cle}}`, espaces intérieurs tolérés. */
const VARIABLE_RE = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;

export function isKnownVariable(key: string): boolean {
  return VARIABLE_KEYS.has(key);
}

/** Clés citées par un texte, dédoublonnées, dans l'ordre d'apparition. */
export function parseVariables(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VARIABLE_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Celles que la base refusera. Vide = le texte peut partir. */
export function unknownVariables(text: string): string[] {
  return parseVariables(text).filter((k) => !isKnownVariable(k));
}

/**
 * Substitution. Une clé absente de `values` devient une chaîne vide plutôt que
 * de laisser le gabarit à nu : mieux vaut une phrase avec un trou qu'un e-mail
 * qui montre `{{usager.nom}}` à un usager.
 *
 * Le texte hors variables est rendu tel quel — c'est du texte brut, aucun
 * échappement n'a de sens ici (et l'échappement HTML se ferait, le jour venu,
 * au moment du rendu de l'e-mail, pas ici).
 */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE_RE, (_match, key: string) => values[key] ?? "");
}

/** Valeurs d'exemple de l'aperçu — jamais une vraie demande. */
export function previewValues(): Record<string, string> {
  return Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, v.sample]));
}

/** Insertion d'une variable à la position du curseur. */
export function insertVariable(
  text: string,
  caret: number,
  key: string,
): { text: string; caret: number } {
  const token = `{{${key}}}`;
  const at = Math.max(0, Math.min(caret, text.length));
  return {
    text: text.slice(0, at) + token + text.slice(at),
    caret: at + token.length,
  };
}

// ---------------------------------------------------------------------------
// Validation du formulaire
// ---------------------------------------------------------------------------

export interface TemplateDraft {
  name: string;
  description: string;
  subject: string;
  body: string;
}

export function emptyDraft(): TemplateDraft {
  return { name: "", description: "", subject: "", body: "" };
}

export interface TemplateErrors {
  name?: string;
  subject?: string;
  body?: string;
}

/** Le libellé d'une variable inconnue, en français, prêt à afficher. */
function unknownMessage(keys: string[]): string {
  const liste = keys.map((k) => `{{${k}}}`).join(", ");
  return keys.length > 1
    ? `Variables inconnues : ${liste}.`
    : `Variable inconnue : ${liste}.`;
}

/**
 * Contrôles côté écran. Ils DOUBLENT la base (contraintes `btrim(...) <> ''`,
 * index unique de nom, garde de variables) — ils ne la remplacent pas : ils
 * évitent un aller-retour serveur et disent pourquoi en français.
 * L'unicité du nom, elle, ne peut être vue qu'au serveur.
 */
export function validateTemplateDraft(draft: TemplateDraft): TemplateErrors {
  const errors: TemplateErrors = {};

  if (draft.name.trim() === "") errors.name = "Donnez un nom à ce modèle.";

  if (draft.subject.trim() === "") {
    errors.subject = "L'objet est obligatoire.";
  } else {
    const unknown = unknownVariables(draft.subject);
    if (unknown.length > 0) errors.subject = unknownMessage(unknown);
  }

  if (draft.body.trim() === "") {
    errors.body = "Le corps du message est obligatoire.";
  } else {
    const unknown = unknownVariables(draft.body);
    if (unknown.length > 0) errors.body = unknownMessage(unknown);
  }

  return errors;
}

export function hasErrors(errors: TemplateErrors): boolean {
  return Object.keys(errors).length > 0;
}

// ---------------------------------------------------------------------------
// Arbre des organisations administrables
//
// La RPC `administrable_organizations` rend une liste PLATE (socle_org_id,
// socle_parent_id, name). L'écran en a besoin sous forme d'arbre — et un
// administrateur borné à une branche reçoit des nœuds dont le PARENT ne fait
// pas partie de sa liste : ces nœuds deviennent alors des racines. C'est le
// point délicat, et c'est pourquoi ça vit ici, testé.
// ---------------------------------------------------------------------------

export interface OrgRow {
  socle_org_id: string;
  socle_parent_id: string | null;
  name: string;
  obsolete?: boolean;
}

export interface OrgNode extends OrgRow {
  depth: number;
  children: OrgNode[];
}

/**
 * Liste plate → arbre. Un nœud dont le parent est absent de la liste devient
 * une racine : sans cela, l'administrateur d'une branche ne verrait RIEN.
 * Les fratries sont triées par nom.
 */
export function buildOrgTree(rows: OrgRow[]): OrgNode[] {
  const known = new Set(rows.map((r) => r.socle_org_id));
  const byId = new Map<string, OrgNode>(
    rows.map((r) => [r.socle_org_id, { ...r, depth: 0, children: [] }]),
  );

  const roots: OrgNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.socle_parent_id;
    if (parentId && known.has(parentId) && parentId !== node.socle_org_id) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const byName = (a: OrgNode, b: OrgNode) => a.name.localeCompare(b.name, "fr");
  const setDepth = (nodes: OrgNode[], depth: number) => {
    nodes.sort(byName);
    for (const n of nodes) {
      n.depth = depth;
      setDepth(n.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  return roots;
}

/** L'arbre remis à plat, dans l'ordre d'affichage (profondeur d'abord). */
export function flattenOrgTree(nodes: OrgNode[]): OrgNode[] {
  const out: OrgNode[] = [];
  const walk = (list: OrgNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
