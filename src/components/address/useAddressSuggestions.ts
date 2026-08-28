// Propositions d'adresse pendant la frappe, et géocodage inverse pour
// « Utiliser ma position ». Le service et sa configuration sont ceux de
// `src/lib/carto.ts` ; toute la logique d'URL et de lecture vit dans
// `src/lib/adresse.ts` (pure, testée). Ici : le rythme et le cache.
//
// L'assistance est un CONFORT : toute panne se traduit par une absence de
// propositions, jamais par une saisie bloquée.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addressSearchUrl, parseAddressSuggestions, reverseAddressUrl, SEARCH_DEBOUNCE_MS,
  type AddressSuggestion,
} from "@/lib/adresse";

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Valeur retardée d'un délai. Le cache de TanStack Query dédoublonne déjà les
 * préfixes déjà tapés ; ce délai-ci évite d'ÉMETTRE la requête intermédiaire —
 * ce que le cache ne peut pas faire, et dont dépend le quota partagé de la
 * collectivité (une seule IP publique pour tous les agents).
 */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface AddressSuggestionsResult {
  suggestions: AddressSuggestion[];
  /** Une requête est en vol pour une saisie qui n'a pas encore de réponse. */
  isLoading: boolean;
  /** Le service n'a pas répondu — à dire discrètement, jamais à bloquer. */
  isError: boolean;
  /** La frappe est en avance sur les propositions affichées. */
  isStale: boolean;
}

export function useAddressSuggestions(query: string, enabled = true): AddressSuggestionsResult {
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  // Clé dérivée de la SAISIE, jamais d'un cache que la requête remplirait
  // elle-même (piège vécu le 2026-08-23 sur le géocodage en masse).
  const url = enabled ? addressSearchUrl(debounced) : null;

  const result = useQuery({
    queryKey: ["address-suggestions", url],
    enabled: url !== null,
    staleTime: FIVE_MINUTES,
    gcTime: FIVE_MINUTES,
    // Pendant la frappe, un échec se remplace tout seul au caractère suivant :
    // réessayer ajouterait des appels là où le quota est déjà le sujet.
    retry: false,
    queryFn: async ({ signal }): Promise<AddressSuggestion[]> => {
      const response = await fetch(url!, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseAddressSuggestions(await response.json());
    },
  });

  return {
    suggestions: result.data ?? [],
    isLoading: result.isFetching,
    isError: result.isError,
    isStale: debounced !== query,
  };
}

/** Le géocodage inverse est-il disponible sur le service configuré ? */
export function reverseGeocodingAvailable(): boolean {
  return reverseAddressUrl(0, 0) !== null;
}

/**
 * Adresse la plus proche d'un point. Utilisé une fois, sur clic — pas de hook
 * de requête : il n'y a rien à mettre en cache, la position change à chaque appel.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<AddressSuggestion | null> {
  const url = reverseAddressUrl(lat, lon);
  if (!url) return null;
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseAddressSuggestions(await response.json())[0] ?? null;
}

export interface BrowserPosition {
  lat: number;
  lon: number;
}

/**
 * Position du navigateur, en promesse. Refus de permission, service absent ou
 * délai dépassé rendent `null` : l'appelant retire le bouton, il n'affiche pas
 * d'erreur — l'agent n'a rien fait de mal.
 */
export function browserPosition(timeoutMs = 10_000): Promise<BrowserPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
