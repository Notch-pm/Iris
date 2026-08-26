// Accès aux modèles d'e-mail — un hook par usage, `queryKey` explicite,
// invalidation dans `onSuccess` (convention du projet).
//
// L'écriture passe par des policies, pas par une RPC : les messages d'erreur
// remontés ici sont donc ceux de PostgreSQL. Deux d'entre eux méritent d'être
// traduits en français avant l'écran — la violation d'unicité et le conflit de
// version — parce que le texte brut de Postgres ne veut rien dire pour un
// administrateur. Tous les autres (garde de variables, RLS) sont déjà
// explicites : on les laisse passer tels quels, comme partout dans le projet.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Tables } from "@/types/database.types";
import type { OrgRow, TemplateDraft } from "./templates";

export type EmailTemplate = Tables<"email_templates">;

const TEMPLATES_KEY = "email-templates";
const LINKS_KEY = "email-template-organizations";
const ADMIN_ORGS_KEY = "administrable-organizations";

export function useEmailTemplates(orgId: string) {
  return useQuery({
    queryKey: [TEMPLATES_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<EmailTemplate[]> => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Les modèles ACTIVÉS pour l'organisation porteuse d'une demande — ceux que
 * l'agent peut proposer depuis sa fiche.
 *
 * `socle_scope_org_id` (NOT NULL, calculée par trigger) et non
 * `socle_organization_id` (nullable) : la garde
 * `t01_email_template_organizations_scope` impose que tout rattachement pointe
 * une organisation du miroir du tenant, donc les deux ne divergent que dans le
 * cas « destinataire inconnu », où aucun rattachement ne pourrait de toute
 * façon correspondre.
 *
 * ⚠️ Égalité STRICTE, aucune remontée d'ascendance : « pas de descendance
 * implicite » est la règle de l'activation — ouvrir un modèle sur la racine ne
 * l'ouvre pas sur les services. Une liste vide est donc un résultat normal (un
 * modèle neuf n'est activé nulle part) : l'agent rédige alors à la main.
 */
export function useActiveEmailTemplates(orgId: string, socleOrgId: string | null | undefined) {
  return useQuery({
    queryKey: [TEMPLATES_KEY, orgId, "actifs", socleOrgId],
    enabled: Boolean(orgId && socleOrgId),
    queryFn: async (): Promise<EmailTemplate[]> => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*, email_template_organizations!inner(socle_org_id)")
        .eq("organization_id", orgId)
        .eq("email_template_organizations.socle_org_id", socleOrgId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as EmailTemplate[];
    },
  });
}

function useInvalidateTemplates(orgId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [TEMPLATES_KEY, orgId] });
    void queryClient.invalidateQueries({ queryKey: [LINKS_KEY, orgId] });
  };
}

/** Le nom est unique par tenant (index `email_templates_name_idx`). */
const DUPLICATE_NAME = "Un modèle porte déjà ce nom dans cette collectivité.";
/** Le verrou optimiste ne lève pas d'exception : il n'affecte aucune ligne. */
const STALE_VERSION =
  "Ce modèle a été modifié entre-temps par quelqu'un d'autre ; rechargez avant de réessayer.";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

/**
 * PostgREST renvoie un OBJET, pas une `Error` — sans cette enveloppe,
 * `err instanceof Error` est faux côté écran et le message du serveur (garde de
 * variables, refus RLS), pourtant déjà en français, est remplacé par un
 * « Enregistrement impossible » qui n'apprend rien. Même rôle que `rpcError()`
 * dans `usePermissions.ts`.
 */
function asError(error: { message?: string; details?: string } | null): Error {
  const message = error?.message?.trim();
  const details = error?.details?.trim();
  return new Error(message || details || "Enregistrement impossible.");
}

export interface SaveTemplateInput {
  draft: TemplateDraft;
  /** Absent = création. */
  id?: string;
  /** Version lue à l'ouverture du dialogue — le verrou optimiste. */
  expectedVersion?: number;
}

export function useSaveEmailTemplate(orgId: string) {
  const invalidate = useInvalidateTemplates(orgId);
  const { session } = useAuth();

  return useMutation({
    mutationFn: async ({ draft, id, expectedVersion }: SaveTemplateInput) => {
      const userId = session?.user.id ?? null;
      const fields = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        subject: draft.subject.trim(),
        body: draft.body.trim(),
      };

      if (!id) {
        // `.select()` : l'identifiant du modèle créé est nécessaire pour
        // enchaîner sur la modale d'activation par organisation.
        const { data, error } = await supabase
          .from("email_templates")
          .insert({
            ...fields,
            organization_id: orgId,
            created_by: userId,
            updated_by: userId,
          } as never)
          .select("id");
        if (isUniqueViolation(error)) throw new Error(DUPLICATE_NAME);
        if (error) throw asError(error);
        return data?.[0]?.id ?? null;
      }

      // Verrou optimiste sans RPC : la version attendue fait partie du filtre.
      // Zéro ligne affectée = quelqu'un est passé avant nous.
      const { data, error } = await supabase
        .from("email_templates")
        .update({
          ...fields,
          version: (expectedVersion ?? 0) + 1,
          updated_by: userId,
        } as never)
        .eq("id", id)
        .eq("version", expectedVersion ?? -1)
        .select("id");
      if (isUniqueViolation(error)) throw new Error(DUPLICATE_NAME);
      if (error) throw asError(error);
      if (!data || data.length === 0) throw new Error(STALE_VERSION);
      return id;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteEmailTemplate(orgId: string) {
  const invalidate = useInvalidateTemplates(orgId);
  return useMutation({
    mutationFn: async (id: string) => {
      // `.select()` pour distinguer « supprimé » de « refusé par le RLS » :
      // sans lui, une suppression interdite renvoie un succès silencieux.
      const { data, error } = await supabase
        .from("email_templates")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw asError(error);
      if (!data || data.length === 0) {
        throw new Error("Suppression refusée : ce modèle ne vous est pas accessible.");
      }
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Activation organisation par organisation
// ---------------------------------------------------------------------------

/** Organisations Socle que l'utilisateur COURANT administre, à plat. */
export function useAdministrableOrganizations(orgId: string) {
  return useQuery({
    queryKey: [ADMIN_ORGS_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<OrgRow[]> => {
      const { data, error } = await supabase.rpc("administrable_organizations", {
        p_org_id: orgId,
      });
      if (error) throw asError(error);
      return (data ?? []).map((r) => ({
        socle_org_id: r.socle_org_id,
        socle_parent_id: r.socle_parent_id,
        name: r.name,
        obsolete: r.obsolete,
      }));
    },
  });
}

export interface TemplateLink {
  template_id: string;
  socle_org_id: string;
}

/**
 * TOUS les rattachements du tenant, en une requête. Les deux écrans en ont
 * besoin sous des angles opposés — « quelles organisations pour ce modèle ? »
 * et « quels modèles pour cette organisation ? » — et le volume est celui d'un
 * paramétrage : quelques dizaines de lignes. Une requête par modèle serait du
 * gaspillage.
 */
export function useTemplateLinks(orgId: string) {
  return useQuery({
    queryKey: [LINKS_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<TemplateLink[]> => {
      const { data, error } = await supabase
        .from("email_template_organizations")
        .select("template_id, socle_org_id");
      if (error) throw asError(error);
      return data ?? [];
    },
  });
}

export interface ToggleLinkInput {
  templateId: string;
  socleOrgId: string;
  /** true = activer, false = désactiver. */
  active: boolean;
}

/**
 * Activer / désactiver un modèle sur une organisation. Il n'y a rien à
 * modifier dans cette table : on insère ou on supprime.
 */
export function useToggleTemplateOrganization(orgId: string) {
  const invalidate = useInvalidateTemplates(orgId);
  const { session } = useAuth();

  return useMutation({
    mutationFn: async ({ templateId, socleOrgId, active }: ToggleLinkInput) => {
      if (active) {
        const { error } = await supabase.from("email_template_organizations").insert({
          template_id: templateId,
          socle_org_id: socleOrgId,
          created_by: session?.user.id ?? null,
        } as never);
        // Déjà activé : deux administrateurs ont cliqué en même temps, le
        // résultat voulu est atteint — ce n'est pas une erreur à montrer.
        if (error && error.code !== "23505") throw asError(error);
        return;
      }

      const { data, error } = await supabase
        .from("email_template_organizations")
        .delete()
        .eq("template_id", templateId)
        .eq("socle_org_id", socleOrgId)
        .select("template_id");
      if (error) throw asError(error);
      if (!data || data.length === 0) {
        throw new Error(
          "Désactivation refusée : vous n'administrez pas cette organisation.",
        );
      }
    },
    onSuccess: invalidate,
  });
}
