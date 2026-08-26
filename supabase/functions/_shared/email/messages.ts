// Catalogue des messages d'email d'Iris — en français, un objet par type.
// Module PUR (aucune dépendance Deno) — testé par vitest.
//
// Les durées de validité ne sont JAMAIS chiffrées ici : elles dépendent de la
// configuration GoTrue du projet et se désynchroniseraient en silence. On dit
// ce qui est vrai dans tous les cas — usage unique, et quoi faire si le lien
// a expiré.

import { brandLine, PRODUCT_NAME, type EmailBrand, type EmailContent } from "./template.ts";

// Réexporté par compatibilité : le nom vit désormais dans `template.ts`.
export { PRODUCT_NAME };

/** Types d'emails émis par GoTrue (hook « Send Email »). */
export type AuthEmailKind =
  | "recovery"
  | "invite"
  | "signup"
  | "magiclink"
  | "email_change"
  | "reauthentication";

export interface AuthEmailOptions {
  /** Tenant de rattachement du destinataire, quand il est connu. */
  tenantName?: string | null;
  /** Nom affichable du destinataire, pour la salutation. */
  recipientName?: string | null;
  /** Lien d'action (bouton). Absent pour la réauthentification. */
  actionUrl?: string | null;
  /** Code à recopier (réauthentification uniquement). */
  code?: string | null;
}

/**
 * Normalise le `email_action_type` de GoTrue. Le changement d'adresse arrive
 * en deux variantes (`email_change_current` / `email_change_new`) ; un type
 * inconnu retombe sur « recovery », le cas de très loin le plus fréquent.
 */
export function authEmailKind(actionType: string): AuthEmailKind {
  const t = actionType.trim().toLowerCase();
  if (t.startsWith("email_change")) return "email_change";
  if (t === "invite" || t === "signup" || t === "magiclink" || t === "reauthentication") return t;
  return "recovery";
}

export function brandFor(tenantName?: string | null): EmailBrand {
  return { productName: PRODUCT_NAME, tenantName: tenantName ?? null };
}

function greeting(recipientName?: string | null): string {
  const name = recipientName?.trim();
  return name ? `Bonjour ${name},` : "Bonjour,";
}

function subjectFor(title: string, tenantName?: string | null): string {
  return `${title} — ${brandLine(brandFor(tenantName))}`;
}

/** Formule d'appartenance : « d'Iris » ou « d'Iris, pour Ville de X ». */
function context(tenantName?: string | null): string {
  const tenant = tenantName?.trim();
  return tenant ? `${PRODUCT_NAME}, le suivi des demandes d'usagers de ${tenant}` : PRODUCT_NAME;
}

export function authEmailContent(kind: AuthEmailKind, opts: AuthEmailOptions = {}): EmailContent {
  const hello = greeting(opts.recipientName);
  const url = opts.actionUrl ?? "";

  switch (kind) {
    case "invite":
      return {
        subject: subjectFor("Activez votre compte", opts.tenantName),
        heading: "Bienvenue sur Iris",
        paragraphs: [
          hello,
          `Un compte vient d'être ouvert pour vous sur ${context(opts.tenantName)}.`,
          "Cliquez sur le bouton ci-dessous pour définir votre mot de passe et activer votre compte.",
        ],
        cta: { label: "Activer mon compte", url },
        footnote:
          "Ce lien est à usage unique. S'il a expiré, demandez un nouvel envoi à votre administrateur.",
      };

    case "signup":
      return {
        subject: subjectFor("Confirmez votre adresse e-mail", opts.tenantName),
        heading: "Confirmation de votre adresse",
        paragraphs: [
          hello,
          "Confirmez votre adresse e-mail pour terminer la création de votre compte.",
        ],
        cta: { label: "Confirmer mon adresse", url },
        footnote: "Ce lien est à usage unique.",
      };

    case "magiclink":
      return {
        subject: subjectFor("Votre lien de connexion", opts.tenantName),
        heading: "Lien de connexion",
        paragraphs: [hello, "Cliquez sur le bouton ci-dessous pour vous connecter à votre compte."],
        cta: { label: "Me connecter", url },
        footnote:
          "Ce lien est à usage unique. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
      };

    case "email_change":
      return {
        subject: subjectFor("Confirmez le changement d'adresse", opts.tenantName),
        heading: "Changement d'adresse e-mail",
        paragraphs: [
          hello,
          "Vous avez demandé à changer l'adresse e-mail de votre compte. Confirmez ce changement pour qu'il prenne effet.",
        ],
        cta: { label: "Confirmer le changement", url },
        footnote:
          "Ce lien est à usage unique. Si vous n'êtes pas à l'origine de cette demande, contactez votre administrateur.",
      };

    case "reauthentication":
      return {
        subject: subjectFor("Votre code de vérification", opts.tenantName),
        heading: "Code de vérification",
        paragraphs: [hello, "Voici le code à saisir pour confirmer votre identité."],
        code: opts.code ?? "",
        footnote: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
      };

    case "recovery":
    default:
      return {
        subject: subjectFor("Réinitialisation de votre mot de passe", opts.tenantName),
        heading: "Réinitialisation de mot de passe",
        paragraphs: [
          hello,
          `Une réinitialisation de mot de passe a été demandée pour votre compte ${context(opts.tenantName)}.`,
          "Cliquez sur le bouton ci-dessous pour en choisir un nouveau.",
        ],
        cta: { label: "Choisir un nouveau mot de passe", url },
        footnote:
          "Ce lien est à usage unique. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
      };
  }
}

