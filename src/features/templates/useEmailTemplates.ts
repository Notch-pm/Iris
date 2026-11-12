// Modèles d'e-mail — LECTURE SEULE du miroir des modèles du Socle
// (`socle_email_templates`, rafraîchi par `sync-socle-referentiel`).
//
// Depuis le 2026-11-12 (décision PO), les modèles se rédigent et s'activent
// dans le SOCLE (Référentiels › Modèles de courriels), organisme par organisme.
// Iris n'a plus d'écran de saisie : il propose aux agents, dans l'onglet
// Échanges, les modèles cochés pour Iris et activés sur l'organisation porteuse
// de la demande. Un hook par usage, `queryKey` explicite (convention du projet).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { OrgRow } from "./templates";

/** Un modèle proposé à l'agent. `id` = identifiant SOCLE (tracé dans l'échange). */
export interface ProposedEmailTemplate {
  id: string;
  name: string;
  description: string | null;
  subject: string;
  body: string;
}

/** Un modèle créé, avec les organisations Socle où il est proposé. */
export interface SocleCustomTemplate extends ProposedEmailTemplate {
  socleOrgIds: string[];
}

const TEMPLATES_KEY = "socle-email-templates";
const ADMIN_ORGS_KEY = "administrable-organizations";

async function readCustomTemplates(orgId: string): Promise<SocleCustomTemplate[]> {
  const { data, error } = await supabase
    .from("socle_email_templates")
    .select("socle_template_id, name, description, subject, body, socle_org_ids")
    .eq("organization_id", orgId)
    .is("system_key", null)
    .order("name");
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.socle_template_id !== null)
    .map((r) => ({
      id: r.socle_template_id as string,
      name: r.name,
      description: r.description,
      subject: r.subject,
      body: r.body,
      socleOrgIds: r.socle_org_ids ?? [],
    }));
}

/** Tous les modèles créés du tenant (vue d'ensemble des Paramètres). */
export function useSocleCustomTemplates(orgId: string) {
  return useQuery({
    queryKey: [TEMPLATES_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: () => readCustomTemplates(orgId),
  });
}

/**
 * Les modèles proposés pour l'organisation porteuse d'une demande — ceux que
 * l'agent peut choisir depuis sa fiche.
 *
 * ⚠️ Égalité STRICTE sur l'organisation, aucune remontée d'ascendance : « pas
 * de descendance implicite » est la règle d'activation du Socle — ouvrir un
 * modèle sur la racine ne l'ouvre pas sur les services. Une liste vide est un
 * résultat normal : l'agent rédige alors à la main.
 */
export function useActiveEmailTemplates(orgId: string, socleOrgId: string | null | undefined) {
  return useQuery({
    queryKey: [TEMPLATES_KEY, orgId, "proposes", socleOrgId],
    enabled: Boolean(orgId && socleOrgId),
    queryFn: async (): Promise<ProposedEmailTemplate[]> => {
      const all = await readCustomTemplates(orgId);
      return all.filter((t) => t.socleOrgIds.includes(socleOrgId as string));
    },
  });
}

/** Organisations Socle que l'utilisateur COURANT administre, à plat. */
export function useAdministrableOrganizations(orgId: string) {
  return useQuery({
    queryKey: [ADMIN_ORGS_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<OrgRow[]> => {
      const { data, error } = await supabase.rpc("administrable_organizations", {
        p_org_id: orgId,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        socle_org_id: r.socle_org_id,
        socle_parent_id: r.socle_parent_id,
        name: r.name,
        obsolete: r.obsolete,
      }));
    },
  });
}
