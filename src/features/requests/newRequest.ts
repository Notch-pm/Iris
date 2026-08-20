// Construction du payload d'une création manuelle par un agent.
// La demande naît en a_traiter, source 'iris' (verrouillé par la policy INSERT) ;
// l'identité déclarée devient une pièce du dossier (snapshot.requester_declared).

export interface NewRequestForm {
  subject: string;
  body: string;
  priority: "basse" | "normale" | "haute" | "urgente";
  channel: string;
  /** Démarche Socle éventuelle (issue des facettes ou saisie libre). */
  procedureId: string | null;
  procedureLabel: string;
  /** Organisation destinataire éventuelle (UUID Socle + libellé). */
  destinationId: string | null;
  destinationLabel: string;
  /** Identité déclarée du demandeur — ou anonymat assumé. */
  anonymous: boolean;
  requesterLastName: string;
  requesterFirstName: string;
  requesterEmail: string;
  requesterPhone: string;
}

export const EMPTY_NEW_REQUEST: NewRequestForm = {
  subject: "",
  body: "",
  priority: "normale",
  channel: "guichet",
  procedureId: null,
  procedureLabel: "",
  destinationId: null,
  destinationLabel: "",
  anonymous: false,
  requesterLastName: "",
  requesterFirstName: "",
  requesterEmail: "",
  requesterPhone: "",
};

export type NewRequestResult =
  | { ok: true; insert: Record<string, unknown> }
  | { ok: false; message: string };

export function buildNewRequestInsert(
  form: NewRequestForm,
  organizationId: string,
  /** Snapshot de la démarche figé à la création — OBLIGATOIRE (via socle-proxy). */
  procedureSnapshot?: Record<string, unknown> | null,
): NewRequestResult {
  if (form.subject.trim() === "") {
    return { ok: false, message: "L'objet de la demande est obligatoire." };
  }
  // Règle impérative : aucune demande libre.
  if (!form.procedureId) {
    return {
      ok: false,
      message: "Toute demande doit être fondée sur une démarche Socle active — sélectionnez une démarche.",
    };
  }
  if (!procedureSnapshot || procedureSnapshot.id !== form.procedureId) {
    return {
      ok: false,
      message:
        "La démarche n'a pas pu être chargée depuis le Socle — réessayez dans un instant.",
    };
  }
  const declared = form.anonymous
    ? { anonymous: true }
    : Object.fromEntries(
        Object.entries({
          last_name: form.requesterLastName.trim(),
          first_name: form.requesterFirstName.trim(),
          email: form.requesterEmail.trim(),
          phone: form.requesterPhone.trim(),
        }).filter(([, v]) => v !== ""),
      );
  if (!form.anonymous && Object.keys(declared).length === 0) {
    return {
      ok: false,
      message:
        "Identité du demandeur obligatoire (au moins un champ), ou cochez « Demande anonyme ».",
    };
  }
  return {
    ok: true,
    insert: {
      organization_id: organizationId,
      // reference / socle_root_org_id posées par triggers.
      reference: "en-attente",
      reference_year: 0,
      reference_seq: 0,
      socle_root_org_id: organizationId, // écrasé par le trigger (dérivé du tenant)
      subject: form.subject.trim(),
      body: form.body.trim() === "" ? null : form.body.trim(),
      priority: form.priority,
      channel: form.channel.trim() === "" ? null : form.channel.trim(),
      socle_procedure_id: form.procedureId,
      // Libellés démarche/catégorie réécrits par le trigger depuis le cache (vérité serveur).
      socle_organization_id: form.destinationId,
      socle_organization_label:
        form.destinationLabel.trim() === "" ? null : form.destinationLabel.trim(),
      procedure_snapshot: procedureSnapshot,
      requester_snapshot: { declared, socle_contact_id: null },
      identity_status: form.anonymous ? "anonyme" : "non_rapprochee",
    },
  };
}
