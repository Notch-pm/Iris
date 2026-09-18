// Fiche d'une démarche dans la BASE DE CONNAISSANCES — maquette Claude Design
// « Base de connaissance » (2026-09-18) : trois colonnes, pleine hauteur.
//  - à gauche, la démarche et ses rubriques (côté usager, interne agent) ;
//  - au centre, la rubrique ouverte, en colonne de lecture ;
//  - à droite, l'assistant, qui répond sur CETTE démarche (mode « démarche
//    seule » : aucune donnée d'usager) — élargissable.
//
// Les rubriques sont CELLES de la « Fiche démarche » du guichet
// (`FicheSections.tsx`), en typographie de page.
//
// ⚠️ Une démarche NON PUBLIÉE (brouillon, interne, hors période) n'est pas
// affichée, même par son adresse : l'écran vérifie qu'elle figure au
// catalogue publié avant de montrer quoi que ce soit.
//
// « Retour » ramène à la liste ; « Changer de démarche » ouvre un sélecteur à
// recherche sur le même catalogue (`ProcedureSwitcher`).
//
// Pas repris de la maquette, faute de donnée ou de chemin : la version et la
// date de la fiche, « Voir la page publique » (Iris ne connaît pas l'adresse
// du portail), « Consigner une demande » (le guichet ne sait pas encore
// s'ouvrir sur une démarche désignée), les sources cliquables et les votes
// sous les réponses de l'assistant, « Copier dans la demande ».

import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarRange, EyeOff, Loader2, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { useFullBleedLayout } from "@/components/layout/shellLayout";
import { cn } from "@/lib/utils";
import { useTenant } from "@/features/tenant/TenantProvider";
import { AssistantPane } from "@/features/requests/assistant/AssistantPane";
import { AssistantThreadProvider } from "@/features/requests/assistant/AssistantThreadProvider";
import { procedureTypeLabel } from "@/features/requests/creation/procedureSearch";
import { FicheTabContent, NavButton, NavGroup } from "@/features/requests/procedure/FicheSections";
import {
  DEMARCHE_STARTERS,
  internalNav,
  resolveTab,
  type FicheTab,
  type ProcedureFiche,
} from "@/features/requests/procedure/ficheDemarche";
import { useProcedureFiche } from "@/features/requests/procedure/useProcedureKnowledge";
import type { KnowledgeProcedure } from "./catalogue";
import { ProcedureSwitcher } from "./ProcedureSwitcher";
import { useKnowledgeCatalogue } from "./useKnowledge";

type ContentTab = Exclude<FicheTab, "assistant">;

/** Ce que l'assistant a sous les yeux, dit en une phrase — rien d'autre ne part. */
function contextLine(item: KnowledgeProcedure, fiche: ProcedureFiche | null): string {
  if (!fiche) return `Fiche « ${item.name} ». L'assistant ne voit aucune donnée d'usager.`;
  const parts: string[] = [];
  const rules = fiche.knowledge.guardrails.length;
  if (rules > 0) parts.push(`${rules} point${rules > 1 ? "s" : ""} de vigilance`);
  if (fiche.knowledge.agentHelpText || fiche.knowledge.proceduresText) parts.push("consignes du service");
  if (fiche.knowledge.faq.length > 0) parts.push("FAQ agent");
  if (fiche.description || fiche.userCommunication) parts.push("textes publiés pour l'usager");
  const what = parts.length > 0 ? ` : ${parts.join(", ")}` : "";
  return `Fiche « ${item.name} »${what}. L'assistant ne voit aucune donnée d'usager.`;
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      <Link to="/base-de-connaissances" className="text-sm font-bold text-primary hover:underline">
        Retour à la base de connaissances
      </Link>
    </div>
  );
}

export function KnowledgeProcedurePage() {
  useFullBleedLayout();
  const { procedureId = "" } = useParams();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const catalogue = useKnowledgeCatalogue(orgId);
  const item = catalogue.data?.find((p) => p.id === procedureId) ?? null;
  // La fiche n'est demandée qu'une fois la démarche reconnue comme PUBLIÉE.
  const fiche = useProcedureFiche(orgId, item ? procedureId : null);
  const data = fiche.data ?? null;

  const [requested, setRequested] = React.useState<ContentTab>("usager");
  const [wide, setWide] = React.useState(false);
  const tab = resolveTab(requested, data) as ContentTab;
  const nav = data ? internalNav(data.knowledge) : [];

  if (catalogue.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lecture de la démarche…
      </div>
    );
  }
  if (!item) {
    return (
      <Unavailable>
        Cette démarche ne figure pas au catalogue publié : elle n'existe pas dans ce tenant, ou
        elle est en brouillon, interne, ou hors de sa période de publication.
      </Unavailable>
    );
  }

  const typeLabel = procedureTypeLabel(item.type);
  const meta = [item.category, typeLabel?.toLowerCase()].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── Démarche et rubriques ── */}
      <aside className="flex w-[clamp(210px,20vw,268px)] min-w-0 shrink-0 flex-col border-r border-border bg-muted/40">
        <div className="border-b border-border px-4 pb-3.5 pt-3.5">
          <Link
            to="/base-de-connaissances"
            className="-ml-1 mb-2.5 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13px] font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Retour
          </Link>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-muted-foreground">
            Base de connaissances
          </p>
          <h1 className="mt-1.5 text-[17px] font-extrabold leading-snug tracking-tight">{item.name}</h1>
          {meta ? <p className="mt-1.5 text-xs text-muted-foreground">{meta}</p> : null}
          {item.temporaryPeriod || item.portalAbsence ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.temporaryPeriod ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-secondary/40 px-2 py-0.5 text-[10.5px] font-bold text-secondary-foreground"
                  title={item.temporaryPeriod}
                >
                  <CalendarRange className="size-3" aria-hidden="true" /> Ouverte temporairement
                </span>
              ) : null}
              {item.portalAbsence ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground">
                  <EyeOff className="size-3" aria-hidden="true" /> {item.portalAbsence}
                </span>
              ) : null}
            </div>
          ) : null}
          {item.temporaryPeriod ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{item.temporaryPeriod}</p>
          ) : null}
          <ProcedureSwitcher catalogue={catalogue.data ?? []} currentId={item.id} />
        </div>

        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Rubriques de la fiche"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-5 pt-3.5"
        >
          <NavGroup label="Côté usager" first />
          <NavButton tab="usager" label="Ce que voit l'usager" current={tab} onSelect={(t) => setRequested(t as ContentTab)} />

          <NavGroup label="Interne — agent" />
          {fiche.isLoading ? (
            <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Lecture…
            </p>
          ) : nav.length === 0 ? (
            <p className="px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
              {fiche.isError
                ? "Consignes du service indisponibles."
                : "Le service n'a rédigé aucune consigne pour cette démarche."}
            </p>
          ) : (
            nav.map((navItem) => (
              <NavButton
                key={navItem.tab} tab={navItem.tab} label={navItem.label} count={navItem.count}
                current={tab} onSelect={(t) => setRequested(t as ContentTab)}
              />
            ))
          )}

        </div>
      </aside>

      {/* ── La rubrique ouverte ── */}
      <main
        role="tabpanel"
        aria-label={tab === "usager" ? "Ce que voit l'usager" : nav.find((i) => i.tab === tab)?.label}
        className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-[clamp(16px,2.4vw,32px)] pb-10 pt-6"
      >
        {fiche.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lecture de la fiche dans le référentiel…
          </p>
        ) : !data ? (
          <p className="max-w-[72ch] rounded-[10px] border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground">
            La fiche n'a pas pu être lue depuis le Référentiel — réessayez dans un instant.
          </p>
        ) : (
          <FicheTabContent
            tab={tab}
            fiche={data}
            organizationId={orgId}
            socleProcedureId={item.id}
            portalVisible={item.portalVisible}
            organismes={item.organismes}
            size="page"
          />
        )}
      </main>

      {/* ── L'assistant ── */}
      <aside
        aria-label="Assistant"
        className={cn(
          "flex min-w-0 shrink-0 flex-col border-l border-border bg-card transition-[width] duration-200",
          wide ? "w-[clamp(320px,46vw,560px)]" : "w-[clamp(300px,30vw,400px)]",
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
              <Sparkles className="size-[17px]" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold">Assistant</span>
              <span className="block truncate text-xs text-muted-foreground">Répond sur « {item.name} »</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setWide((w) => !w)}
            title={wide ? "Réduire le panneau" : "Élargir le panneau"}
            aria-label={wide ? "Réduire le panneau de l'assistant" : "Élargir le panneau de l'assistant"}
            aria-pressed={wide}
            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            {wide ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
          </button>
        </div>

        {/* Un fil par démarche : changer de démarche change la cible, et le
            fournisseur repart d'un fil vide. Rien n'est enregistré (D3). */}
        <AssistantThreadProvider
          target={{ kind: "procedure", organizationId: orgId, socleProcedureId: item.id }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
            <div className="shrink-0 rounded-[10px] border border-border bg-muted/50 px-3.5 py-3">
              <p className="text-xs font-extrabold uppercase tracking-[0.03em] text-muted-foreground">Contexte</p>
              <p className="mt-1.5 text-[13px] leading-relaxed">{contextLine(item, data)}</p>
            </div>
            <AssistantPane
              wide
              starters={DEMARCHE_STARTERS}
              emptyHint="L'assistant n'est pas disponible pour cette démarche."
            />
          </div>
        </AssistantThreadProvider>
      </aside>
    </div>
  );
}
