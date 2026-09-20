// « Recommandations générales » — ce que la collectivité demande à ses agents
// pour toutes ses démarches (Socle 1.27.0), sur le MODÈLE de la fiche d'une
// démarche (`KnowledgeProcedurePage`) : pleine hauteur, à gauche « Retour », le
// titre, le sélecteur de démarche et une entrée par rubrique NON VIDE ; au
// centre, la rubrique ouverte en colonne de lecture.
//
// Pas de colonne « Assistant » : il ne sait répondre que sur une démarche
// (`request-assistant` exige `socle_procedure_id`) — et il lit déjà ces
// recommandations depuis la fiche de chacune.
//
// Trois états qui ne se confondent pas : rien d'écrit (la collectivité n'a pas
// rédigé de recommandations), référentiel muet (« indisponible », jamais une
// page vide), et le contenu.

import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookUser, DoorOpen, Link2, Loader2, MessageSquare, SquareCheckBig } from "lucide-react";
import { useFullBleedLayout } from "@/components/layout/shellLayout";
import { useTenant } from "@/features/tenant/TenantProvider";
import { NavButton, NavGroup } from "@/features/requests/procedure/FicheSections";
import { AgentGuidanceContent } from "./AgentGuidanceContent";
import { GUIDANCE_ENTRY_ID, guidanceDate, guidanceNav, resolveGuidanceTab, type GuidanceTab } from "./guidance";
import { ProcedureSwitcher } from "./ProcedureSwitcher";
import { useAgentGuidance } from "./useAgentGuidance";
import { useKnowledgeCatalogue } from "./useKnowledge";

const TAB_ICON: Record<GuidanceTab, React.ComponentType<{ className?: string }>> = {
  role: BookUser,
  accueil: DoorOpen,
  consignes: SquareCheckBig,
  faq: MessageSquare,
  sources: Link2,
};

export function AgentGuidancePage() {
  useFullBleedLayout();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const guidance = useAgentGuidance(orgId);
  const catalogue = useKnowledgeCatalogue(orgId);
  const view = guidance.data?.configured ? guidance.data : null;

  const [requested, setRequested] = React.useState<GuidanceTab | null>(null);
  const nav = view ? guidanceNav(view.guidance) : [];
  const tab = resolveGuidanceTab(requested, nav);
  const date = guidanceDate(view?.updated_at ?? null);
  const organizationName = current?.organizationName ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── Les recommandations et leurs rubriques ── */}
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
          <h1 className="mt-1.5 text-[17px] font-extrabold leading-snug tracking-tight">Recommandations générales</h1>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {[organizationName, "toutes démarches"].filter(Boolean).join(" · ")}
          </p>
          {date ? <p className="mt-1.5 text-[11px] text-muted-foreground">Mises à jour le {date}</p> : null}
          <ProcedureSwitcher catalogue={catalogue.data ?? []} currentId={GUIDANCE_ENTRY_ID} guidance={view !== null} />
        </div>

        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Rubriques des recommandations"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-5 pt-3.5"
        >
          <NavGroup label="Toutes démarches" first />
          {guidance.isLoading ? (
            <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Lecture…
            </p>
          ) : nav.length === 0 ? (
            <p className="px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
              {guidance.isError || !guidance.data
                ? "Recommandations générales indisponibles."
                : "La collectivité n'a rédigé aucune recommandation."}
            </p>
          ) : (
            nav.map((item) => (
              <NavButton<GuidanceTab>
                key={item.tab} tab={item.tab} label={item.label} count={item.count} icon={TAB_ICON[item.tab]}
                current={tab ?? item.tab} onSelect={setRequested}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── La rubrique ouverte ── */}
      <main
        role="tabpanel"
        aria-label={nav.find((item) => item.tab === tab)?.label ?? "Recommandations générales"}
        className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-[clamp(16px,2.4vw,32px)] pb-10 pt-6"
      >
        {guidance.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lecture des recommandations dans le référentiel…
          </p>
        ) : guidance.isError || !guidance.data ? (
          <p className="max-w-[72ch] rounded-[10px] border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground">
            Les recommandations générales n'ont pas pu être lues depuis le Référentiel — réessayez
            dans un instant.
          </p>
        ) : !view || !tab ? (
          <div className="max-w-[72ch]">
            <h2 className="text-[22px] font-extrabold tracking-tight">Recommandations générales</h2>
            <p className="mt-3 rounded-[10px] border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground">
              {organizationName ?? "La collectivité"} n'a pas encore rédigé de
              recommandations pour ses agents. Elles se rédigent dans le Référentiel, sur
              l'organisation principale (onglet « Recommandations aux agents »).
            </p>
          </div>
        ) : (
          <AgentGuidanceContent view={view} organizationName={organizationName} section={tab} />
        )}
      </main>
    </div>
  );
}
