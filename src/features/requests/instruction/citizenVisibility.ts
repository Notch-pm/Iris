// Visibilité d'une demande dans l'ESPACE USAGER du portail — logique pure.
//
// Un usager connecté voit toutes les demandes rattachées à sa fiche du Socle
// (`requests.socle_contact_id`). Un agent ayant le droit d'INSTRUCTION peut en
// soustraire une (confidentialité, demande d'un tiers rattachée à tort) :
// drapeau `requests.citizen_visible`.
//
// ⚠️ Ce module ne PROTÈGE rien. La garde est `t14_requests_guard_citizen_visibility`
// (SQL) ; ici on ne fait que refléter le droit et composer les libellés.

import { canProcessWith, type RequestRights } from "../statuts";

export interface CitizenVisibilityView {
  /** La demande est visible dans l'espace usager. */
  visible: boolean;
  /** État, en une phrase. */
  statusLabel: string;
  /** Libellé du bouton (le geste inverse de l'état). */
  actionLabel: string;
  /** Titre du dialogue de confirmation. */
  confirmTitle: string;
  /** Corps du dialogue de confirmation. */
  confirmBody: string;
  /** Libellé du bouton de confirmation. */
  confirmLabel: string;
  /** Libellé du bouton de confirmation pendant l'écriture. */
  pendingLabel: string;
  /** Message affiché après réussite. */
  successMessage: string;
}

/**
 * La vue de l'état, ou `null` quand la notion ne s'applique pas : sans fiche du
 * Socle rattachée, la demande n'est dans l'espace de personne.
 */
export function citizenVisibilityView(
  socleContactId: string | null | undefined,
  citizenVisible: boolean | null | undefined,
): CitizenVisibilityView | null {
  if (!socleContactId) return null;
  // Colonne absente (lecture ancienne) ⇒ défaut de la base : visible.
  const visible = citizenVisible !== false;
  return visible
    ? {
        visible,
        statusLabel: "Visible dans l'espace usager de l'usager",
        actionLabel: "Soustraire à l'espace usager",
        confirmTitle: "Soustraire cette demande à l'espace usager ?",
        confirmBody: "L'usager ne verra plus cette demande, ni ses messages, dans son espace en ligne.",
        confirmLabel: "Soustraire",
        pendingLabel: "Enregistrement…",
        successMessage: "Demande soustraite à l'espace usager",
      }
    : {
        visible,
        statusLabel: "Soustraite à l'espace usager",
        actionLabel: "Rendre visible dans l'espace usager",
        confirmTitle: "Rendre cette demande visible dans l'espace usager ?",
        confirmBody: "L'usager verra de nouveau cette demande, et ses messages, dans son espace en ligne.",
        confirmLabel: "Rendre visible",
        pendingLabel: "Enregistrement…",
        successMessage: "Demande visible dans l'espace usager",
      };
}

/**
 * Reflet de `t14` : seul le droit d'instruction sur le couple de la demande
 * change la visibilité (l'administration seule n'accorde rien), et seulement
 * pour une demande rattachée à une fiche.
 */
export function canChangeCitizenVisibility(
  rr: RequestRights,
  socleContactId: string | null | undefined,
): boolean {
  return Boolean(socleContactId) && canProcessWith(rr);
}

/** Pastille de liste : seulement pour les demandes soustraites (l'ordinaire n'est pas écrit). */
export function citizenHiddenBadge(citizenVisible: boolean | null | undefined): string | null {
  return citizenVisible === false ? "Soustraite à l'espace usager" : null;
}
