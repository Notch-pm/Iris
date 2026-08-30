// Écran « Tableau des demandes » (kanban) : les demandes du tenant réparties
// par statut, déplaçables d'une colonne à l'autre — un dépôt DEMANDE une
// transition, il ne la décide pas.
//
// Une colonne = un statut du workflow (les 7, dans l'ordre du cycle de vie).
// Pendant un déplacement, seules les colonnes que `requests_guard_write`
// accepterait pour cette demande s'ouvrent : les autres refusent le dépôt et
// disent pourquoi. La transition elle-même passe par le dialogue commun de la
// fiche (motif, commentaire pour l'usager, assigné) dès qu'il manque une
// information — sinon elle s'applique directement.
//
// Le RLS reste l'autorité : cet écran n'affiche que ce que la liste
// afficherait, et tout refus de la garde s'affiche tel quel.

import * as React from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, List, Map, Plus, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownDivider, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFullBleedLayout } from "@/components/layout/shellLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { canCreateProcedure } from "@/features/rights/rights";
import { useSocleProceduresCatalog } from "@/features/socle/useSocleCatalog";
import { useTenant } from "@/features/tenant/TenantProvider";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import { TransitionDialog } from "../TransitionActions";
import { memberName } from "../instruction/instruction";
import { useEligibleAssignees, useTenantMembers } from "../useRequests";
import type { RequestStatus, TransitionSpec } from "../statuts";
import { BoardCard } from "./BoardCard";
import {
  activeFilterCount, AGENT_FACET, BOARD_SORT_LABELS, boardCards, boardContent,
  boardRightsResolver, CLOSED_WINDOW_DAYS, closedSince, DESTINATAIRE_FACET, dropTargets,
  EMPTY_BOARD_FILTERS, facetsOf, filterCards, isMineOnly, PRIORITY_FACET, PROCEDURE_FACET,
  refusalHint, toggleMine, toggleValue, transitionToast,
  type BoardCardView, type BoardFilters, type BoardSort, type CountedOption,
} from "./tableau";
import { useBoardRequests } from "./useBoardRequests";
import { useBoardTransition } from "./useBoardTransition";

export function TableauPage() {
  useFullBleedLayout();
  const { current, rights } = useTenant();
  const { session } = useAuth();
  const orgId = current?.organizationId ?? "";
  const myId = session?.user.id ?? "";
  // Fenêtre des colonnes finales, figée à l'arrivée sur l'écran : recalculée à
  // chaque rendu, elle ferait valser la clé de requête pour rien.
  const since = React.useMemo(() => closedSince(new Date()), []);
  const board = useBoardRequests(orgId, since);
  const members = useTenantMembers(orgId);
  const procCatalog = useSocleProceduresCatalog(orgId);

  const [filters, setFilters] = React.useState<BoardFilters>(EMPTY_BOARD_FILTERS);
  const [sort, setSort] = React.useState<BoardSort>("recent");
  const [drag, setDrag] = React.useState<
    { card: BoardCardView; targets: Map<RequestStatus, TransitionSpec> } | null
  >(null);
  const [over, setOver] = React.useState<RequestStatus | null>(null);
  const [toast, setToast] = React.useState<{ text: string; visible: boolean }>({ text: "", visible: false });
  const toastTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const flash = React.useCallback((text: string) => {
    setToast({ text, visible: true });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2800);
  }, []);

  const transition = useBoardTransition({
    onDone: (card, spec) => flash(transitionToast(card, spec.to)),
  });
  // Assignés éligibles de la demande visée (RM-16) : le dialogue ne les demande
  // que si aucun assigné ne se déduit, mais alors il lui faut la bonne liste.
  const eligible = useEligibleAssignees(transition.card?.id);

  const memberList = members.data ?? [];
  const nameOf = React.useCallback(
    (userId: string) => memberName(memberList, userId),
    [memberList],
  );

  const cards = React.useMemo(() => boardCards(board.rows, nameOf), [board.rows, nameOf]);
  const visible = React.useMemo(() => filterCards(cards, filters), [cards, filters]);
  const content = React.useMemo(() => boardContent(visible, sort), [visible, sort]);
  // Les volumes des facettes portent sur tout le tableau, jamais sur la sélection.
  const agentFacets = React.useMemo(() => facetsOf(cards, AGENT_FACET), [cards]);
  const destinataireFacets = React.useMemo(() => facetsOf(cards, DESTINATAIRE_FACET), [cards]);
  const procedureFacets = React.useMemo(() => facetsOf(cards, PROCEDURE_FACET), [cards]);
  const priorityFacets = React.useMemo(() => facetsOf(cards, PRIORITY_FACET), [cards]);

  const rightsOf = React.useMemo(() => boardRightsResolver(rights), [rights]);
  const targetsOf = React.useCallback(
    (card: BoardCardView) => dropTargets(card, rightsOf(card)),
    [rightsOf],
  );

  // « Mes demandes » n'est pas un cinquième critère : c'est le filtre agent posé
  // sur moi seul. Son volume est celui de la facette, calculé sur tout le tableau.
  const mine = isMineOnly(filters, myId);
  const mineCount = agentFacets.find((f) => f.value === myId)?.count ?? 0;

  const canCreate =
    rights.is_platform_admin ||
    (procCatalog.data ?? []).some((o) => canCreateProcedure(rights, o.value));
  const nFilters = activeFilterCount(filters);

  if (!current) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Aucun tenant accessible — contactez votre administrateur.
      </p>
    );
  }

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border px-5 pb-3 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-2xl font-semibold tracking-tight">Tableau des demandes</h1>
            <p className="text-xs text-muted-foreground">
              {board.isLoading
                ? "Chargement du tableau…"
                : `${visible.length} demande${visible.length > 1 ? "s" : ""}${
                    visible.length === cards.length ? "" : ` sur ${cards.length}`
                  } · glissez une carte vers une autre colonne pour changer son état`}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Colonnes finales bornées aux {CLOSED_WINDOW_DAYS} derniers jours.
              {board.openTruncated > 0
                ? ` ${board.openTruncated} demande${board.openTruncated > 1 ? "s" : ""} en cours non chargée${board.openTruncated > 1 ? "s" : ""} — affinez par la liste.`
                : ""}
              {board.closedTruncated > 0
                ? ` ${board.closedTruncated} clôture${board.closedTruncated > 1 ? "s" : ""} de la fenêtre non chargée${board.closedTruncated > 1 ? "s" : ""}.`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/demandes"><List aria-hidden="true" /> Liste</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/carte"><Map aria-hidden="true" /> Carte</Link>
            </Button>
            {canCreate ? (
              <Button asChild size="sm">
                <Link to="/demandes/nouvelle"><Plus aria-hidden="true" /> Nouvelle demande</Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-[240px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Rechercher une demande"
              placeholder="Référence, objet, usager"
              className="h-8 rounded-full pl-9 pr-3 text-[12.5px]"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            />
          </div>

          {myId !== "" ? (
            <>
              <button
                type="button"
                aria-pressed={mine}
                title="Ne montrer que les demandes qui me sont affectées"
                onClick={() => setFilters((f) => toggleMine(f, myId))}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors",
                  mine
                    ? "border-primary/30 bg-primary/[0.07] text-primary"
                    : "border-border bg-background hover:bg-secondary",
                )}
              >
                <UserRound className="size-3.5" aria-hidden="true" />
                Mes demandes
                <span className={cn("text-[11px] font-bold", mine ? "text-primary" : "text-muted-foreground")}>
                  {mineCount}
                </span>
              </button>
              <span className="h-5 w-px bg-border" aria-hidden="true" />
            </>
          ) : null}

          <FacetFilter
            label="Agent"
            noun="agent"
            options={agentFacets}
            selected={filters.agents}
            onToggle={(v) => setFilters((f) => ({ ...f, agents: toggleValue(f.agents, v) }))}
            onClear={() => setFilters((f) => ({ ...f, agents: [] }))}
          />
          <FacetFilter
            label="Organisme"
            noun="organisme"
            options={destinataireFacets}
            selected={filters.destinataires}
            onToggle={(v) => setFilters((f) => ({ ...f, destinataires: toggleValue(f.destinataires, v) }))}
            onClear={() => setFilters((f) => ({ ...f, destinataires: [] }))}
          />
          <FacetFilter
            label="Démarche"
            noun="démarche"
            options={procedureFacets}
            selected={filters.procedures}
            onToggle={(v) => setFilters((f) => ({ ...f, procedures: toggleValue(f.procedures, v) }))}
            onClear={() => setFilters((f) => ({ ...f, procedures: [] }))}
          />
          <FacetFilter
            label="Urgence"
            noun="urgence"
            options={priorityFacets}
            selected={filters.priorities}
            onToggle={(v) => setFilters((f) => ({ ...f, priorities: toggleValue(f.priorities, v) }))}
            onClear={() => setFilters((f) => ({ ...f, priorities: [] }))}
          />

          {nFilters > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => setFilters(EMPTY_BOARD_FILTERS)}
            >
              Réinitialiser
            </Button>
          ) : null}

          <div className="flex-1" />

          <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
            <span className="whitespace-nowrap">Trier</span>
            <Select
              aria-label="Trier les cartes"
              className="h-8 w-[190px] rounded-full text-[12.5px]"
              value={sort}
              onChange={(e) => setSort(e.target.value as BoardSort)}
            >
              {Object.entries(BOARD_SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </label>
        </div>
      </header>

      {transition.bannerError ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-[12.5px] text-destructive"
        >
          <span className="min-w-0 flex-1">{transition.bannerError}</span>
          <button
            type="button"
            onClick={transition.dismissError}
            className="rounded p-0.5 hover:bg-destructive/10"
          >
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Masquer l'erreur</span>
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-x-auto bg-muted/40 px-5 py-4">
        {board.isError ? (
          <p className="text-sm text-muted-foreground">
            Les demandes n'ont pas pu être chargées.{" "}
            <button type="button" className="underline" onClick={board.refetch}>Réessayer</button>
          </p>
        ) : (
          <div className="flex h-full min-w-max gap-3.5">
            {content.columns.map(({ column, cards: columnCards }) => {
              const droppable = drag !== null && drag.targets.has(column.status);
              const refused = drag !== null && !droppable;
              return (
                <section
                  key={column.status}
                  aria-label={`${column.label} — ${columnCards.length} demande${columnCards.length > 1 ? "s" : ""}`}
                  title={drag && refused ? refusalHint(drag.card, column.status) : undefined}
                  onDragOver={(e) => {
                    if (!droppable) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (over !== column.status) setOver(column.status);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    setOver((o) => (o === column.status ? null : o));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const spec = drag?.targets.get(column.status);
                    const card = drag?.card;
                    endDrag();
                    if (card && spec) transition.start(card, spec);
                  }}
                  className={cn(
                    "flex h-full w-[286px] shrink-0 flex-col gap-2 rounded-[14px] border-[1.5px] border-transparent bg-muted p-[11px]",
                    "transition-colors",
                    droppable && "border-dashed border-primary/50 bg-primary/[0.06]",
                    droppable && over === column.status && "border-primary bg-primary/[0.12]",
                    refused && "opacity-50",
                  )}
                >
                  <div className="flex items-center gap-2 px-0.5">
                    <StatusBadge status={column.status} size="md" />
                    <span className="flex-1" />
                    <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                      {columnCards.length}
                    </span>
                  </div>
                  <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
                    {column.hint}
                    {column.recent ? ` · ${CLOSED_WINDOW_DAYS} derniers jours` : ""}
                  </p>

                  <div className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto pr-0.5">
                    {columnCards.map((card) => (
                      <BoardCard
                        key={card.id}
                        card={card}
                        targets={targetsOf(card)}
                        pending={transition.pendingId === card.id}
                        dragging={drag?.card.id === card.id}
                        onDragStart={() => setDrag({ card, targets: targetsOf(card) })}
                        onDragEnd={endDrag}
                        onTransition={(spec) => transition.start(card, spec)}
                      />
                    ))}
                    {columnCards.length === 0 ? (
                      <p className="rounded-[11px] border border-dashed border-input px-3 py-4 text-center text-[12px] leading-relaxed text-muted-foreground">
                        {board.isLoading
                          ? "Chargement…"
                          : nFilters > 0
                            ? "Aucune demande ne correspond aux filtres"
                            : "Aucune demande"}
                      </p>
                    ) : null}
                  </div>

                  {column.recent && columnCards.length > 0 ? (
                    <Link
                      to={`/demandes?status=${column.status}`}
                      className="px-0.5 text-[11px] font-semibold text-primary hover:underline"
                    >
                      Voir toutes les demandes « {column.label} »
                    </Link>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}

        {content.orphans.length > 0 ? (
          <p role="status" className="mt-3 text-[12px] text-muted-foreground">
            {content.orphans.length} demande{content.orphans.length > 1 ? "s" : ""} porte
            {content.orphans.length > 1 ? "nt" : ""} un statut inconnu de cet écran — elle
            {content.orphans.length > 1 ? "s restent" : " reste"} accessible
            {content.orphans.length > 1 ? "s" : ""} depuis la liste.
          </p>
        ) : null}
      </div>

      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2.5",
          "rounded-xl border border-border bg-card px-4 py-2.5 shadow-airbnb-xl transition-all duration-200",
          toast.visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
      >
        <Check className="size-4 text-primary" aria-hidden="true" />
        <span className="text-[13px] font-semibold">{toast.text}</span>
      </div>

      <TransitionDialog
        runner={transition.runner}
        subtitle={
          transition.card ? `${transition.card.reference} — ${transition.card.subject}` : undefined
        }
        members={(eligible.data ?? []).map((row) => ({
          userId: row.user_id,
          role: "",
          displayName: row.display_name,
          email: row.email,
        }))}
      />
    </div>
  );
}

interface FacetFilterProps {
  label: string;
  /** Nom au singulier, accordé selon le nombre de valeurs cochées (« 1 agent », « 3 agents »). */
  noun: string;
  options: CountedOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}

/** Pastille de filtre à cases — même motif que les filtres de la carte. */
function FacetFilter({ label, noun, options, selected, onToggle, onClear }: FacetFilterProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      align="left"
      menuClassName="max-h-[320px] overflow-auto"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors",
            selected.length > 0
              ? "border-primary/30 bg-primary/[0.07] text-primary"
              : "border-border bg-background hover:bg-secondary",
          )}
        >
          {selected.length > 0
            ? `${selected.length} ${noun}${selected.length > 1 ? "s" : ""}`
            : label}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      )}
    >
      <DropdownLabel>{label} ({options.length})</DropdownLabel>
      {options.length === 0 ? (
        <span className="px-2 py-1.5 text-[12px] text-muted-foreground">Aucune valeur</span>
      ) : null}
      {options.map((option) => {
        const checked = selected.includes(option.value);
        return (
          <DropdownItem
            key={option.value}
            role="menuitemcheckbox"
            aria-checked={checked}
            active={checked}
            onClick={() => onToggle(option.value)}
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
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <span className="text-[11px] text-muted-foreground">{option.count}</span>
          </DropdownItem>
        );
      })}
      {selected.length > 0 ? (
        <>
          <DropdownDivider />
          <DropdownItem onClick={onClear}>Tout afficher</DropdownItem>
        </>
      ) : null}
    </Dropdown>
  );
}
