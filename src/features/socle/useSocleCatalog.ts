// Catalogues Socle synchronisés (miroir d'organisations + cache de démarches).
// Tant que la sync n'a pas tourné, les listes sont vides et l'UI replie sur
// les facettes observées (features/requests/facets.ts).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FacetOption } from "@/features/requests/facets";
import { isoDay, isPublishedOn, type ProcedurePublication } from "@fn/_shared/procedures/publication";

export function useSocleOrganizationsCatalog(orgId: string) {
  return useQuery({
    queryKey: ["socle-organizations", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<FacetOption[]> => {
      const { data, error } = await supabase
        .from("socle_organizations")
        .select("socle_id, name")
        .eq("organization_id", orgId)
        .is("obsoleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => ({ value: r.socle_id, label: r.name }));
    },
  });
}

export interface SocleProcedureRow {
  socle_id: string;
  name: string;
  category_name: string | null;
  type: string | null;
  /** Publication effective miroitée du Socle (portail, période). */
  publication: ProcedurePublication;
}

/**
 * Démarches PROPOSABLES du cache — celles que le sélecteur de création offre.
 *
 * Deux exclusions, faites en SQL parce qu'elles bornent le périmètre offert et
 * non l'affichage :
 *  · `status = 'production'` — un brouillon est un paramétrage en cours
 *    d'écriture, que le Socle ne propose nulle part. Règle de fond, doublée
 *    d'une garde serveur dans `create-request-from-procedure`.
 *  · `type = 'externe'` — décision PO du 2026-08-30 : les démarches internes
 *    seront proposées plus tard. Restriction TEMPORAIRE d'affichage ; le cache,
 *    lui, les garde (elles portent des droits et nomment des demandes déjà
 *    déposées), et les filtres de la liste des demandes continuent de les voir.
 *
 * …et une troisième, en JS et non en SQL : la **période de publication**
 * (décision PO du 2026-08-30). Deux bornes nullables et INCLUSES, comparées au
 * jour d'aujourd'hui : la règle a assez de subtilité pour mériter un seul
 * domicile, testé — `isPublishedOn`, partagé avec `socle-proxy`. La récrire en
 * SQL en ferait une seconde vérité pour économiser une poignée de lignes.
 *
 * `status` vaut `brouillon` par défaut en base : une démarche n'apparaît
 * qu'après une synchronisation qui l'a déclarée en production (*fail closed*).
 */
export function useSocleProcedureRows(orgId: string) {
  // Le jour d'aujourd'hui dans le calendrier de L'AGENT. Il entre dans la clé
  // de requête (motif `closedSince` du tableau) : stable toute la journée, il
  // fait repartir la lecture au changement de date sur un onglet resté ouvert.
  const today = isoDay(new Date());
  return useQuery({
    queryKey: ["socle-procedure-rows", orgId, today],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<SocleProcedureRow[]> => {
      const { data, error } = await supabase
        .from("socle_procedure_cache")
        .select("socle_id, name, category_name, type, portal_visible, publication_start, publication_end")
        .eq("organization_id", orgId)
        .is("obsoleted_at", null)
        .eq("status", "production")
        .eq("type", "externe")
        .order("name");
      if (error) throw error;
      return (data ?? [])
        .map((r) => ({
          socle_id: r.socle_id,
          name: r.name,
          category_name: r.category_name,
          type: r.type,
          // Le cache porte déjà la publication EFFECTIVE : les défauts du contrat
          // Socle et le commutateur de période ont été appliqués à la frontière
          // par la synchro (`_shared/procedures/publication.ts`).
          publication: {
            portalVisible: r.portal_visible,
            publicationStart: r.publication_start,
            publicationEnd: r.publication_end,
          },
        }))
        .filter((row) => isPublishedOn(row.publication, today));
    },
  });
}

export function useSocleProceduresCatalog(orgId: string) {
  return useQuery({
    queryKey: ["socle-procedures", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<FacetOption[]> => {
      const { data, error } = await supabase
        .from("socle_procedure_cache")
        .select("socle_id, name, category_name")
        .eq("organization_id", orgId)
        .is("obsoleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        value: r.socle_id,
        label: r.category_name ? `${r.name} (${r.category_name})` : r.name,
      }));
    },
  });
}

export interface ProcedureSnapshot {
  id: string;
  name: string;
  organization_id?: string | null;
  type: string | null;
  category_id: string | null;
  form_schema: unknown;
  requester_config: unknown;
  /**
   * Base de connaissances — la PART AGENT, whitelistée par le proxy
   * (`socle-proxy/_shared/knowledge.ts`). Elle voyage avec la démarche pour
   * que le rail du parcours de création n'ait pas à la redemander, mais elle
   * n'entre JAMAIS dans le `procedure_snapshot` figé sur la demande : le
   * serveur reconstruit ce snapshot et l'exclut (`snapshots.ts`).
   */
  knowledge_base?: unknown;
}

/**
 * Snapshot de la démarche au moment T, construit côté serveur via socle-proxy.
 * Un échec (null) bloque la création : aucune demande sans démarche — le
 * builder affiche alors un message explicite d'indisponibilité du Socle.
 */
export async function fetchProcedureSnapshot(
  organizationId: string,
  socleProcedureId: string,
): Promise<ProcedureSnapshot | null> {
  try {
    const { data, error } = await supabase.functions.invoke("socle-proxy/v1/procedures/get", {
      body: { organization_id: organizationId, socle_procedure_id: socleProcedureId },
    });
    if (error || !data?.procedure) return null;
    return data.procedure as ProcedureSnapshot;
  } catch {
    return null;
  }
}
