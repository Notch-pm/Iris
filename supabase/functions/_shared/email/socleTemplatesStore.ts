// Lecture des courriels système du Socle dans le miroir `socle_email_templates`
// (client SERVICE). Jamais bloquante : une lecture qui échoue rend une carte
// vide, et l'appelant retombe sur les textes d'origine d'Iris — un courriel
// d'usager ne s'annule pas parce qu'un miroir tousse.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { systemTemplatesFromRows, type SystemTemplateRow, type SystemTemplates } from "./socleTemplates.ts";

const EMPTY: SystemTemplates = new Map();

/** Une lecture par tenant et par exécution : `cache` est partagé par l'appelant. */
export async function loadSystemTemplates(
  supabase: SupabaseClient,
  organizationId: string | null | undefined,
  log: string,
  cache?: Map<string, SystemTemplates>,
): Promise<SystemTemplates> {
  if (!organizationId) return EMPTY;
  const cached = cache?.get(organizationId);
  if (cached) return cached;
  let rows: SystemTemplateRow[];
  try {
    const { data, error } = await supabase
      .from("socle_email_templates")
      .select("system_key, subject, body, is_customized")
      .eq("organization_id", organizationId)
      .not("system_key", "is", null);
    if (error) throw error;
    rows = (data ?? []) as SystemTemplateRow[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err);
    console.error(`${log} modèles du Socle illisibles (${organizationId}) : ${message} — textes d'origine`);
    return EMPTY;
  }
  const templates = systemTemplatesFromRows(rows);
  cache?.set(organizationId, templates);
  return templates;
}
