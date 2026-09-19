// « Base de connaissances » — le catalogue des démarches PUBLIÉES du tenant,
// regroupées par catégorie, avec recherche. Chaque carte dit ce qui compte
// avant de l'ouvrir : qui propose la démarche, si elle n'est ouverte que pour
// un temps, si elle est absente du portail. Au clic, sa fiche.
//
// Accès : attribut de profil `knowledge_base_access` (`KnowledgeBaseRoute`).
// Pas de maquette pour cette liste : ses tuiles SONT celles de l'étape
// « Démarche » du guichet (`ProcedureTile`, sans « i » ni « Choisir »), avec le
// public concerné et les organismes en plus.

import * as React from "react";
import { Link } from "react-router-dom";
import { BookOpen, BookUser, ChevronRight, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useWideLayout } from "@/components/layout/shellLayout";
import { cn } from "@/lib/utils";
import { useTenant } from "@/features/tenant/TenantProvider";
import { ProcedureTileBody, procedureTileClass } from "@/features/requests/creation/ProcedureTile";
import { volumeLabel } from "@/features/requests/creation/procedureSearch";
import { useProcedureMonthlyCounts } from "@/features/requests/creation/useCreationData";
import { filterCatalogue, groupByCategory, organismesLabel, type KnowledgeProcedure } from "./catalogue";
import { useKnowledgeCatalogue } from "./useKnowledge";
import { useAgentGuidance } from "./useAgentGuidance";
import { guidanceHighlights } from "./guidance";

/**
 * Les recommandations générales de la collectivité, en tête du catalogue : elles
 * valent pour toutes les démarches qui suivent. Rien d'écrit ⇒ rien à montrer ;
 * référentiel muet ⇒ une ligne qui le dit, jamais une carte vide.
 */
function AgentGuidanceCard({ orgId }: { orgId: string }) {
  const guidance = useAgentGuidance(orgId);
  if (guidance.isError) {
    return (
      <p className="text-xs text-muted-foreground">
        Recommandations générales indisponibles — le Référentiel n'a pas répondu.
      </p>
    );
  }
  if (!guidance.data?.configured) return null;
  const highlights = guidanceHighlights(guidance.data.guidance);
  return (
    <Link
      to="/base-de-connaissances/recommandations"
      className="group flex max-w-3xl items-center gap-3.5 rounded-[14px] border border-primary/25 bg-primary/[0.04] px-4 py-3.5 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
        <BookUser className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">Recommandations générales</span>
        <span className="block text-[13px] text-muted-foreground">
          Valables pour toutes les démarches{highlights.length > 0 ? ` — ${highlights.join(", ")}` : ""}.
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
    </Link>
  );
}

function ProcedureCard({ item, count }: { item: KnowledgeProcedure; count: number | undefined }) {
  return (
    <Link
      to={`/base-de-connaissances/${item.id}`}
      className={cn(
        procedureTileClass(),
        "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <ProcedureTileBody
        name={item.name}
        category={item.category}
        type={item.type}
        publication={item.publication}
        volume={volumeLabel(count)}
        audiences={item.audiences}
        organismes={organismesLabel(item.organismes)}
      />
    </Link>
  );
}

export function KnowledgeBasePage() {
  // Liste dense, comme Demandes et Usagers : pleine largeur, padding du shell.
  useWideLayout();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const catalogue = useKnowledgeCatalogue(orgId);
  // Le volume du mois, borné par le RLS — le même compte qu'au guichet.
  const monthlyCounts = useProcedureMonthlyCounts(orgId);
  const [query, setQuery] = React.useState("");
  const sectionId = React.useId();

  const all = catalogue.data ?? [];
  const visible = React.useMemo(() => filterCatalogue(all, query), [all, query]);
  const groups = React.useMemo(() => groupByCategory(visible), [visible]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="size-6 text-primary" aria-hidden="true" /> Base de connaissances
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Les démarches publiées de {current?.organizationName ?? "la collectivité"} : ce que
          voit l'usager, les consignes du service, et l'assistant pour les questions du guichet.
        </p>
      </div>

      <AgentGuidanceCard orgId={orgId} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[280px] max-w-[560px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Rechercher une démarche"
            placeholder="Rechercher une démarche — nom, catégorie, organisme, public"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <small className="text-xs text-muted-foreground">
          {catalogue.isLoading
            ? "chargement…"
            : `${visible.length} démarche${visible.length > 1 ? "s" : ""} sur ${all.length}`}
          {catalogue.detailsLoading && !catalogue.isLoading ? " · organismes et publics en cours de lecture" : ""}
        </small>
      </div>

      {catalogue.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lecture du catalogue…
        </p>
      ) : catalogue.isError ? (
        <p className="rounded-[14px] border border-dashed border-border p-5 text-sm text-muted-foreground">
          Le catalogue des démarches n'a pas pu être lu — réessayez dans un instant.
        </p>
      ) : all.length === 0 ? (
        <p className="max-w-3xl rounded-[14px] border border-dashed border-border p-5 text-sm text-muted-foreground">
          Aucune démarche publiée pour ce tenant. Seules les démarches <strong>externes</strong>, en
          production dans le Référentiel et <strong>dans leur période de publication</strong>, figurent
          ici.
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-border p-5 text-sm text-muted-foreground">
          Aucune démarche ne correspond à cette recherche.
        </p>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map((group, index) => (
            // Identifiant par POSITION : un libellé de catégorie porte des espaces,
            // et `aria-labelledby` découpe sur les espaces.
            <section key={group.label} aria-labelledby={`${sectionId}-${index}`} className="flex flex-col gap-3">
              <h2 id={`${sectionId}-${index}`} className="flex items-baseline gap-2 text-base font-bold">
                {group.label}
                <span className="text-xs font-semibold text-muted-foreground">
                  {group.procedures.length} démarche{group.procedures.length > 1 ? "s" : ""}
                </span>
              </h2>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 min-[1400px]:grid-cols-3">
                {group.procedures.map((item) => (
                  <li key={item.id} className="flex">
                    <ProcedureCard
                      item={item}
                      count={monthlyCounts.data ? (monthlyCounts.data[item.id] ?? 0) : undefined}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
