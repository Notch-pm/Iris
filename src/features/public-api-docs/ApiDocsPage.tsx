import * as React from "react";
import { readSupabaseConfig } from "@/lib/supabaseConfig";
import { openApiSpecUrl, tokenToCssColor } from "./redocTheme";

/**
 * Documentation **lisible par un humain** du contrat d'ingestion (rendu Redoc,
 * façon Swagger), montée comme celle du Socle (`/api-doc`).
 *
 * Elle est servie par l'APPLICATION et non par l'edge function : la passerelle
 * Supabase force les réponses HTML des functions en `text/plain` + CSP
 * `sandbox` (anti-hameçonnage sur `*.supabase.co`), ce qui interdit un rendu
 * HTML depuis la function. Redoc est donc chargé ici et pointé sur
 * `/v1/openapi.json`, servi en JSON par `requests-api`.
 *
 * Route **publique** : un intégrateur (Clara, portail citoyen, partenaire)
 * doit pouvoir lire le contrat sans compte Iris. Le contrat est public — la
 * clé d'intégration, jamais.
 */

const REDOC_SRC = "https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js";

declare global {
  interface Window {
    Redoc?: { init: (spec: string, options: unknown, element: HTMLElement) => void };
  }
}

export function ApiDocsPage() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);
  const specUrl = openApiSpecUrl(readSupabaseConfig(import.meta.env).url);

  React.useEffect(() => {
    document.title = "Iris — API d'ingestion des demandes";
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const render = () => {
      if (cancelled || !containerRef.current || !window.Redoc) return;
      const styles = getComputedStyle(document.documentElement);
      const fontFamily = styles.getPropertyValue("--font-sans").trim() || undefined;
      window.Redoc.init(
        specUrl,
        {
          hideDownloadButton: false,
          expandResponses: "200",
          theme: {
            colors: { primary: { main: tokenToCssColor(styles.getPropertyValue("--primary")) } },
            typography: { fontFamily, headings: { fontFamily } },
          },
        },
        containerRef.current,
      );
    };
    const onError = () => {
      if (!cancelled) setFailed(true);
    };

    if (window.Redoc) {
      render();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${REDOC_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", render);
      existing.addEventListener("error", onError);
      return () => {
        cancelled = true;
        existing.removeEventListener("load", render);
        existing.removeEventListener("error", onError);
      };
    }

    const script = document.createElement("script");
    script.src = REDOC_SRC;
    script.async = true;
    script.addEventListener("load", render);
    script.addEventListener("error", onError);
    document.body.appendChild(script);
    return () => {
      cancelled = true;
      script.removeEventListener("load", render);
      script.removeEventListener("error", onError);
    };
  }, [specUrl]);

  // Repli honnête : le rendu dépend d'un script externe. Si le réseau le
  // bloque, le contrat reste consultable — c'est lui qui fait foi.
  if (failed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-semibold">Le rendu de la documentation n'a pas pu se charger.</p>
        <p className="text-sm text-muted-foreground">
          Le contrat OpenAPI reste consultable directement — c'est lui qui fait foi.
        </p>
        <a href={specUrl} className="text-sm text-primary hover:underline">
          Ouvrir le contrat OpenAPI (JSON)
        </a>
      </div>
    );
  }

  return <div ref={containerRef} className="min-h-screen" />;
}
