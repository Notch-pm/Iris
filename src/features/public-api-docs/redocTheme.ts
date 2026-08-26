// Petits utilitaires purs de la page de documentation (testés) : URL du contrat
// et traduction des tokens du design system vers ce que Redoc sait lire.

/** Vert primaire du DS, repli si le token n'est pas lisible (test, SSR). */
const DS_PRIMARY = "153 90% 32%";

/**
 * URL publique du contrat OpenAPI, servi en JSON par l'edge function
 * `requests-api` (le rendu HTML, lui, ne peut pas venir de la function :
 * la passerelle Supabase force `text/plain` + CSP `sandbox`).
 */
export function openApiSpecUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/requests-api/v1/openapi.json`;
}

/**
 * Token DS (`--primary` = « 153 90% 32% ») → couleur CSS utilisable par Redoc.
 * Redoc dérive ses nuances avec polished, qui ne connaît que la syntaxe à
 * virgules : on rétablit les virgules plutôt que de recopier une couleur en dur.
 */
export function tokenToCssColor(token: string | null | undefined): string {
  const parts = (token ?? "").trim().split(/\s+/).filter(Boolean);
  const [h, s, l] = parts.length >= 3 ? parts : DS_PRIMARY.split(" ");
  return `hsl(${h}, ${s}, ${l})`;
}
