// Données de la base de connaissances — assemblées dans le navigateur à partir
// de trois lectures que d'autres écrans font déjà (démarches publiées du
// cache, activations par organisme, organisations miroitées). Aucune requête
// nouvelle, aucune donnée nouvelle : le RLS de ces trois tables fait foi.
//
// Le CONTENU d'une fiche, lui, est relu dans le Socle à l'ouverture
// (`useProcedureFiche`, `socle-proxy /v1/procedures/get`).

import * as React from "react";
import {
  useSocleOrganizationsCatalog,
  useSocleProcedureActivations,
  useSocleProcedureRows,
} from "@/features/socle/useSocleCatalog";
import { buildCatalogue, type KnowledgeProcedure } from "./catalogue";

export function useKnowledgeCatalogue(orgId: string) {
  const rows = useSocleProcedureRows(orgId);
  const activations = useSocleProcedureActivations(orgId);
  const organisations = useSocleOrganizationsCatalog(orgId);

  const data = React.useMemo<KnowledgeProcedure[] | null>(() => {
    if (!rows.data) return null;
    // Activations ou organisations illisibles : la liste reste utile, sans
    // les organismes — on ne bloque pas le catalogue pour une étiquette.
    return buildCatalogue(rows.data, activations.data ?? [], organisations.data ?? []);
  }, [rows.data, activations.data, organisations.data]);

  return {
    data,
    isLoading: rows.isLoading,
    isError: rows.isError,
    organismesLoading: activations.isLoading || organisations.isLoading,
  };
}
