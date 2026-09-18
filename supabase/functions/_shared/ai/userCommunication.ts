/**
 * Ce que la collectivité écrit POUR SES USAGERS — lu par l'assistant.
 *
 * Depuis le contrat public-api **1.24.0** (Socle, 2026-09-18), une démarche
 * porte ce que l'usager lit avant de déposer — sixième étape de l'éditeur,
 * « Communication usager » :
 *   - `user_communication` : durée habituelle d'instruction, précision sur le
 *     public concerné, pièces ANNONCÉES, FAQ USAGER ;
 *   - `user_description` : le descriptif usager, en Markdown — colonne VOISINE,
 *     que l'éditeur remplit au même endroit.
 *
 * L'assistant les lit parce que l'agent se fait poser, au guichet comme au
 * téléphone, les questions auxquelles la page de la démarche répond :
 * « combien de temps ? », « quelles pièces ? ». Il doit pouvoir répondre CE QUE
 * LA COLLECTIVITÉ A ANNONCÉ — et le présenter comme tel.
 *
 * Tout ce que porte cette colonne est PUBLIC (invariant du Socle) : rien à
 * retirer avant de l'envoyer chez le fournisseur, à la différence de
 * `form_data`. Aucune identité n'y figure.
 *
 * La whitelist du bloc est CELLE de l'écran et du proxy
 * (`_shared/procedures/userCommunication.ts`), les contrepoids ceux de l'écran
 * (`_shared/procedures/deposit.ts`) : ce module ne fait que les assembler dans
 * la forme que `condense.ts` rend.
 *
 * LES SIX PIÈGES DU CONTRAT, et où chacun est tenu :
 *  1. Le descriptif n'est pas dans l'objet → lu à côté, dans `user_description`.
 *  2. Trois durées, aucune ne se déduit d'une autre → seule la durée
 *     d'INSTRUCTION est lue, et libellée ainsi. L'unité n'est JAMAIS déduite :
 *     une unité inconnue fait taire le délai plutôt que d'en supposer une —
 *     là où le parseur de l'éditeur Socle, qui sert une saisie, se replie sur
 *     « jour ». `0` et les valeurs hors bornes ne sont pas des délais.
 *  3. `audience.note` ne filtre rien → le bloc de rendu la dit « phrase
 *     d'information », et pose à côté les publics ADMIS (`requester_config`),
 *     qui font foi en cas de contradiction.
 *  4. `attachments.items` n'est PAS la liste des pièces à déposer → deux listes
 *     distinctes, jamais fusionnées : celle du formulaire (`form_schema`, fait
 *     foi pour le dépôt) et celle de l'annonce.
 *  5. Deux FAQ, une seule est publique → la FAQ usager a son propre champ ;
 *     celle du service reste dans `knowledge.ts`. Elles ne se mélangent pas.
 *  6. `null` = la collectivité n'a rien écrit → aucun bloc, et aucune phrase
 *     composée à sa place (`isUserCommunicationEmpty`).
 *
 * Publics admis et pièces du formulaire sont des CONTREPOIDS : ils ne rendent
 * pas, à eux seuls, la communication « non vide ». Le formulaire existe sur
 * presque toutes les démarches ; le compter ici ferait dire « base de
 * connaissances lue » à une démarche que le service n'a jamais documentée.
 *
 * Module PUR (aucune dépendance Deno), testé.
 */

import {
  parseUserCommunication,
  processingTimeLabel,
  type UserCommunicationFaqItem,
  type UserCommunicationPiece,
} from "../procedures/userCommunication.ts";
import { admittedAudiences, formPieces, type FormPiece } from "../procedures/deposit.ts";

export type { FormPiece } from "../procedures/deposit.ts";

export interface UserCommunicationKnowledge {
  /** Descriptif usager (Markdown), colonne `user_description`. */
  description: string;
  /** Durée habituelle d'instruction, libellée (« 3 semaines »). `null` = non annoncée. */
  processingTime: string | null;
  /** Précision éditoriale sur le public concerné. Ne filtre rien. */
  audienceNote: string;
  /** Pièces annoncées à l'usager, dans l'ordre choisi par la collectivité. */
  announcedPieces: UserCommunicationPiece[];
  /** FAQ USAGER — jamais celle du service. */
  faq: UserCommunicationFaqItem[];
  /** CONTREPOIDS de `audienceNote` : publics admis au dépôt (fait foi). */
  admittedAudiences: string[];
  /**
   * CONTREPOIDS de `announcedPieces` : pièces du formulaire de dépôt (fait foi).
   * `null` = formulaire absent ou illisible — on n'en dit RIEN, et surtout pas
   * « aucune pièce ».
   */
  formPieces: FormPiece[] | null;
}

export function emptyUserCommunication(): UserCommunicationKnowledge {
  return {
    description: "",
    processingTime: null,
    audienceNote: "",
    announcedPieces: [],
    faq: [],
    admittedAudiences: [],
    formPieces: null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Démarche du Socle (`GET /v1/procedures/{id}`) → ce que l'assistant en lit
 * pour les usagers. Tolérante à l'absence, à l'inconnu et aux types faux ;
 * toujours une structure complète en sortie.
 */
export function parseUserCommunicationKnowledge(procedure: unknown): UserCommunicationKnowledge {
  const out = emptyUserCommunication();
  const proc = record(procedure);
  if (!proc) return out;

  out.description = typeof proc.user_description === "string" ? proc.user_description.trim() : "";

  const uc = parseUserCommunication(proc.user_communication);
  if (uc) {
    out.processingTime = processingTimeLabel(uc.delays);
    out.audienceNote = uc.audience.note;
    out.announcedPieces = uc.attachments.items;
    out.faq = uc.faq.items;
  }

  out.admittedAudiences = admittedAudiences(proc.requester_config);
  out.formPieces = formPieces(proc.form_schema);
  return out;
}

/**
 * La collectivité a-t-elle écrit quelque chose pour ses usagers ? Les
 * contrepoids (publics admis, pièces du formulaire) ne comptent pas : voir
 * l'en-tête.
 */
export function isUserCommunicationEmpty(uc: UserCommunicationKnowledge): boolean {
  return uc.description === "" && uc.processingTime === null &&
    uc.audienceNote === "" && uc.announcedPieces.length === 0 && uc.faq.length === 0;
}
