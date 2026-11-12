// Modèles d'e-mail — logique pure, sans DOM ni réseau.
//
// Un modèle est du TEXTE BRUT (objet + corps) parsemé de variables
// `{{groupe.cle}}` remplacées, au moment de l'usage, par les informations de la
// demande et de son usager, et de SECTIONS `{{#cle}}…{{/cle}}` (rendues
// seulement si la variable a une valeur). Ni HTML, ni PDF : la mise en page
// d'un pli est le métier de Clara (décision D7, question Q8 restée ouverte).
//
// ⚠️ Depuis le 2026-11-12, les modèles se rédigent dans le SOCLE (décision PO)
// et LE CATALOGUE EST CELUI DU SOCLE : une liste unique pour la gamme,
// publiée par `GET /v1/email-templates/variables` (`common`), gardée en base
// par le Socle, qui REFUSE une variable inconnue. Ses clés sont celles qu'Iris
// a toujours remplies, plus `usager.salutation`. Ce fichier en est la copie
// côté Iris : une clé ajoutée au Socle doit l'être ici ET dans
// `requestTemplateValues` (courriel.ts), sinon elle part vide.

import { renderTemplateText } from "@fn/_shared/email/socleTemplates";

export type VariableGroup = "usager" | "demande" | "agent" | "organisation";

export interface TemplateVariable {
  /** Clé écrite dans le modèle, sans les accolades : `usager.nom`. */
  key: string;
  group: VariableGroup;
  label: string;
  /** Valeur affichée dans un aperçu — jamais une vraie donnée. */
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
 * Catalogue commun (contrat Socle, même ordre que
 * `email_template_common_variables()`). Chaque entrée correspond à une donnée
 * qu'Iris possède réellement — colonne de `requests`, identité figée dans
 * `requester_snapshot`, ou événement du journal.
 */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // — Usager : identité retenue au dépôt (requester_snapshot.declared) ------
  {
    key: "usager.salutation", group: "usager", label: "Formule d'appel", sample: "Madame Marie Durand",
    hint: "« Madame Marie Durand », à défaut « Madame, Monsieur »",
  },
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
    hint: "Le « type de demande » : la démarche du Référentiel dont elle est issue",
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

/**
 * Substitution. Sections d'abord, puis variables ; une clé absente de
 * `values` devient une chaîne vide plutôt que de laisser le gabarit à nu :
 * mieux vaut une phrase avec un trou qu'un e-mail qui montre `{{usager.nom}}`
 * à un usager. Même moteur que les courriels automatiques (`@fn`).
 *
 * Le texte hors variables est rendu tel quel — c'est du texte brut, aucun
 * échappement n'a de sens ici (l'échappement HTML se fait au rendu du courriel).
 */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return renderTemplateText(text, values);
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
