// Données de la carte des interventions : les demandes en cours du tenant (le
// RLS borne la visibilité) et le géocodage EN MASSE de leurs adresses.
//
// Un appel unitaire par demande saturerait le géocodeur : les adresses
// distinctes partent en une seule requête CSV (voir `src/lib/carto.ts`), et un
// cache de session évite de re-géocoder ce qui est déjà connu — y compris en
// revenant sur l'écran. Aucun point calculé n'est stocké côté Iris ; les
// demandes déposées AVEC un point (champ `location`) ne passent pas par ici.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  BATCH_POSTCODE_COLUMN,
  BATCH_QUERY_COLUMN,
  BATCH_RESULT_COLUMNS,
  batchGeocodeCsv,
  batchGeocodeUrl,
  parseBatchGeocodeCsv,
  type BatchAddress,
  type GeoPoint,
} from "@/lib/carto";
import {
  geocodeBatchPlan,
  MAP_MAX_ROWS,
  OPEN_STATUSES,
  RESOLVED_STATUSES,
  type MapRequestRow,
} from "./carte";

// `procedure_snapshot->form_schema` : le snapshot entier (base de connaissances,
// config demandeur) pèserait lourd × 500 demandes, pour rien ici.
const MAP_SELECT =
  "id, reference, subject, status, priority, socle_procedure_id, socle_procedure_label, " +
  "socle_category_label, socle_organization_label, assigned_to, received_at, closed_at, identity_status, " +
  "requester_snapshot, form_data, form_schema:procedure_snapshot->form_schema";

export interface MapRequestsResult {
  rows: MapRequestRow[];
  /** Total des demandes retenues (au-delà du plafond chargé, s'il y a lieu). */
  total: number;
}

/**
 * Les demandes EN COURS, plus celles RÉSOLUES depuis `resolvedSince` (ISO,
 * stable sur la journée — il entre dans la clé de requête). Le RLS borne.
 */
export function useOpenRequestsForMap(orgId: string, resolvedSince: string) {
  return useQuery({
    queryKey: ["requests-map", orgId, resolvedSince],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<MapRequestsResult> => {
      const open = OPEN_STATUSES.join(",");
      const resolved = RESOLVED_STATUSES.join(",");
      const { data, error, count } = await supabase
        .from("requests")
        .select(MAP_SELECT, { count: "exact" })
        .eq("organization_id", orgId)
        .or(`status.in.(${open}),and(status.in.(${resolved}),closed_at.gte.${resolvedSince})`)
        .order("received_at", { ascending: false })
        .limit(MAP_MAX_ROWS);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as MapRequestRow[], total: count ?? 0 };
    },
  });
}

/** Cache de session des adresses déjà géocodées (`null` = non localisée). */
const GEOCODED = new Map<string, GeoPoint | null>();

export interface BatchGeocodeResult {
  points: Map<string, GeoPoint | null>;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

export function useBatchGeocode(addresses: BatchAddress[]): BatchGeocodeResult {
  // La clé de requête vient de `geocodeBatchPlan` (pur, testé) : elle porte
  // TOUTES les adresses, jamais les seules manquantes — voir la mise en garde
  // qui accompagne cette fonction.
  const { signature } = geocodeBatchPlan(addresses, (key) => GEOCODED.has(key));

  const query = useQuery({
    queryKey: ["geocode-batch", signature],
    enabled: addresses.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async ({ signal }) => {
      // Recalculé à l'appel : le cache a pu se remplir entre-temps.
      const { missing } = geocodeBatchPlan(addresses, (key) => GEOCODED.has(key));
      if (missing.length === 0) return signature; // déjà connu de la session

      const body = new FormData();
      body.append("data", new Blob([batchGeocodeCsv(missing)], { type: "text/csv" }), "adresses.csv");
      body.append("columns", BATCH_QUERY_COLUMN);
      body.append("postcode", BATCH_POSTCODE_COLUMN);
      for (const column of BATCH_RESULT_COLUMNS) body.append("result_columns", column);

      const response = await fetch(batchGeocodeUrl(), { method: "POST", body, signal });
      if (!response.ok) {
        throw new Error(`Service de localisation indisponible (HTTP ${response.status}).`);
      }
      const found = parseBatchGeocodeCsv(await response.text());
      // Une adresse restée sans réponse est mémorisée « non localisée » : la
      // redemander à chaque rendu ne donnerait pas un meilleur résultat.
      for (const address of missing) GEOCODED.set(address.key, found.get(address.key) ?? null);
      return signature;
    },
  });

  const version = query.dataUpdatedAt;
  const points = React.useMemo(
    () => new Map(addresses.map((address) => [address.key, GEOCODED.get(address.key) ?? null])),
    // `version` fait entrer les points fraîchement géocodés dans le rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addresses, version],
  );

  return {
    points,
    isLoading: query.isLoading,
    isError: query.isError,
    retry: () => void query.refetch(),
  };
}
