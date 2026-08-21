// Brouillon local du parcours (localStorage, un par tenant et utilisateur) :
// enregistrement différé à chaque saisie, proposition de reprise au retour.
// Rien de sensible n'y transite (voir draft.ts) ; un poste partagé ne révèle
// au plus que des saisies en cours du même compte.

import * as React from "react";
import {
  DRAFT_VERSION,
  draftStorageKey,
  parseDraft,
  serializeDraft,
  type CreationDraft,
} from "./draft";

export type DraftBody = Omit<CreationDraft, "v" | "savedAt">;

const SAVE_DELAY_MS = 800;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useCreationDraft(orgId: string, userId: string) {
  const key = draftStorageKey(orgId, userId);
  const [existing, setExisting] = React.useState<CreationDraft | null>(() => parseDraft(readStorage(key)));
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    setExisting(parseDraft(readStorage(key)));
    setSavedAt(null);
  }, [key]);

  const saveNow = React.useCallback((body: DraftBody) => {
    window.clearTimeout(timer.current);
    const full: CreationDraft = { ...body, v: DRAFT_VERSION, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(key, serializeDraft(full));
      setSavedAt(full.savedAt);
    } catch {
      // Stockage indisponible (mode privé, quota) : la saisie continue sans brouillon.
    }
  }, [key]);

  const scheduleSave = React.useCallback((body: DraftBody) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => saveNow(body), SAVE_DELAY_MS);
  }, [saveNow]);

  const clear = React.useCallback(() => {
    window.clearTimeout(timer.current);
    try {
      localStorage.removeItem(key);
    } catch {
      // idem
    }
    setSavedAt(null);
    setExisting(null);
  }, [key]);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const dismissExisting = React.useCallback(() => setExisting(null), []);

  return { existing, dismissExisting, savedAt, scheduleSave, saveNow, clear };
}
