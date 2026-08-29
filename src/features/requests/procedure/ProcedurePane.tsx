// Panneau « Procédure » du rail — la base de connaissances de la démarche,
// telle que le Socle la destine à L'AGENT (consignes, procédures internes,
// documents d'aide, liens, FAQ, garde-fous). Même panneau au guichet
// (parcours de création) et à l'instruction : c'est la même question posée à
// deux moments — « qu'est-ce que le service attend de moi sur celle-ci ? ».
//
// Deux sous-onglets : « Fiches » (ce que le service a écrit) et « Assistant »
// (la conversation). Le panneau reste PRÉSENTATIONNEL : il reçoit l'assistant
// en prop, et c'est la PAGE qui câble le fournisseur de conversation — parce
// que le fil doit survivre au démontage de ce panneau.

import * as React from "react";
import { ChevronDown, ExternalLink, FileText, Loader2, ShieldAlert } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { Pill } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import {
  knowledgeCounts,
  type AgentKnowledge,
  type KnowledgeDocument,
} from "@fn/socle-proxy/_shared/knowledge";

export type KnowledgeState = "no-procedure" | "loading" | "error" | "ready";

interface Props {
  procedureName: string | null;
  serviceLabel: string | null;
  state: KnowledgeState;
  knowledge: AgentKnowledge;
  /** Explication de l'état « aucune démarche » — elle diffère selon la page. */
  emptyHint: string;
  onOpenDocument?: (doc: KnowledgeDocument) => void;
  openingPath?: string | null;
  documentError?: string | null;
  /** Le panneau de conversation, monté par la page (voir l'en-tête). */
  assistant?: React.ReactNode;
}

// ---- Briques ------------------------------------------------------------------

function Card({ title, badge, badgeTone = "ok", children }: {
  title: string;
  badge: string;
  badgeTone?: "ok" | "pending";
  children: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12.5px] font-bold leading-tight">{title}</h3>
        <Pill tone={badgeTone}>{badge}</Pill>
      </div>
      {children}
    </article>
  );
}

/**
 * Un texte de service peut faire trois écrans. Dans un rail de 372 px, il doit
 * s'annoncer sans tout envahir : replié au-delà d'un seuil, dépliable d'un
 * geste. Le texte reste ENTIER dans le DOM (recherche du navigateur, lecteur
 * d'écran) — seule sa hauteur est bornée.
 */
const FOLD_THRESHOLD = 420;

function FoldableText({ source }: { source: string }) {
  const [open, setOpen] = React.useState(false);
  if (source.length <= FOLD_THRESHOLD) {
    return <Markdown source={source} className="text-muted-foreground" />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("relative", !open && "max-h-[168px] overflow-hidden")}>
        <Markdown source={source} className="text-muted-foreground" />
        {!open ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
          />
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 self-start text-[11.5px] font-bold text-primary hover:underline"
      >
        {open ? "Réduire" : "Tout afficher"}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
    </div>
  );
}

// ---- Panneau ------------------------------------------------------------------

type SubTab = "fiches" | "assistant";

export function ProcedurePane({
  procedureName, serviceLabel, state, knowledge, emptyHint,
  onOpenDocument, openingPath, documentError, assistant,
}: Props) {
  const [sub, setSub] = React.useState<SubTab>("fiches");
  const counts = knowledgeCounts(knowledge);
  const context = procedureName
    ? `Base de connaissances de « ${procedureName} »${serviceLabel ? ` — ${serviceLabel}` : ""}`
    : null;

  return (
    // ⚠️ `min-h-0 flex-1` : ce panneau TRANSMET la hauteur que le rail lui
    // donne, au lieu de grandir avec son contenu. C'est ce qui permet au
    // sous-onglet Assistant d'épingler sa zone de saisie — et aux fiches de
    // défiler sans entraîner toute la colonne.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        role="tablist"
        aria-label="Aide à la démarche"
        className="flex shrink-0 items-center gap-3.5"
      >
        {(["fiches", "assistant"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={sub === tab}
            onClick={() => setSub(tab)}
            className={cn(
              "border-b-2 pb-[3px] text-[12.5px] font-bold transition-colors",
              sub === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "fiches" ? "Fiches" : "Assistant"}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Socle
        </span>
      </div>

      {context ? (
        <p className="shrink-0 text-[11.5px] leading-relaxed text-muted-foreground">{context}</p>
      ) : null}

      {sub === "assistant" ? assistant ?? null : null}

      {sub === "fiches" && state === "no-procedure" ? (
        <p className="rounded-xl border border-dashed border-border p-3.5 text-xs leading-relaxed text-muted-foreground">
          {emptyHint}
        </p>
      ) : null}

      {sub === "fiches" && state === "loading" ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Lecture de la base de connaissances…
        </p>
      ) : null}

      {sub === "fiches" && state === "error" ? (
        <p className="rounded-xl border border-dashed border-border p-3.5 text-xs leading-relaxed text-muted-foreground">
          La base de connaissances n'a pas pu être lue depuis le Socle. Le travail sur la
          demande reste possible : ce panneau est une aide, jamais une condition.
        </p>
      ) : null}

      {sub === "fiches" && state === "ready" && counts.blocks === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-3.5 text-xs leading-relaxed text-muted-foreground">
          Le service n'a pas encore documenté cette démarche. Consignes, documents et
          garde-fous se renseignent dans le Socle, à l'étape « Base de connaissances » de la
          démarche.
        </p>
      ) : null}

      {sub === "fiches" && state === "ready" && counts.blocks > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          {counts.guardrails > 0 ? (
            <Card title="Points de vigilance" badge="Garde-fous" badgeTone="pending">
              <ul className="flex flex-col gap-1.5">
                {knowledge.guardrails.map((rule, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed">
                    <ShieldAlert className="mt-px size-3.5 shrink-0 text-secondary-foreground" aria-hidden="true" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {counts.aide ? (
            <Card title="Consignes pour l'agent" badge="Aide">
              <FoldableText source={knowledge.agentHelpText} />
            </Card>
          ) : null}

          {counts.procedures ? (
            <Card title="Procédure de traitement" badge="Procédure">
              <FoldableText source={knowledge.proceduresText} />
            </Card>
          ) : null}

          {counts.faq > 0 ? (
            <Card title="Questions fréquentes" badge={`${counts.faq} question${counts.faq > 1 ? "s" : ""}`}>
              <div className="flex flex-col gap-1">
                {knowledge.faq.map((item, i) => (
                  <details key={i} className="group border-b border-border pb-1.5 last:border-b-0 last:pb-0">
                    <summary className="flex cursor-pointer list-none items-start gap-1.5 py-1 text-[12px] font-semibold leading-snug">
                      <ChevronDown
                        className="mt-px size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">{item.question || "Sans question"}</span>
                    </summary>
                    <div className="pl-[19px] pt-0.5">
                      <Markdown source={item.answer} className="text-[12px] text-muted-foreground" />
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          ) : null}

          {counts.documents > 0 ? (
            <Card title="Documents d'aide" badge={`${counts.documents} fichier${counts.documents > 1 ? "s" : ""}`}>
              <ul className="flex flex-col gap-1.5">
                {knowledge.agentDocuments.map((doc) => {
                  const opening = openingPath === doc.path;
                  return (
                    <li key={doc.path}>
                      <button
                        type="button"
                        disabled={!onOpenDocument || opening}
                        onClick={() => onOpenDocument?.(doc)}
                        className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left text-[12px] font-semibold transition-colors hover:border-secondary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {opening ? (
                          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {documentError ? (
                <p role="alert" className="text-[11.5px] leading-relaxed text-destructive">{documentError}</p>
              ) : null}
            </Card>
          ) : null}

          {counts.links > 0 ? (
            <Card title="Liens utiles" badge={`${counts.links} lien${counts.links > 1 ? "s" : ""}`}>
              <ul className="flex flex-col gap-1.5">
                {knowledge.agentLinks.map((link, i) => (
                  <li key={i} className="flex flex-col gap-0.5">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-start gap-1.5 text-[12px] font-semibold text-primary hover:underline"
                    >
                      <span className="min-w-0 break-all">{link.description || link.url}</span>
                      <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    </a>
                    {link.description ? (
                      <span className="break-all text-[10.5px] text-muted-foreground">{link.url}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
