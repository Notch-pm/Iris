/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
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
    // `src/**` + la logique pure des futures edge functions (co-localisée dans `_shared`,
    // sans dépendance Deno) — motif Socle.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.ts",
    ],
  },
});
