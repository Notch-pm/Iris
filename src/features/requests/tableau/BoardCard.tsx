// Carte d'une demande sur le tableau. Deux chemins vers la même transition :
// le glisser-déposer (souris) et le menu d'actions (clavier, et lecteur
// d'écran) — le premier ne doit jamais être le seul.
//
// Une carte que la garde SQL ne laisserait bouger nulle part n'est pas
// « draggable » : mieux vaut ne pas inviter au geste que le refuser après coup.

import * as React from "react";
import { Link } from "react-router-dom";
import { Building2, ChevronsUpDown, ExternalLink, GripVertical } from "lucide-react";
import { Dropdown, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import { Avatar } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { pinColor } from "../carte/InterventionMap";
import { STATUS_LABELS, type RequestStatus, type TransitionSpec } from "../statuts";
import type { BoardCardView } from "./tableau";

interface Props {
  card: BoardCardView;
  /** Transitions que la garde acceptera pour cette demande, par statut d'arrivée. */
  targets: Map<RequestStatus, TransitionSpec>;
  /** Transition en cours d'application sur cette demande. */
  pending: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onTransition: (spec: TransitionSpec) => void;
}

export function BoardCard({
  card, targets, pending, dragging, onDragStart, onDragEnd, onTransition,
}: Props) {
  const [menu, setMenu] = React.useState(false);
  const specs = [...targets.values()];
  const movable = specs.length > 0 && !pending;
  // L'urgence porte la même couleur que sur la carte des interventions.
  const urgent = card.priority.tone !== "muted";

  return (
    <article
      draggable={movable}
      onDragStart={(e) => {
        // `setData` est exigé par Firefox pour qu'un déplacement démarre.
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        setMenu(false);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      aria-label={`${card.reference} — ${card.subject} (${STATUS_LABELS[card.status]})`}
      className={cn(
        "group relative flex gap-[9px] rounded-xl border border-border bg-card p-[11px] shadow-airbnb-sm",
        "transition-[box-shadow,border-color,opacity] hover:border-border hover:shadow-airbnb-md",
        movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        pending && "pointer-events-none opacity-60",
      )}
    >
      <span
        className={cn("w-1 shrink-0 self-stretch rounded-full", pinColor(card.priority.key))}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] font-bold tracking-[0.03em] text-muted-foreground">
            {card.reference}
          </span>
          {urgent ? (
            <span
              className={cn(
                "shrink-0 rounded-full px-[7px] py-[2px] text-[10px] font-bold",
                card.priority.tone === "danger"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-secondary/40 text-secondary-foreground",
              )}
            >
              {card.priority.label}
            </span>
          ) : null}
          <span className="flex-1" />
          {pending ? (
            <span className="text-[10.5px] font-semibold text-muted-foreground">Application…</span>
          ) : null}
          <Dropdown
            open={menu}
            onOpenChange={setMenu}
            align="right"
            portal
            menuClassName="min-w-[228px] max-h-[300px] overflow-auto"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                disabled={specs.length === 0}
                title={
                  specs.length === 0
                    ? "Aucune transition ouverte sur cette demande"
                    : "Changer l'état de la demande"
                }
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors",
                  "hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent",
                  !menu && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
                )}
              >
                <ChevronsUpDown className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Changer l'état de {card.reference}</span>
              </button>
            )}
          >
            <DropdownLabel>Déplacer vers</DropdownLabel>
            {specs.map((spec) => (
              <DropdownItem
                key={spec.to}
                onClick={() => {
                  setMenu(false);
                  onTransition(spec);
                }}
              >
                {/* Le geste, puis la colonne où la carte atterrira — empilés :
                    côte à côte, le menu dépasserait la largeur d'une colonne. */}
                <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span>{spec.label}</span>
                  <span className="text-[10.5px] font-semibold text-muted-foreground">
                    → {STATUS_LABELS[spec.to]}
                  </span>
                </span>
              </DropdownItem>
            ))}
          </Dropdown>
          <Link
            to={`/demandes/${card.id}`}
            title="Ouvrir la fiche"
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors",
              "hover:bg-secondary hover:text-foreground",
              "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Ouvrir la fiche de {card.reference}</span>
          </Link>
        </div>

        <Link
          to={`/demandes/${card.id}`}
          className="text-[13.5px] font-bold leading-[1.35] text-foreground hover:underline"
        >
          {card.subject}
        </Link>

        {/* L'ORGANISME qui traite la demande — l'information de routage, donc sa
            place est sous l'objet, avant la démarche et la date. Sur sa propre
            ligne et non dans la rangée de pastilles : une colonne fait 286 px,
            un troisième élément y passerait à la ligne la plupart du temps.
            Le `title` sert aux libellés tronqués, fréquents à cette largeur.
            « Sans organisme » s'affiche AUSSI — c'est l'anomalie
            `destinataire_inconnu`, elle mérite d'être vue, pas masquée. */}
        <span
          title={`Organisme : ${card.destinataireLabel}`}
          className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"
        >
          <Building2 className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{card.destinataireLabel}</span>
        </span>

        <div className="flex flex-wrap items-center gap-2">
          {card.showProcedure ? (
            <span className="truncate rounded-full bg-muted px-2 py-[2px] text-[10.5px] font-semibold text-muted-foreground">
              {card.procedureLabel}
            </span>
          ) : null}
          <span className="text-[11px] text-muted-foreground">déposée le {card.deposited}</span>
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-2">
          <Avatar initials={card.usagerInitials} size="sm" muted />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{card.usager}</span>
          <span title={card.assignedTo ? `Affectée à ${card.agentLabel}` : "Non affectée"}>
            {card.assignedTo ? (
              <Avatar initials={card.agentInitials} size="sm" />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-input text-[9px] font-extrabold text-muted-foreground"
              >
                ?
              </span>
            )}
            <span className="sr-only">
              {card.assignedTo ? `Affectée à ${card.agentLabel}` : "Non affectée"}
            </span>
          </span>
        </div>
      </div>

      {movable ? (
        <GripVertical
          className="pointer-events-none absolute right-[3px] top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-40"
          aria-hidden="true"
        />
      ) : null}
    </article>
  );
}
