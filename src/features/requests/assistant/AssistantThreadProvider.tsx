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
//
// SOURCES AUTORISÉES (2026-09-19) : quand l'assistant propose de consulter
// des sources déclarées pour l'IA, l'agent approuve ou refuse sur la carte.
// L'accord vaut pour la SUITE de la conversation — `consulted`, renvoyé à
// chaque question sous forme d'identifiants — jusqu'à « Ne plus consulter »,
// « Effacer » ou un changement de cible. Le texte lu ne transite jamais par
// le navigateur : le serveur le relit à chaque tour.

import * as React from "react";
import type { SourceRef } from "@fn/_shared/ai/sources/catalogue";
import {
  appendAssistant,
  appendError,
  appendProposal,
  appendUser,
  approvalText,
  canSend,
  emptyThread,
  expireOpenProposals,
  mergeConsulted,
  openProposal,
  resolveProposal,
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
  /** Les sources que l'agent a autorisées pour la suite de la conversation. */
  consulted: SourceRef[];
  /** Approuver une proposition : les sources sont lues, la question reposée. */
  approve: (proposalId: number) => void;
  /** Refuser une proposition : rien ne part. */
  decline: (proposalId: number) => void;
  /** Retirer l'accord : les questions suivantes ne consultent plus rien. */
  stopConsulting: () => void;
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
  const [consulted, setConsulted] = React.useState<SourceRef[]>([]);
  const assistant = useAssistant();

  // Changer de demande (ou de démarche au guichet) ouvre un fil neuf : le
  // contexte serveur n'est plus le même, l'historique n'a plus de sens — et
  // les sources autorisées étaient celles d'une autre démarche.
  const key = targetKey(target);
  const previousKey = React.useRef(key);
  React.useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    setThread(emptyThread());
    setDraft("");
    setLastContext(null);
    setConsulted([]);
  }, [key]);

  const ask = React.useCallback((question: string, sources: SourceRef[]) => {
    if (!target || question === "" || assistant.isPending) return;

    // L'historique envoyé est calculé AVANT d'empiler la question : `trimForSend`
    // l'ajoute lui-même, et il écarte au passage les tours en erreur et les
    // cartes de proposition.
    const messages = trimForSend(thread, question);
    setThread((t) => appendUser(expireOpenProposals(t), question));

    assistant.mutate(
      { target, messages, sources },
      {
        onSuccess: (reply) => {
          setThread((t) => appendProposal(appendAssistant(t, reply.answer), reply.proposal?.sources ?? []));
          setLastContext(reply.context);
        },
        onError: (error) => {
          // Le message français vient du serveur (enveloppe { error }) — il
          // nomme la date de renouvellement quand c'est le plafond.
          const message = error instanceof Error ? error.message : "L'assistant n'a pas pu répondre.";
          // Un échec survenu PENDANT une consultation retire l'accord : une
          // source que le serveur ne reconnaît plus (catalogue modifié dans le
          // référentiel) ou qu'il ne sait pas lire ferait sinon échouer TOUTES
          // les questions suivantes, puisqu'elle est relue à chaque tour.
          if (sources.length > 0) {
            setConsulted([]);
            setThread((t) => appendError(
              t,
              `${message} Les sources autorisées ne sont plus consultées : l'assistant pourra vous les reproposer.`,
            ));
            return;
          }
          setThread((t) => appendError(t, message));
        },
      },
    );
  }, [assistant, target, thread]);

  const send = React.useCallback((text?: string) => {
    const question = (text ?? draft).trim();
    if (!target || question === "" || assistant.isPending) return;
    setDraft("");
    ask(question, consulted);
  }, [ask, assistant.isPending, consulted, draft, target]);

  const approve = React.useCallback((proposalId: number) => {
    const proposal = openProposal(thread, proposalId);
    if (!target || !proposal || assistant.isPending) return;
    const next = mergeConsulted(consulted, proposal.sources);
    setThread((t) => resolveProposal(t, proposalId, "accepted"));
    setConsulted(next);
    // Le brouillon en cours n'est pas touché : l'agent écrivait peut-être la
    // question suivante.
    ask(approvalText(proposal.sources), next);
  }, [ask, assistant.isPending, consulted, target, thread]);

  const decline = React.useCallback((proposalId: number) => {
    setThread((t) => resolveProposal(t, proposalId, "declined"));
  }, []);

  const value: AssistantThreadValue = {
    thread,
    draft,
    setDraft,
    send,
    reset: () => {
      setThread(emptyThread());
      setDraft("");
      setLastContext(null);
      setConsulted([]);
    },
    pending: assistant.isPending,
    canSend: Boolean(target) && canSend(draft, assistant.isPending),
    lastContext,
    disabled: !target,
    consulted,
    approve,
    decline,
    stopConsulting: () => setConsulted([]),
  };

  return (
    <AssistantThreadContext.Provider value={value}>{children}</AssistantThreadContext.Provider>
  );
}
