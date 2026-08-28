// Carte des interventions : la mosaïque de tuiles (brique partagée), une
// épingle par demande située — colorée par l'urgence — et la fiche de survol
// qui donne l'essentiel avant d'ouvrir la demande.
//
// Toute la géométrie (recadrage, projection, déplacement) vient de
// `src/lib/carto.ts` et le placement des épingles/fiches de `carte.ts` : ce
// composant ne fait que rendre et écouter la souris.

import * as React from "react";
import { Link } from "react-router-dom";
import { Crosshair, Minus, Plus, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TileLayer, useElementSize } from "@/components/map/TileLayer";
import { QuartierLayer } from "@/components/map/QuartierLayer";
import type { QuartierShape } from "@/lib/quartiers";
import {
  clampZoom,
  fitBounds,
  markerPosition,
  panView,
  type GeoPoint,
} from "@/lib/carto";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import { cardAnchor, locationHint, mapCard, spreadByPoint, type LocatedRequest } from "./carte";

export interface MapMarker {
  item: LocatedRequest;
  point: GeoPoint;
}

/** Ramp d'urgence : jaune (normale) → orange (haute) → rouge (urgente). */
const PIN_COLOR: Record<string, string> = {
  urgente: "bg-destructive",
  haute: "bg-warning",
  normale: "bg-secondary",
  basse: "bg-muted-foreground",
};

export function pinColor(priority: string): string {
  return PIN_COLOR[priority] ?? "bg-muted-foreground";
}

const CARD = { width: 320, height: 330 };
/** Une épingle un peu hors cadre reste rendue (fiche ouverte pendant un déplacement). */
const OFF_SCREEN_MARGIN = 60;

interface Props {
  markers: MapMarker[];
  nameOf: (userId: string | null) => string;
  /** Découpage du territoire (référentiel Socle) — vide s'il n'en publie pas. */
  quartiers?: QuartierShape[];
  showQuartiers?: boolean;
}

export function InterventionMap({ markers, nameOf, quartiers = [], showQuartiers = true }: Props) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const [center, setCenter] = React.useState<{ lat: number; lon: number; zoom: number } | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [pinned, setPinned] = React.useState(false);
  const closeTimer = React.useRef<number | undefined>(undefined);
  const drag = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const signature = markers.map((m) => m.item.row.id).join(",");
  const recenter = React.useCallback(() => {
    if (width === 0 || height === 0) return;
    setCenter(fitBounds(markers.map((m) => m.point), width, height));
    // `markers` suit `signature` : recadrer sur la sélection affichée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, width, height]);

  // Recadrage automatique à l'arrivée des points et à chaque changement de
  // filtre ; ensuite l'agent est maître de sa vue (bouton « Recadrer »).
  React.useEffect(() => recenter(), [recenter]);

  React.useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Molette : listener natif non passif, sinon le navigateur ignore la roue.
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setCenter((c) => (c ? { ...c, zoom: clampZoom(c.zoom + (event.deltaY < 0 ? 1 : -1)) } : c));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [ref]);

  React.useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActive(null);
      setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);

  const offsets = React.useMemo(
    () =>
      spreadByPoint(
        markers.map((m) => ({
          id: m.item.row.id,
          pointKey: `${m.point.lat.toFixed(5)},${m.point.lon.toFixed(5)}`,
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  function show(id: string) {
    window.clearTimeout(closeTimer.current);
    if (!pinned) setActive(id);
  }
  function scheduleHide() {
    if (pinned) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setActive(null), 160);
  }

  const view = center ? { ...center, width, height } : null;
  const placed = view
    ? markers.map((marker) => {
        const base = markerPosition(marker.point, view);
        const offset = offsets[marker.item.row.id] ?? { dx: 0, dy: 0 };
        return { marker, left: base.left + offset.dx, top: base.top + offset.dy };
      })
    : [];
  const activePin = placed.find((p) => p.marker.item.row.id === active) ?? null;

  return (
    <div
      ref={ref}
      className="relative h-full w-full touch-none overflow-hidden bg-muted"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || !view) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (dx === 0 && dy === 0) return;
        current.x = event.clientX;
        current.y = event.clientY;
        current.moved = true;
        setCenter((c) => (c ? { ...c, ...panView({ ...c, width, height }, dx, dy) } : c));
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
      }}
      onPointerCancel={() => { drag.current = null; }}
    >
      {view ? <TileLayer view={view} /> : null}

      {/* Sous les épingles : les quartiers situent les demandes, ils ne les
          cachent pas. Le recadrage suit les DEMANDES, jamais les quartiers —
          c'est la sélection filtrée qu'on vient regarder. */}
      {view && showQuartiers ? <QuartierLayer quartiers={quartiers} view={view} /> : null}

      {placed.map(({ marker, left, top }) => {
        if (
          left < -OFF_SCREEN_MARGIN || top < -OFF_SCREEN_MARGIN ||
          left > width + OFF_SCREEN_MARGIN || top > height + OFF_SCREEN_MARGIN
        ) {
          return null;
        }
        const row = marker.item.row;
        const current = row.id === active;
        return (
          <button
            key={row.id}
            type="button"
            style={{ left, top }}
            className={cn(
              "absolute z-10 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-airbnb-md transition-transform",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              pinColor(row.priority),
              current && "z-20 scale-[1.35]",
            )}
            aria-label={`${row.reference} — ${row.subject}`}
            onMouseEnter={() => show(row.id)}
            onMouseLeave={scheduleHide}
            onFocus={() => show(row.id)}
            onClick={() => {
              if (drag.current?.moved) return;
              setPinned(active === row.id ? !pinned : true);
              setActive(row.id);
            }}
          />
        );
      })}

      {activePin ? (
        <RequestCard
          marker={activePin.marker}
          nameOf={nameOf}
          anchor={cardAnchor({ left: activePin.left, top: activePin.top }, { width, height }, CARD)}
          pinned={pinned}
          onEnter={() => window.clearTimeout(closeTimer.current)}
          onLeave={scheduleHide}
          onClose={() => { setPinned(false); setActive(null); }}
        />
      ) : null}

      <div className="absolute right-3 top-3 z-30 flex flex-col gap-1">
        <MapButton label="Zoomer" onClick={() => setCenter((c) => (c ? { ...c, zoom: clampZoom(c.zoom + 1) } : c))}>
          <Plus aria-hidden="true" />
        </MapButton>
        <MapButton label="Dézoomer" onClick={() => setCenter((c) => (c ? { ...c, zoom: clampZoom(c.zoom - 1) } : c))}>
          <Minus aria-hidden="true" />
        </MapButton>
        <MapButton label="Recadrer sur les demandes affichées" onClick={recenter}>
          <Crosshair aria-hidden="true" />
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({ label, onClick, children }: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className="flex size-8 items-center justify-center rounded-lg border border-border bg-card/95 shadow-airbnb-sm transition-colors hover:bg-secondary [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

function RequestCard({ marker, nameOf, anchor, pinned, onEnter, onLeave, onClose }: {
  marker: MapMarker;
  nameOf: (userId: string | null) => string;
  anchor: { left: number; top: number };
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const row = marker.item.row;
  const card = mapCard(marker.item, row.assigned_to ? nameOf(row.assigned_to) : null);
  const hint = locationHint(marker.point);

  return (
    <article
      style={{ left: anchor.left, top: anchor.top, width: CARD.width }}
      className="absolute z-30 flex flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-xl"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11.5px] font-bold tracking-wide">{card.reference}</span>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={card.status} />
          {pinned ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer la fiche"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <p className="line-clamp-2 text-[13.5px] font-bold leading-snug">{card.subject}</p>

      <div className="text-[11.5px] leading-snug text-muted-foreground">
        {card.address.map((line) => (
          <span key={line} className="block">{line}</span>
        ))}
        {hint ? (
          <span className="mt-1 inline-flex items-center gap-1 font-semibold text-warning">
            <TriangleAlert className="size-3" aria-hidden="true" /> {hint}
          </span>
        ) : null}
      </div>

      <dl className="flex flex-col gap-1 border-t border-border pt-2">
        {card.rows.map((detail) => (
          <div key={detail.label} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-[11px] font-semibold text-muted-foreground">{detail.label}</dt>
            <dd className="min-w-0 truncate text-right text-[12px] font-semibold">
              {detail.label === "Urgence" ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", pinColor(card.priorityKey))} aria-hidden="true" />
                  {detail.value}
                </span>
              ) : (
                detail.value
              )}
            </dd>
          </div>
        ))}
      </dl>

      <Button asChild size="sm" className="w-full">
        <Link to={`/demandes/${card.id}`}>Ouvrir la fiche</Link>
      </Button>
    </article>
  );
}
