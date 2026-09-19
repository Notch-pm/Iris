// Les recommandations générales de la collectivité, en typographie de page —
// partagées par la page dédiée (`AgentGuidancePage`) et la rubrique du même nom
// dans la fiche d'une démarche (`KnowledgeProcedurePage`).
//
// Seules les rubriques REMPLIES s'affichent. Le titre rappelle la règle que
// l'assistant applique aussi : une consigne propre à une démarche l'emporte.

import * as React from "react";
import { ExternalLink, Minus, Plus } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import type { AgentGuidanceView } from "@fn/_shared/organizations/agentGuidance";
import { guidanceDate, safeSourceHref } from "./guidance";

const BODY = "text-[15px] leading-[1.65]";

function Rubrique({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <h3 className="mb-2.5 text-base font-bold">{title}</h3>
      {children}
    </section>
  );
}

function FaqList({ items }: { items: { question: string; answer: string }[] }) {
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div className="border-t border-border">
      {items.map((item, i) => {
        const expanded = open === i;
        return (
          <div key={i}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : i)}
              className="flex w-full items-center justify-between gap-4 border-b border-border px-0.5 py-4 text-left text-[15px] font-bold transition-colors hover:text-primary"
            >
              <span>{item.question || "Sans question"}</span>
              {expanded
                ? <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                : <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </button>
            {expanded ? (
              <div className="border-b border-border px-0.5 pb-4 pt-3">
                <Markdown source={item.answer} className="text-sm leading-[1.65] text-muted-foreground" />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function AgentGuidanceContent({ view, organizationName }: {
  view: AgentGuidanceView;
  organizationName: string | null;
}) {
  const g = view.guidance;
  const date = guidanceDate(view.updated_at);
  return (
    <div className="min-w-0 max-w-[820px]">
      <h2 className="text-[22px] font-extrabold tracking-tight">Recommandations générales</h2>
      <p className="mb-[22px] mt-1 text-sm text-muted-foreground">
        Ce que {organizationName ?? "la collectivité"} demande à ses agents, pour toutes ses
        démarches. Une consigne propre à une démarche l'emporte sur celles-ci.
        {date ? ` Mises à jour le ${date}.` : ""}
      </p>

      {g.roleDescription ? (
        <Rubrique title="Rôle des agents">
          <Markdown source={g.roleDescription} className={BODY} />
        </Rubrique>
      ) : null}

      {g.physicalReception ? (
        <Rubrique title="Accueil physique">
          <Markdown source={g.physicalReception} className={BODY} />
        </Rubrique>
      ) : null}

      {g.guidelines.length > 0 ? (
        <Rubrique title="Consignes générales">
          <ol className="grid gap-2.5">
            {g.guidelines.map((item, i) => (
              <li key={i} className="flex gap-3 rounded-[10px] border border-border bg-card px-4 py-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {item.title ? <p className="text-[15px] font-bold">{item.title}</p> : null}
                  {item.text ? (
                    <Markdown source={item.text} className={cn("text-sm leading-[1.65]", item.title && "mt-1")} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Rubrique>
      ) : null}

      {g.faq.length > 0 ? (
        <Rubrique title="FAQ des agents">
          <FaqList items={g.faq} />
        </Rubrique>
      ) : null}

      {g.recommendedSources.length > 0 ? (
        <Rubrique title="Sources recommandées">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))] gap-3">
            {g.recommendedSources.map((link, i) => {
              const href = safeSourceHref(link.url);
              const body = (
                <>
                  <ExternalLink className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-bold">{link.description || link.url}</span>
                    {link.description && link.url ? (
                      <span className="block break-all text-[13px] text-muted-foreground">{link.url}</span>
                    ) : null}
                  </span>
                </>
              );
              const card = "flex items-start gap-3 rounded-[10px] border border-border bg-card p-3.5 text-left";
              return href ? (
                <a
                  key={i}
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(card, "transition-shadow hover:border-primary/40 hover:shadow-airbnb-md")}
                >
                  {body}
                </a>
              ) : (
                <div key={i} className={card}>{body}</div>
              );
            })}
          </div>
        </Rubrique>
      ) : null}
    </div>
  );
}
