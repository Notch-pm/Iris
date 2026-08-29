// Le fil de conversation, hissé AU-DESSUS du rail.
//
// ⚠️ POURQUOI CE FOURNISSEUR EXISTE : `ProcedurePane` est monté
// CONDITIONNELLEMENT (`railTab === "procedure" ? <ProcedurePane…> : null`).
// Basculer sur « Demande » le démonte, et un état local au panneau
// disparaîtrait à chaque aller-retour — l'agent perdrait sa conversation en
// consultant l'avancement. Le fil vit donc dans la page.
//
// Il disparaît AU RECHARGEMENT, et c'est la décision, pas un défaut : rien
// n'est enregistré. Le panneau le dit une fois à l'agent.

import * as React from "react";
import {
  appendAssistant,
  appendError,
  appendUser,
  canSend,
  emptyThread,
  trimForSend,
  type Thread,
} from "./thread";
import {
  targetKey,
  useAssistant,
  type AssistantContextInfo,
  type AssistantTarget,
} from "./useAssistant";

interface AssistantThreadValue {
  thread: Thread;
  draft: string;
  setDraft: (value: string) => void;
  send: (text?: string) => void;
  reset: () => void;
  pending: boolean;
  canSend: boolean;
  /** Ce que le serveur a réellement lu au dernier tour. */
  lastContext: AssistantContextInfo | null;
  /** Vrai quand la cible n'est pas encore désignée (aucune démarche choisie). */
  disabled: boolean;
}

const AssistantThreadContext = React.createContext<AssistantThreadValue | null>(null);

export function useAssistantThread(): AssistantThreadValue {
  const value = React.useContext(AssistantThreadContext);
  if (!value) throw new Error("useAssistantThread hors de AssistantThreadProvider");
  return value;
}

export function AssistantThreadProvider(
  { target, children }: { target: AssistantTarget | null; children: React.ReactNode },
) {
  const [thread, setThread] = React.useState<Thread>(emptyThread);
  const [draft, setDraft] = React.useState("");
  const [lastContext, setLastContext] = React.useState<AssistantContextInfo | null>(null);
  const assistant = useAssistant();

  // Changer de demande (ou de démarche au guichet) ouvre un fil neuf : le
  // contexte serveur n'est plus le même, l'historique n'a plus de sens.
  const key = targetKey(target);
  const previousKey = React.useRef(key);
  React.useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    setThread(emptyThread());
    setDraft("");
    setLastContext(null);
  }, [key]);

  const send = React.useCallback((text?: string) => {
    const question = (text ?? draft).trim();
    if (!target || question === "" || assistant.isPending) return;

    // L'historique envoyé est calculé AVANT d'empiler la question : `trimForSend`
    // l'ajoute lui-même, et il écarte au passage les tours en erreur.
    const messages = trimForSend(thread, question);
    setThread((t) => appendUser(t, question));
    setDraft("");

    assistant.mutate(
      { target, messages },
      {
        onSuccess: (reply) => {
          setThread((t) => appendAssistant(t, reply.answer));
          setLastContext(reply.context);
        },
        onError: (error) => {
          // Le message français vient du serveur (enveloppe { error }) — il
          // nomme la date de renouvellement quand c'est le plafond.
          setThread((t) => appendError(
            t,
            error instanceof Error ? error.message : "L'assistant n'a pas pu répondre.",
          ));
        },
      },
    );
  }, [assistant, draft, target, thread]);

  const value: AssistantThreadValue = {
    thread,
    draft,
    setDraft,
    send,
    reset: () => { setThread(emptyThread()); setDraft(""); setLastContext(null); },
    pending: assistant.isPending,
    canSend: Boolean(target) && canSend(draft, assistant.isPending),
    lastContext,
    disabled: !target,
  };

  return (
    <AssistantThreadContext.Provider value={value}>{children}</AssistantThreadContext.Provider>
  );
}
