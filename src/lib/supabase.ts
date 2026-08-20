import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { readSupabaseConfig } from "@/lib/supabaseConfig";

// Échoue au démarrage si la configuration manque — voir readSupabaseConfig.
const { url, publishableKey } = readSupabaseConfig(import.meta.env);

export const supabase = createClient<Database>(url, publishableKey);
