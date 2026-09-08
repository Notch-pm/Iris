// Génération d'un document de la demande — appel de l'edge function
// `generate-request-document`.
//
// Le navigateur n'envoie QUE le modèle et trois choix (nature, format,
// demande) : le contexte de fusion — identité de l'usager relue dans le Socle,
// données du dossier, charte de la collectivité — est composé côté serveur.
// C'est la même règle que pour l'e-mail à l'usager : ce qui SIGNE au nom de la
// collectivité ne se dicte pas depuis un onglet.
//
// ⚠️ LE MODÈLE VIENT DU SOCLE : le navigateur n'envoie que son IDENTIFIANT,
// pris dans les `documents.items` de la démarche. Le serveur recharge la
// démarche, vérifie que ce modèle en fait partie, demande l'URL signée et
// télécharge le fichier lui-même — aucun octet de modèle ne transite par ici.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import type { DocumentFormat, DocumentKind } from "./documents";

export interface TemplateScan {
  variables: string[];
  loops: string[];
  images: string[];
  /** Jetons hors catalogue : ils resteront tels quels dans le document. */
  unknown: string[];
}

export interface DocumentPreview {
  /** Le modèle tel que le SERVEUR l'a résolu — nature comprise. */
  template: { id: string; name: string; type: string; kind: DocumentKind };
  scan: TemplateScan;
  /** Valeur que CETTE demande donnera à chaque variable du modèle. */
  values: Record<string, string>;
  pieces: { libelle: string; statut: string; fichier: string }[];
  /** Ce que le rendu PDF ne saura pas montrer. */
  pdf_warnings: string[];
}

export interface GeneratedDocument {
  attachment: {
    id: string;
    file_name: string;
    mime_type: string | null;
    file_size: number | null;
    kind: string;
    storage_path: string;
    created_at: string;
  };
  scan: TemplateScan;
  pdf_warnings: string[];
}

/** Ce que le modèle demande, et ce que cette demande lui donnera. Rien n'est écrit. */
export function usePreviewDocument() {
  return useMutation({
    mutationFn: async (vars: { requestId: string; templateId: string }) =>
      await invokeEdge<DocumentPreview>("generate-request-document", {
        request_id: vars.requestId,
        mode: "preview",
        template_id: vars.templateId,
      }),
  });
}

export function useGenerateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      requestId: string;
      templateId: string;
      format: DocumentFormat;
    }) =>
      await invokeEdge<GeneratedDocument>("generate-request-document", {
        request_id: vars.requestId,
        template_id: vars.templateId,
        format: vars.format,
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["request_attachments", vars.requestId] });
      void queryClient.invalidateQueries({ queryKey: ["request_events", vars.requestId] });
    },
  });
}
