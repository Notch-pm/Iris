/**
 * Ce que le DÉPÔT d'une démarche exige, lu dans son paramétrage : les publics
 * admis (`requester_config`) et les pièces que le formulaire fait téléverser
 * (`form_schema`).
 *
 * Ce sont les CONTREPOIDS de la communication usager (`userCommunication.ts`),
 * et c'est le contrat du Socle qui l'exige :
 *  - `audience.note` ne filtre rien — les publics admis FONT FOI ;
 *  - `attachments.items` n'est pas la liste de dépôt — les pièces du formulaire
 *    FONT FOI pour le dépôt en ligne. Les deux listes ne se fusionnent jamais.
 *
 * Deux lecteurs : l'écran « Fiche démarche » et l'assistant IA. Module PUR,
 * testé.
 */

import {
  AUDIENCES,
  flatFields,
  parseFormSchema,
  parseRequesterConfig,
  type Condition,
} from "../../create-request-from-procedure/_shared/procedureForm.ts";

/** Une pièce que le formulaire de dépôt fait téléverser. */
export interface FormPiece {
  label: string;
  /** En toutes lettres : « obligatoire », « facultative »… */
  requirement: string;
  /** Vrai quand la pièce est exigée sans condition. */
  required: boolean;
}

function hasRules(condition: Condition | undefined): boolean {
  return !!condition && condition.rules.length > 0;
}

/**
 * Pièces du formulaire, libellées SANS rejouer aucune condition : la démarche
 * est décrite telle qu'elle est paramétrée, pas pour un dossier en particulier.
 *
 * `null` = formulaire absent ou illisible. `parseFormSchema` rend un schéma VIDE
 * dans les deux cas : un formulaire sans aucun champ ne permet de rien conclure,
 * et surtout pas « aucune pièce » — ce serait prendre une absence de donnée pour
 * un fait.
 */
export function formPieces(rawSchema: unknown): FormPiece[] | null {
  const fields = flatFields(parseFormSchema(rawSchema));
  if (fields.length === 0) return null;
  const out: FormPiece[] = [];
  for (const entry of fields) {
    const field = entry.field;
    if (field.type !== "attachment") continue;
    const label = field.label.trim();
    if (label === "") continue;
    const conditional = hasRules(field.visibleIf) || hasRules(entry.section?.visibleIf);
    let requirement = field.required
      ? "obligatoire"
      : hasRules(field.requiredIf)
        ? "obligatoire selon les réponses"
        : "facultative";
    if (conditional && requirement !== "obligatoire selon les réponses") {
      requirement += ", demandée selon les réponses";
    }
    out.push({ label, requirement, required: Boolean(field.required) && !conditional });
  }
  return out;
}

/**
 * Publics ACTIVÉS par la démarche. Aucun ⇒ liste vide : on ne suppose rien (le
 * repli sur « citoyen » de `selectableAudiences` sert à ne jamais bloquer une
 * SAISIE ; il n'a pas à devenir une affirmation).
 */
export function admittedAudiences(rawConfig: unknown): string[] {
  const config = parseRequesterConfig(rawConfig);
  return AUDIENCES.filter((a) => config[a.key].enabled).map((a) => a.label);
}
