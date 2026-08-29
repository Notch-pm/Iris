// Rail latéral du parcours, en deux onglets :
//  - « Demande » — fiche en cours (progression, complétude) et demandes
//    proches de l'usager désigné (détection best-effort, liaison explicite) ;
//  - « Procédure » — la base de connaissances de la démarche choisie, telle
//    que le Socle la destine à l'agent. Elle arrive AVEC la démarche
//    (`fetchProcedureSnapshot`) : aucun appel supplémentaire au guichet.

import * as React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import { AssistantPane } from "../assistant/AssistantPane";
import { ProcedurePane } from "../procedure/ProcedurePane";
import { RailTabs, type RailTab } from "../procedure/RailTabs";
import type { LinkedRequests } from "./model";
import { depositLabel, scoreTone, type NearbyScored } from "./proches";
import {
  emptyKnowledge,
  isKnowledgeEmpty,
  type AgentKnowledge,
  type KnowledgeDocument,
} from "@fn/socle-proxy/_shared/knowledge";

export interface FicheLine {
  key: string;
  value: string;
  ok: boolean;
}

export type NearbyState = "idle" | "loading" | "error" | "ready";

interface Props {
  reference: string | null;
  progress: number;
  lines: FicheLine[];
  nearby: { state: NearbyState; items: NearbyScored[] };
  linked: LinkedRequests;
  onToggleLink: (id: string, reference: string) => void;
  now: Date;
  /** Démarche choisie et sa base de connaissances — null tant qu'aucune ne l'est. */
  procedure: { name: string; serviceLabel: string | null; knowledge: AgentKnowledge } | null;
  onOpenDocument: (doc: KnowledgeDocument) => void;
  openingDocument: string | null;
  documentError: string | null;
}

const TONE_TEXT = { haute: "text-destructive", moyenne: "text-secondary-foreground", faible: "text-muted-foreground" } as const;

// Structure vide stable : le panneau attend toujours une base complète, même
// quand aucune démarche n'est choisie (il n'affiche alors que l'explication).
const EMPTY_KNOWLEDGE = emptyKnowledge();

export function CreationRail({
  reference, progress, lines, nearby, linked, onToggleLink, now,
  procedure, onOpenDocument, openingDocument, documentError,
}: Props) {
  const duplicates = nearby.items.filter((i) => i.likelyDuplicate).length;
  const [tab, setTab] = React.useState<RailTab>("demande");
  const hasKnowledge = procedure !== null && !isKnowledgeEmpty(procedure.knowledge);

  return (
    <aside
      aria-label="Fiche de la demande et procédure"
      className="hidden w-[352px] shrink-0 flex-col gap-4 overflow-hidden border-l border-border bg-card px-[18px] pb-[22px] pt-[18px] lg:flex"
    >
      <RailTabs value={tab} onChange={setTab} hasKnowledge={hasKnowledge} />

      {tab === "procedure" ? (
        <ProcedurePane
          procedureName={procedure?.name ?? null}
          serviceLabel={procedure?.serviceLabel ?? null}
          state={procedure ? "ready" : "no-procedure"}
          knowledge={procedure?.knowledge ?? EMPTY_KNOWLEDGE}
          emptyHint="Choisissez une démarche à l'étape 1 : ses consignes, documents et garde-fous s'afficheront ici, pendant la saisie."
          onOpenDocument={onOpenDocument}
          openingPath={openingDocument}
          documentError={documentError}
          assistant={
            <AssistantPane emptyHint="Choisissez une démarche à l'étape 1 : l'assistant répondra alors sur ses consignes, ses pièces et ses délais." />
          }
        />
      ) : null}

      <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto", tab !== "demande" && "hidden")}>
      <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-background p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold tracking-wide">Fiche de la demande</h2>
          <span className="font-mono text-[11px] font-semibold text-muted-foreground">
            {reference ?? "n° à la création"}
          </span>
        </div>
        <div className="flex items-center gap-2.5" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </span>
          <span className="text-xs font-extrabold tabular-nums text-primary">{progress}%</span>
        </div>
        <dl className="flex flex-col gap-2.5">
          {lines.map((l) => (
            <div key={l.key} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className={cn("mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full", l.ok ? "bg-primary" : "bg-border")}
              />
              <span className="flex min-w-0 flex-col gap-0.5 leading-snug">
                <dt className="text-[10.5px] font-semibold text-muted-foreground">{l.key}</dt>
                <dd className={cn("text-[12.5px] font-semibold", l.ok ? "text-foreground" : "text-muted-foreground")}>
                  {l.value}
                </dd>
              </span>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold">Demandes proches</h2>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold",
              duplicates > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
            )}
          >
            {nearby.state === "ready"
              ? nearby.items.length > 0 ? `${nearby.items.length} détectée${nearby.items.length > 1 ? "s" : ""}` : "aucune"
              : nearby.state === "loading" ? "recherche…" : nearby.state === "error" ? "indisponible" : "en veille"}
          </span>
        </div>

        {nearby.state === "idle" ? (
          <p className="rounded-xl border border-dashed border-border p-3.5 text-xs leading-relaxed text-muted-foreground">
            La détection s'active dès que l'usager est désigné (usager Socle rapproché, ou nom déclaré à titre indicatif).
          </p>
        ) : null}
        {nearby.state === "loading" ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Recherche des demandes de cet usager…
          </p>
        ) : null}
        {nearby.state === "error" ? (
          <p className="rounded-xl border border-dashed border-border p-3.5 text-xs text-muted-foreground">
            Détection indisponible pour l'instant — la création reste possible.
          </p>
        ) : null}
        {nearby.state === "ready" && nearby.items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-3.5 text-xs leading-relaxed text-muted-foreground">
            Aucune autre demande connue pour cet usager dans votre périmètre.
          </p>
        ) : null}

        {nearby.items.map((item) => {
          const isLinked = Boolean(linked[item.id]);
          const tone = scoreTone(item.score);
          return (
            <article
              key={item.id}
              className={cn(
                "flex flex-col gap-2 rounded-xl border bg-card p-3",
                isLinked ? "border-primary/40" : item.likelyDuplicate ? "border-destructive/30" : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-mono text-[11.5px] font-bold tracking-wide">{item.reference}</span>
                  <span className="text-[13px] font-bold leading-tight">
                    {item.socle_procedure_label ?? item.subject}
                  </span>
                </span>
                <span className={cn("shrink-0 text-xs font-extrabold tabular-nums", TONE_TEXT[tone])}>
                  {item.score}%
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={item.status} />
                <span className="text-[11px] text-muted-foreground">{depositLabel(item.created_at, now)}</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">{item.reasons.join(" · ")}</p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  aria-pressed={isLinked}
                  onClick={() => onToggleLink(item.id, item.reference)}
                  className={cn(
                    "h-7 rounded-lg border px-2.5 text-[11.5px] font-bold transition-colors",
                    isLinked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-secondary hover:bg-secondary",
                  )}
                >
                  {isLinked ? "Liée ✓" : "Lier"}
                </button>
                <Link
                  to={`/demandes/${item.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-secondary hover:bg-secondary hover:text-foreground"
                >
                  Ouvrir <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              </div>
            </article>
          );
        })}
      </section>
      </div>
    </aside>
  );
}
