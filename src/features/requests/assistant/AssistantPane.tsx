// Le sous-onglet « Assistant » du panneau Procédure.
//
// Bulles rendues par `src/lib/markdown.ts` : **aucun HTML injecté**, la même
// garantie que la base de connaissances. Un modèle qui renverrait du HTML ne
// peut donc rien exécuter dans la page.
//
// L'erreur s'affiche DANS le fil, à sa place chronologique, mais elle n'y
// appartient pas : `trimForSend` ne la renvoie jamais au serveur.
//
// ⚠️ DEUX ZONES, ET UNE SEULE DÉFILE. Le fil prend la hauteur disponible et
// défile ; la zone de saisie est un SOCLE, hors du flux de défilement. C'est
// ce que fait toute messagerie, et pour la même raison : on écrit en regardant
// ce qu'on écrit, pas en cherchant où est passé le champ. Le socle porte donc
// `shrink-0` — sans lui, un fil long l'écraserait progressivement jusqu'à le
// faire disparaître.
//
// ⚠️ Cela n'a de sens que si le panneau reçoit une HAUTEUR. `min-h-0 flex-1`
// sur la racine le dit à son parent (`ProcedurePane`), qui le dit au sien.
// Rompre cette chaîne quelque part et tout redevient un long document : rien
// ne casse visiblement, le socle cesse simplement d'être un socle.

//
// LA CARTE DE PROPOSITION (2026-09-19) : quand la base ne suffit pas,
// l'assistant propose de consulter des sources que la collectivité a déclarées
// pour l'IA. La carte les nomme, dit ce que « Consulter » implique (lecture
// par Iris, envoi à l'assistant, consommation IA) et attend l'agent. Comme
// l'erreur, elle est DANS le fil sans en faire partie : `trimForSend` ne la
// renvoie jamais.

import * as React from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  FileText,
  Globe,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import type { SourceRef } from "@fn/_shared/ai/sources/catalogue";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { safeHref } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { useAssistantThread } from "./AssistantThreadProvider";
import { isFresh, readingAnchor, type ProposalStatus, type ThreadProposal } from "./thread";

/** Amorces affichées tant que rien n'a été demandé. */
const STARTERS = [
  "Quelles pièces dois-je exiger ?",
  "Quelles sont les conditions de clôture ?",
  "Y a-t-il un cas particulier à surveiller ?",
] as const;

function ContextChip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
      {label}
    </span>
  );
}

/** Le domaine d'une page, sans `www.` — ce que l'agent reconnaît d'un coup d'œil. */
function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SourceIcon({ source }: { source: SourceRef }) {
  const Icon = source.kind === "page" ? Globe : FileText;
  return <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

const CLOSED_PROPOSAL: Record<Exclude<ProposalStatus, "open">, string> = {
  accepted: "Consultation autorisée.",
  declined: "Proposition déclinée — rien n'a été lu.",
  expired: "Proposition non retenue : une autre question a suivi.",
};

function ProposalCard({
  proposal,
  pending,
  wide,
  onApprove,
  onDecline,
}: {
  proposal: ThreadProposal;
  pending: boolean;
  wide: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const open = proposal.status === "open";
  return (
    <div
      role="group"
      aria-label="Proposition de l'assistant : consulter des sources"
      className={cn(
        "rounded-[14px] border p-3",
        wide ? "max-w-[78%]" : "max-w-[92%]",
        open ? "border-primary/25 bg-primary/5" : "border-border bg-muted/40",
      )}
    >
      <p className={cn("flex items-start gap-2 font-semibold text-foreground", wide ? "text-[13px]" : "text-[11.5px]")}>
        <BookOpenCheck className="mt-px size-3.5 shrink-0 text-primary" aria-hidden="true" />
        Pour aller plus loin, je peux consulter :
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {proposal.sources.map((source) => (
          <li key={source.id} className="flex items-start gap-2">
            <SourceIcon source={source} />
            <span className="min-w-0">
              <span className={cn("block font-semibold leading-snug", wide ? "text-[13px]" : "text-[12px]")}>
                {source.label}
              </span>
              <span className="block text-[10.5px] leading-snug text-muted-foreground">
                {source.kind === "page" ? hostOf(source.url) : "Document de référence"}
                {source.origin === "collectivite" ? " · recommandée par la collectivité" : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {proposal.status === "open" ? (
        <>
          <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
            Leur contenu sera lu par Iris et transmis à l'assistant, pour cette question et les
            suivantes. Elle comptera dans la consommation IA de la collectivité.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" className="h-8 px-3 text-xs" onClick={onApprove} disabled={pending}>
              Consulter
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-3 text-xs" onClick={onDecline} disabled={pending}>
              Non merci
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-[10.5px] font-semibold text-muted-foreground">
          {CLOSED_PROPOSAL[proposal.status]}
        </p>
      )}
    </div>
  );
}

/** Une source consultée : un lien pour une page, un nom pour un document. */
function ConsultedName({ source }: { source: SourceRef }) {
  const href = source.url ? safeHref(source.url) : null;
  if (!href) return <span className="font-semibold">{source.label}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-semibold underline underline-offset-2 hover:text-foreground">
      {source.label}
    </a>
  );
}

interface Props {
  emptyHint: string;
  /** Amorces propres à l'écran hôte — par défaut, celles de l'instruction. */
  starters?: readonly string[];
  /**
   * Rendu LARGE (fiche démarche, fenêtre de 1 080 px) : corps de texte à 14 px
   * au lieu des 12,5 px du rail de 372 px. Le comportement ne change pas.
   */
  wide?: boolean;
}

export function AssistantPane({ emptyHint, starters = STARTERS, wide = false }: Props) {
  const {
    thread, draft, setDraft, send, reset, pending, canSend, lastContext, disabled,
    consulted, approve, decline, stopConsulting,
  } = useAssistantThread();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const anchorId = readingAnchor(thread);

  React.useEffect(() => {
    // Le défilement se règle sur le CONTENEUR du fil, jamais par
    // `scrollIntoView` : celui-ci ferait aussi sauter la fiche entière.
    const box = scrollRef.current;
    if (!box) return;
    if (pending || anchorId === null) {
      // Question envoyée, attente, erreur : on suit le bas du fil.
      box.scrollTop = box.scrollHeight;
      return;
    }
    // Réponse arrivée : on la lit depuis sa PREMIÈRE ligne (retour PO
    // 2026-09-19) — son début est calé en haut du fil, pas sa fin en bas. Une
    // carte de proposition qui la suit ne change rien : elle se lit après.
    const el = anchorRef.current;
    if (!el) return;
    box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top;
  }, [thread.messages.length, pending, anchorId]);

  // Un motif « non lue » peut arriver sans libellé (référentiel muet) : on
  // reprend alors celui que l'agent a approuvé.
  const labelOf = (id: string, label: string) =>
    label || consulted.find((s) => s.id === id)?.label || "source demandée";

  if (disabled) {
    return (
      <p className="rounded-xl border border-dashed border-border p-3.5 text-xs leading-relaxed text-muted-foreground">
        {emptyHint}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── La zone qui DÉFILE : amorces, fil, et ce que le serveur a lu ── */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {isFresh(thread) ? (
          <div className="flex flex-col gap-2.5">
            <p className={cn(
              "flex items-start gap-2 leading-relaxed text-muted-foreground",
              wide ? "text-[13px]" : "text-[11.5px]",
            )}>
              <Sparkles className="mt-px size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                Je réponds à partir de la base de connaissances de la démarche — et du dossier,
                quand il y en a un ouvert. Si elle ne suffit pas, je peux vous proposer de
                consulter les sources que la collectivité a déclarées : rien n'est lu sans votre
                accord. <strong className="font-semibold">L'identité de l'usager ne m'est pas
                transmise</strong>, et cette conversation n'est pas enregistrée : elle disparaît
                si vous rechargez la page.
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {starters.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => send(question)}
                  className={cn(
                    "rounded-full border border-border bg-card font-semibold transition-colors hover:border-primary hover:text-primary",
                    wide ? "h-[30px] px-3 text-xs" : "px-2.5 py-1 text-[11px]",
                  )}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5">
          {thread.messages.map((message) => {
            if (message.role === "proposal") {
              return message.proposal ? (
                <ProposalCard
                  key={message.id}
                  proposal={message.proposal}
                  pending={pending}
                  wide={wide}
                  onApprove={() => approve(message.id)}
                  onDecline={() => decline(message.id)}
                />
              ) : null;
            }
            if (message.role === "error") {
              return (
                <p
                  key={message.id}
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5 text-[11.5px] leading-relaxed text-destructive"
                >
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  <span>{message.content}</span>
                </p>
              );
            }
            const mine = message.role === "user";
            return (
              <div
                key={message.id}
                ref={message.id === anchorId ? anchorRef : undefined}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "rounded-xl",
                    wide ? "max-w-[78%] px-4 py-3" : "max-w-[88%] px-3 py-2",
                    mine
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-foreground",
                    wide && !mine && "shadow-airbnb-sm",
                  )}
                >
                  {mine ? (
                    <p className={cn("whitespace-pre-line leading-relaxed", wide ? "text-sm" : "text-[12.5px]")}>
                      {message.content}
                    </p>
                  ) : (
                    <Markdown source={message.content} className={wide ? "text-sm leading-relaxed" : undefined} />
                  )}
                </div>
              </div>
            );
          })}

          {pending ? (
            <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {consulted.length > 0
                ? "L'assistant lit les sources autorisées et rédige sa réponse…"
                : "L'assistant lit la démarche et rédige sa réponse…"}
            </p>
          ) : null}
        </div>

        {/* Ce que le serveur a RÉELLEMENT lu — l'agent ne devine pas.
            Reste DANS le fil : cela décrit la dernière réponse, et sa hauteur
            varie (documents écartés). L'épingler mangerait le fil. */}
        {lastContext ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
            <ContextChip
              label={lastContext.knowledge
                ? "base de connaissances lue"
                : lastContext.knowledgeUnavailable
                  ? "référentiel indisponible"
                  : "démarche non documentée"}
            />
            {lastContext.agentGuidance ? (
              <ContextChip label="recommandations générales" />
            ) : null}
            {lastContext.userCommunication ? (
              <ContextChip label="communication usager" />
            ) : null}
            {lastContext.answers > 0 ? (
              <ContextChip label={`${lastContext.answers} réponse${lastContext.answers > 1 ? "s" : ""} du dossier`} />
            ) : null}
            {lastContext.documents.used.length > 0 ? (
              <ContextChip label={`${lastContext.documents.used.length} document${lastContext.documents.used.length > 1 ? "s" : ""}`} />
            ) : null}
            {lastContext.removedIdentityKeys.length > 0 ? (
              <ContextChip label="identité retirée" />
            ) : null}
            {lastContext.sources && lastContext.sources.consulted.length > 0 ? (
              <ContextChip
                label={`${lastContext.sources.consulted.length} source${lastContext.sources.consulted.length > 1 ? "s" : ""} consultée${lastContext.sources.consulted.length > 1 ? "s" : ""}`}
              />
            ) : null}
            {lastContext.sources && lastContext.sources.consulted.length > 0 ? (
              <span className="w-full text-[10.5px] leading-relaxed text-muted-foreground">
                Sources consultées :{" "}
                {lastContext.sources.consulted.map((s, i) => (
                  <React.Fragment key={s.id}>
                    {i > 0 ? ", " : null}
                    <ConsultedName source={s} />
                  </React.Fragment>
                ))}
                .
              </span>
            ) : null}
            {lastContext.sources && lastContext.sources.skipped.length > 0 ? (
              <span className="w-full text-[10.5px] leading-relaxed text-muted-foreground">
                Non lues :{" "}
                {lastContext.sources.skipped.map((s) => `${labelOf(s.id, s.label)} (${s.reason})`).join(", ")}.
              </span>
            ) : null}
            {lastContext.documents.skipped.length > 0 ? (
              <span className="w-full text-[10.5px] leading-relaxed text-muted-foreground">
                Non pris en compte, faute de place :{" "}
                {lastContext.documents.skipped.map((d) => d.name).join(", ")}.
              </span>
            ) : lastContext.truncated ? (
              <span className="w-full text-[10.5px] leading-relaxed text-muted-foreground">
                Le référentiel a été tronqué : la réponse ne s'appuie pas sur son intégralité.
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Le repère d'auto-défilement se pose APRÈS les pastilles : elles sont
            le dernier élément du fil, et s'arrêter avant reviendrait à les
            cacher au moment précis où elles renseignent. */}
      </div>

      {/* ── Le SOCLE : insensible au défilement du fil ── */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
        {/* L'accord en cours : il vaut pour chaque question qui suit, donc il se
            lit là où l'on écrit — et se retire d'un geste. */}
        {consulted.length > 0 ? (
          <div className="flex items-start justify-between gap-2 rounded-[10px] bg-primary/5 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            <span className="flex min-w-0 items-start gap-1.5">
              <BookOpenCheck className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden="true" />
              <span>
                Consultées à chaque question :{" "}
                <span className="font-semibold text-foreground">{consulted.map((s) => s.label).join(", ")}</span>
              </span>
            </span>
            <button
              type="button"
              onClick={stopConsulting}
              disabled={pending}
              className="shrink-0 font-semibold hover:text-foreground disabled:opacity-50"
            >
              Ne plus consulter
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-1.5">
          <Textarea
            rows={2}
            value={draft}
            placeholder={wide
              ? "Posez votre question — l'assistant ne voit pas les données de l'usager."
              : "Poser une question sur la démarche ou le dossier"}
            aria-label="Question à l'assistant"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Entrée envoie, Maj+Entrée saute une ligne — motif MentionTextarea.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className={cn("min-h-[58px] resize-none", wide ? "text-sm" : "text-[12.5px]")}
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={!canSend}
            aria-label="Envoyer la question"
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground transition-[filter,transform] hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              : <Send className="size-4" aria-hidden="true" />}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Réponses générées à partir du référentiel de la collectivité — vérifiez-les avant de
            les reprendre à votre compte.
          </p>
          {!isFresh(thread) ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" aria-hidden="true" /> Effacer
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
