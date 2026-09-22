// Écran « Carte des interventions » : les demandes EN COURS du tenant dont la
// démarche porte un lieu d'intervention, posées sur une carte OpenStreetMap.
//
// Filtres : démarches (multi-sélection) et urgence (la légende EST le filtre,
// puisque la couleur de l'épingle porte l'urgence). Le survol d'une épingle
// donne l'essentiel de la demande et un accès direct à sa fiche.
//
// Le RLS reste l'autorité : cet écran n'affiche que ce que la liste afficherait.

import * as React from "react";
import { Link } from "react-router-dom";
import { Check, CheckCircle2, ChevronDown, Columns3, Layers, List, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownDivider, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import { useFullBleedLayout } from "@/components/layout/shellLayout";
import { useTenant } from "@/features/tenant/TenantProvider";
import { useQuartiers } from "@/features/socle/useQuartiers";
import { useOrganisationAnchor } from "@/features/socle/useOrganisationAnchor";
import { cn } from "@/lib/utils";
import { memberName, PRIORITY_OPTIONS } from "../instruction/instruction";
import { useTenantMembers } from "../useRequests";
import { InterventionMap, pinColor, type MapMarker } from "./InterventionMap";
import {
  distinctAddresses,
  EMPTY_MAP_FILTERS,
  filterRequests,
  locatableRequests,
  MAP_MAX_ROWS,
  priorityCounts,
  procedureFacets,
  RECENT_RESOLVED_DAYS,
  recentResolvedSince,
  resolvedCount,
  toggleValue,
  type MapFilters,
} from "./carte";
import { useBatchGeocode, useOpenRequestsForMap } from "./useMapRequests";

/** Urgences de la plus forte à la plus faible : l'œil va d'abord au rouge. */
const PRIORITY_FILTERS = [...PRIORITY_OPTIONS].reverse();

export function CartePage() {
  useFullBleedLayout();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  // Fenêtre des résolues récentes : figée au montage (minuit local, il y a
  // 30 jours), stable donc pour la clé de requête.
  const resolvedSince = React.useMemo(() => recentResolvedSince(new Date()), []);
  const requests = useOpenRequestsForMap(orgId, resolvedSince);
  const members = useTenantMembers(orgId);
  const [filters, setFilters] = React.useState<MapFilters>(EMPTY_MAP_FILTERS);
  const [procMenu, setProcMenu] = React.useState(false);
  // Le découpage du territoire aide à lire la carte : affiché par défaut, et
  // débrayable — sur une commune très découpée, les traits finissent par
  // concurrencer les épingles.
  const [showQuartiers, setShowQuartiers] = React.useState(true);
  // L'étendue des quartiers CADRE la carte (elle ne fait pas que la décorer) ;
  // le siège n'est que le repli quand le Socle ne publie pas de découpage.
  const { quartiers, pending: quartiersPending } = useQuartiers(orgId);
  const { anchor, pending: anchorPending } = useOrganisationAnchor(orgId);

  const rows = requests.data?.rows ?? [];
  const { located, withoutAddress } = React.useMemo(() => locatableRequests(rows), [rows]);
  const addresses = React.useMemo(() => distinctAddresses(located), [located]);
  const geocode = useBatchGeocode(addresses);

  const facets = React.useMemo(() => procedureFacets(located), [located]);
  const counts = React.useMemo(() => priorityCounts(located), [located]);
  const resolved = React.useMemo(() => resolvedCount(located), [located]);
  const visible = React.useMemo(() => filterRequests(located, filters), [located, filters]);

  const markers: MapMarker[] = React.useMemo(
    () =>
      visible
        // Le point déclaré au dépôt prime ; sinon le géocodage de l'adresse.
        .map((item) => ({ item, point: item.point ?? geocode.points.get(item.addressKey) ?? null }))
        .filter((m): m is MapMarker => m.point !== null),
    [visible, geocode.points],
  );

  const memberList = members.data ?? [];
  const nameOf = React.useCallback(
    (userId: string | null) => memberName(memberList, userId),
    [memberList],
  );

  const unlocated = visible.length - markers.length;
  const filtered = filters.procedures.length > 0 || filters.priorities.length > 0;
  const truncated = (requests.data?.total ?? 0) > rows.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-5 pb-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-2xl font-semibold tracking-tight">Carte des interventions</h1>
            <p className="text-xs text-muted-foreground">
              {requests.isLoading
                ? "Chargement des demandes en cours…"
                : `${markers.length} demande${markers.length > 1 ? "s" : ""} située${markers.length > 1 ? "s" : ""} sur ${located.length} avec un lieu d'intervention (en cours, ou résolues depuis moins de ${RECENT_RESOLVED_DAYS} jours)`}
              {unlocated > 0 ? ` · ${unlocated} adresse${unlocated > 1 ? "s" : ""} non localisée${unlocated > 1 ? "s" : ""}` : ""}
              {withoutAddress > 0 ? ` · ${withoutAddress} sans lieu d'intervention` : ""}
              {truncated ? ` · ${MAP_MAX_ROWS} demandes les plus récentes seulement` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/demandes/tableau"><Columns3 aria-hidden="true" /> Tableau</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/demandes"><List aria-hidden="true" /> Voir la liste</Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            open={procMenu}
            onOpenChange={setProcMenu}
            align="left"
            menuClassName="max-h-[320px] overflow-auto"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors",
                  filters.procedures.length > 0
                    ? "border-primary/30 bg-primary/[0.07] text-primary"
                    : "border-border bg-background hover:bg-secondary",
                )}
              >
                {filters.procedures.length > 0
                  ? `${filters.procedures.length} démarche${filters.procedures.length > 1 ? "s" : ""}`
                  : "Toutes les démarches"}
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </button>
            )}
          >
            <DropdownLabel>Démarches ({facets.length})</DropdownLabel>
            {facets.length === 0 ? (
              <span className="px-2 py-1.5 text-[12px] text-muted-foreground">Aucune démarche située</span>
            ) : null}
            {facets.map((facet) => {
              const checked = filters.procedures.includes(facet.value);
              return (
                <DropdownItem
                  key={facet.value}
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  active={checked}
                  onClick={() =>
                    setFilters((f) => ({ ...f, procedures: toggleValue(f.procedures, facet.value) }))
                  }
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                    aria-hidden="true"
                  >
                    {checked ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{facet.label}</span>
                  <span className="text-[11px] text-muted-foreground">{facet.count}</span>
                </DropdownItem>
              );
            })}
            {filters.procedures.length > 0 ? (
              <>
                <DropdownDivider />
                <DropdownItem onClick={() => setFilters((f) => ({ ...f, procedures: [] }))}>
                  Toutes les démarches
                </DropdownItem>
              </>
            ) : null}
          </Dropdown>

          <span className="h-5 w-px bg-border" aria-hidden="true" />

          {PRIORITY_FILTERS.map((priority) => {
            const checked = filters.priorities.includes(priority.key);
            return (
              <button
                key={priority.key}
                type="button"
                aria-pressed={checked}
                title={priority.hint}
                onClick={() =>
                  setFilters((f) => ({ ...f, priorities: toggleValue(f.priorities, priority.key) }))
                }
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors",
                  checked
                    ? "border-primary/30 bg-primary/[0.07] text-primary"
                    : "border-border bg-background hover:bg-secondary",
                )}
              >
                <span className={cn("size-2.5 rounded-full", pinColor(priority.key))} aria-hidden="true" />
                {priority.label}
                <span className="text-[11px] font-bold text-muted-foreground">{counts[priority.key] ?? 0}</span>
              </button>
            );
          })}

          {filtered ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => setFilters(EMPTY_MAP_FILTERS)}
            >
              Réinitialiser
            </Button>
          ) : null}

          <div className="flex-1" />

          {/* Les résolues de moins de 30 jours, en gris — visibles par défaut,
              débrayables (retour PO 2026-09-19). Le compteur dit combien
              d'épingles le commutateur ajoute ou retire. */}
          <button
            type="button"
            aria-pressed={filters.showResolved}
            title={`Demandes résolues depuis moins de ${RECENT_RESOLVED_DAYS} jours, en gris sur la carte`}
            onClick={() => setFilters((f) => ({ ...f, showResolved: !f.showResolved }))}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors",
              filters.showResolved
                ? "border-primary/30 bg-primary/[0.07] text-primary"
                : "border-border bg-background hover:bg-secondary",
            )}
          >
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Voir les demandes résolues récemment
            <span className="text-[11px] font-bold text-muted-foreground">{resolved}</span>
          </button>

          {/* Option d'AFFICHAGE, pas un filtre : elle ne change pas la
              sélection de demandes, seulement ce qu'on voit sous elles.
              Absente quand le référentiel ne publie aucun quartier. */}
          {quartiers.length > 0 ? (
            <button
              type="button"
              aria-pressed={showQuartiers}
              title="Superposer le découpage du territoire (Référentiel)"
              onClick={() => setShowQuartiers((v) => !v)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors",
                showQuartiers
                  ? "border-primary/30 bg-primary/[0.07] text-primary"
                  : "border-border bg-background hover:bg-secondary",
              )}
            >
              <Layers className="size-3.5" aria-hidden="true" />
              Afficher les quartiers
            </button>
          ) : null}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {requests.isError ? (
          <Notice>Les demandes n'ont pas pu être chargées.</Notice>
        ) : requests.isLoading ? (
          <Notice>Chargement des demandes en cours…</Notice>
        ) : located.length === 0 ? (
          <Notice>
            Aucune demande en cours ne porte de lieu d'intervention. Le bloc « Lieu d'intervention »
            se pose sur le formulaire de la démarche, dans le Référentiel.
          </Notice>
        ) : (
          <>
            <InterventionMap markers={markers} nameOf={nameOf}
              quartiers={quartiers} showQuartiers={showQuartiers} anchor={anchor}
              framePending={quartiersPending || anchorPending} />
            {geocode.isLoading && markers.length === 0 ? (
              <Overlay>Localisation des adresses…</Overlay>
            ) : quartiersPending || anchorPending ? (
              // La carte ne se cadre pas tant qu'on ne sait pas sur QUOI : sans
              // ce mot, l'agent regarderait un rectangle vide sans savoir
              // pourquoi (le silence dure le temps d'un appel au référentiel).
              <Overlay>Chargement du territoire…</Overlay>
            ) : null}
            {geocode.isError ? (
              <Overlay>
                Le service de localisation n'a pas répondu — les demandes restent consultables dans la liste.
                <Button type="button" variant="outline" size="sm" onClick={geocode.retry}>Réessayer</Button>
              </Overlay>
            ) : null}
            {!geocode.isLoading && !geocode.isError && markers.length === 0 ? (
              <Overlay>
                {filtered
                  ? "Aucune demande située ne correspond à ces filtres."
                  : "Aucune adresse n'a pu être localisée."}
              </Overlay>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <MapPin className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-[520px] text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <div className="pointer-events-auto flex max-w-[420px] flex-col items-center gap-2 rounded-[14px] border border-border bg-card/95 px-4 py-3 text-center text-[13px] text-muted-foreground shadow-airbnb-lg">
        {children}
      </div>
    </div>
  );
}
