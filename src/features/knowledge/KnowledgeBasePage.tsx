// « Base de connaissances » — le catalogue des démarches PUBLIÉES du tenant,
// regroupées par catégorie, avec recherche. Chaque carte dit ce qui compte
// avant de l'ouvrir : qui propose la démarche, si elle n'est ouverte que pour
// un temps, si elle est absente du portail. Au clic, sa fiche.
//
// Accès : attribut de profil `knowledge_base_access` (`KnowledgeBaseRoute`).
// Pas de maquette pour cette liste : elle reprend la grammaire des cartes du
// guichet (`ProcedurePicker`).

import * as React from "react";
import { Link } from "react-router-dom";
import { BookOpen, Building2, CalendarRange, EyeOff, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useWideLayout } from "@/components/layout/shellLayout";
import { useTenant } from "@/features/tenant/TenantProvider";
import { filterCatalogue, groupByCategory, organismesLabel, type KnowledgeProcedure } from "./catalogue";
import { useKnowledgeCatalogue } from "./useKnowledge";

function ProcedureCard({ item }: { item: KnowledgeProcedure }) {
  const organismes = organismesLabel(item.organismes);
  return (
    <Link
      to={`/base-de-connaissances/${item.id}`}
      className="flex w-full flex-col gap-2 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm transition-shadow hover:border-primary/40 hover:shadow-airbnb-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-[15px] font-bold leading-tight">{item.name}</span>

      {item.temporaryPeriod || item.portalAbsence ? (
        <span className="flex flex-wrap items-center gap-1.5">
          {item.temporaryPeriod ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-secondary/40 px-2 py-0.5 text-[10.5px] font-bold text-secondary-foreground"
              title={item.temporaryPeriod}
            >
              <CalendarRange className="size-3" aria-hidden="true" />
              Ouverte temporairement
            </span>
          ) : null}
          {item.portalAbsence ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground">
              <EyeOff className="size-3" aria-hidden="true" />
              {item.portalAbsence}
            </span>
          ) : null}
        </span>
      ) : null}
      {item.temporaryPeriod ? (
        <span className="text-[11px] text-muted-foreground">{item.temporaryPeriod}</span>
      ) : null}

      <span className="mt-auto flex items-start gap-1.5 text-xs text-muted-foreground">
        <Building2 className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {organismes ? (
          <span>
            <span className="sr-only">Proposée par : </span>
            {organismes}
          </span>
        ) : (
          <span className="italic">Proposée par aucun organisme</span>
        )}
      </span>
    </Link>
  );
}

export function KnowledgeBasePage() {
  // Liste dense, comme Demandes et Usagers : pleine largeur, padding du shell.
  useWideLayout();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const catalogue = useKnowledgeCatalogue(orgId);
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[280px] max-w-[560px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Rechercher une démarche"
            placeholder="Rechercher une démarche — nom, catégorie, organisme"
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
          {catalogue.organismesLoading && !catalogue.isLoading ? " · organismes en cours de lecture" : ""}
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
          production dans le Socle et <strong>dans leur période de publication</strong>, figurent
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
                    <ProcedureCard item={item} />
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
