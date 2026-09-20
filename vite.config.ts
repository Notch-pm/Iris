/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Logique pure partagée avec les edge functions (contrat de rendu/validation).
      "@fn": path.resolve(import.meta.dirname, "./supabase/functions"),
    },
  },
  server: {
    port: 5174,
  },
  test: {
    // Logique pure pour l'instant → environnement Node (rapide, pas de DOM).
    // Passer à "jsdom" (+ @testing-library/react) quand on ajoutera des tests de composants.
    environment: "node",
    globals: true,
    // Valeurs factices : `src/lib/supabase.ts` lève au chargement sans elles, et
    // la CI n'a pas de `.env.local` — un test dont l'import transitif atteint le
    // client passait donc en local et tombait en CI (2026-08-31, puis 2026-09-20).
    // Aucun test n'atteint le réseau.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
    // `src/**` + la logique pure des futures edge functions (co-localisée dans `_shared`,
    // sans dépendance Deno) — motif Socle.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.ts",
    ],
  },
});
