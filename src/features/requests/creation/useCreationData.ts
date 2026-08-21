// Données d'appoint du parcours de création : volume mensuel par démarche
// (cartes du sélecteur) et demandes proches de l'usager désigné (rail).
// Lecture seule, filtrée par le RLS du tenant.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RequesterResolution } from "@/features/contacts/rapprochement";
import { countByProcedure, startOfMonthIso } from "./procedureSearch";
import type { NearbyBasis, NearbyCandidate } from "./proches";

export function useProcedureMonthlyCounts(orgId: string) {
  return useQuery({
    queryKey: ["procedure-monthly-counts", orgId],
    enabled: Boolean(orgId),
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("requests")
        .select("socle_procedure_id")
        .eq("organization_id", orgId)
        .gte("created_at", startOfMonthIso(new Date()))
        .limit(2000);
      if (error) throw error;
      return countByProcedure(data ?? []);
    },
  });
}

export type NearbyBasisQuery =
  | { kind: "contact"; contactId: string }
  | { kind: "nom_declare"; field: "nom_naissance" | "raison_sociale"; name: string };

/**
 * Critère de détection : l'usager Socle rapproché (fiable) ou, à défaut, le
 * nom déclaré (indicatif seulement — jamais un doublon probable).
 */
export function nearbyBasisFromResolution(resolution: RequesterResolution | null): NearbyBasisQuery | null {
  if (!resolution) return null;
  if (resolution.kind === "contact") return { kind: "contact", contactId: resolution.contact.id };
  if (resolution.kind === "sans_rapprochement") {
    const d = resolution.declared;
    if (resolution.audience === "citoyen" && d.nom_naissance?.trim()) {
      return { kind: "nom_declare", field: "nom_naissance", name: d.nom_naissance.trim() };
    }
    if (resolution.audience !== "citoyen" && d.raison_sociale?.trim()) {
      return { kind: "nom_declare", field: "raison_sociale", name: d.raison_sociale.trim() };
    }
  }
  return null;
}

export function nearbyBasisKind(basis: NearbyBasisQuery | null): NearbyBasis | null {
  return basis ? basis.kind : null;
}

const NEARBY_SELECT =
  "id, reference, subject, status, created_at, socle_procedure_id, socle_procedure_label";

export function useNearbyRequests(orgId: string, basis: NearbyBasisQuery | null) {
  return useQuery({
    queryKey: ["nearby-requests", orgId, basis],
    enabled: Boolean(orgId && basis),
    queryFn: async (): Promise<NearbyCandidate[]> => {
      if (!basis) return [];
      const base = supabase
        .from("requests")
        .select(NEARBY_SELECT)
        .eq("organization_id", orgId);
      const filtered = basis.kind === "contact"
        ? base.eq("socle_contact_id", basis.contactId)
        // Égalité insensible à la casse sur l'identité déclarée figée au dépôt
        // (jokers retirés : on ne veut pas de recherche floue ici).
        : base.ilike(`requester_snapshot->declared->>${basis.field}`, basis.name.replace(/[%_]/g, ""));
      const { data, error } = await filtered
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as NearbyCandidate[];
    },
  });
}
