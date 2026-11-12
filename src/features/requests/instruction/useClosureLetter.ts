// Le courrier de réponse papier choisi dans la modale de clôture — généré APRÈS
// la clôture (2026-11-12). UNE seule implémentation pour la fiche et la fiche
// mobile : jamais un second chemin d'écriture.
//
// ⚠️ La génération SUIT la clôture, elle ne la conditionne pas (même règle que
// l'avis de clôture) : la demande est close quoi qu'il arrive ; un échec se dit
// comme tel, et le courrier reste productible depuis l'onglet Documents. Elle
// vient APRÈS pour que `demande.etat_cloture` et `demande.date_cloture` aient
// leur valeur — le serveur fusionne l'état enregistré.
//
// ⚠️ Bloqueur de fenêtres : un `window.open` lancé après plusieurs `await`
// (clôture, puis génération) n'est plus rattaché au clic et se fait bloquer.
// Pour un PDF, l'onglet est donc réservé AU CLIC (`reserveLetterTab`, appelé
// par le dialogue dans son gestionnaire de soumission) et reçoit l'adresse du
// fichier une fois celui-ci prêt ; il se referme si la génération échoue. Un
// Word se télécharge (le navigateur ne sait pas l'afficher) : pas d'onglet.

import * as React from "react";
import { createAttachmentUrl } from "../useRequests";
import type { DocumentFormat } from "./documents";
import { useGenerateDocument } from "./useGenerateDocument";

export interface ClosureLetterRequest {
  templateId: string;
  format: DocumentFormat;
  /** Onglet réservé au clic (PDF) — `null` si refusé ou pour un Word. */
  tab?: Window | null;
}

/** À appeler DANS le gestionnaire du clic : seul moment où le navigateur ouvre un onglet. */
export function reserveLetterTab(format: DocumentFormat): Window | null {
  if (format !== "pdf" || typeof window === "undefined") return null;
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
    tab.document.title = "Génération du courrier…";
    tab.document.body.textContent = "Génération du courrier en cours…";
  } catch {
    // Onglet ouvert mais inaccessible : il recevra quand même l'adresse.
  }
  return tab;
}

function download(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function useClosureLetter(opts: {
  /** Toast de l'écran. */
  flash: (text: string) => void;
  /** Échec : la demande est bien close, l'écran le porte en bandeau. */
  onFailure: (message: string) => void;
}) {
  const { flash, onFailure } = opts;
  const generate = useGenerateDocument().mutateAsync;

  return React.useCallback(
    async (requestId: string, letter: ClosureLetterRequest) => {
      try {
        const result = await generate({ requestId, templateId: letter.templateId, format: letter.format });
        const { file_name, storage_path } = result.attachment;
        const url = await createAttachmentUrl(storage_path, letter.format === "docx" ? file_name : undefined);
        if (!url) {
          letter.tab?.close();
          flash(`${file_name} ajouté au dossier.`);
          onFailure("Le courrier a été ajouté aux documents, mais n'a pas pu être ouvert : ouvrez-le depuis l'onglet Documents.");
          return;
        }
        if (letter.format === "pdf") {
          if (letter.tab && !letter.tab.closed) letter.tab.location.href = url;
          else window.open(url, "_blank", "noopener");
        } else {
          download(url);
        }
        flash(`Courrier ${file_name} ajouté au dossier.`);
      } catch (err) {
        letter.tab?.close();
        const reason = err instanceof Error ? err.message : "génération impossible";
        onFailure(
          `La demande est bien close, mais le courrier n'a pas pu être généré (${reason}). ` +
            "Vous pouvez le produire depuis l'onglet Documents.",
        );
      }
    },
    [generate, flash, onFailure],
  );
}
