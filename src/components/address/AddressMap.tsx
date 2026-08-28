// Carte de contrôle sous un champ d'adresse : là où l'adresse saisie est
// tombée, et — quand le référentiel les fournit — les quartiers du territoire.
//
// C'est un CONFORT de vérification, pas une saisie : le point n'est ni
// déplaçable ni stocké. Iris ne conserve aucune coordonnée (doctrine
// cartographique du `CLAUDE.md` racine) ; tout ce qui est enregistré, c'est
// l'adresse. Un point qu'on pourrait bouger sans que rien ne le retienne
// mentirait sur ce que le formulaire garde.
//
// La mosaïque et son attribution ODbL viennent de `TileLayer` — obligatoire,
// ne pas la retirer.

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { TileLayer, useElementSize } from "@/components/map/TileLayer";
import { cn } from "@/lib/utils";
import {
  clampZoom, PRECISION_LABELS, zoomForPrecision,
  type GeoPoint, type MapView,
} from "@/lib/carto";
import { quartierAt, type QuartierShape } from "@/lib/quartiers";
import { QuartierLayer } from "@/components/map/QuartierLayer";

interface Props {
  /**
   * Point à montrer. NON NULLABLE à dessein : l'appelant ne monte la carte que
   * lorsqu'il en a un. `useElementSize` mesure au montage — un conteneur qui
   * n'existe pas au premier rendu n'est jamais mesuré, et la mosaïque reste
   * vide pour toujours (vécu en navigateur le 2026-08-28).
   */
  point: GeoPoint;
  /** Quartiers à superposer — absents tant que le référentiel ne les expose pas. */
  quartiers?: QuartierShape[];
  height?: number;
  /** Chargement en cours : la carte reste, on ne la fait pas clignoter. */
  pending?: boolean;
  className?: string;
}

const DEFAULT_HEIGHT = 200;
const NEUTRAL = "#64748b";

export function AddressMap({ point, quartiers = [], height = DEFAULT_HEIGHT, pending, className }: Props) {
  const { ref, width, height: measured } = useElementSize<HTMLDivElement>();
  const [zoomShift, setZoomShift] = React.useState(0);

  // Nouvelle adresse localisée → on repart du zoom adapté à sa finesse
  // (même règle que le bloc « Lieu d'intervention » d'une fiche).
  React.useEffect(() => setZoomShift(0), [point.lat, point.lon]);

  const zoom = clampZoom(zoomForPrecision(point.precision) + zoomShift);
  const here = quartierAt(point, quartiers);
  const view: MapView = { lat: point.lat, lon: point.lon, zoom, width, height: measured };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        ref={ref}
        style={{ height }}
        className={cn(
          "relative overflow-hidden rounded-xl border border-border bg-muted transition-opacity",
          pending && "opacity-60",
        )}
      >
        <TileLayer view={view} />

        {/* Quartiers sous le marqueur : ils situent, ils ne masquent pas.
            Sans étiquette ici — le nom du quartier qui contient l'adresse est
            dit en toutes lettres sous la carte, et sur 200 px il vaut mieux
            une carte lisible qu'un nom de plus. */}
        <QuartierLayer quartiers={quartiers} view={view} labels={false} />

        {/* Le point demandé tombe au centre exact du conteneur (cf. `mapTiles`). */}
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary-foreground bg-primary shadow-airbnb-md"
        />

        <div className="absolute right-1.5 top-1.5 z-10 flex flex-col gap-1">
          <ZoomButton label="Zoom avant" onClick={() => setZoomShift((s) => s + 1)}>
            <Plus className="size-3.5" aria-hidden="true" />
          </ZoomButton>
          <ZoomButton label="Zoom arrière" onClick={() => setZoomShift((s) => s - 1)}>
            <Minus className="size-3.5" aria-hidden="true" />
          </ZoomButton>
        </div>
      </div>

      {/* Le géocodeur rend TOUJOURS un candidat : on affiche sa réserve plutôt
          que de laisser croire que le point est exact. Même vocabulaire que la
          carte des interventions. */}
      <p className="text-[11px] text-muted-foreground">
        {PRECISION_LABELS[point.precision]}
        {point.label ? ` — ${point.label}` : ""}
      </p>

      {/* Ce qui donne son sens à la couche : quel quartier du découpage
          contient cette adresse. Vérifié contre `ST_Contains` du Socle le
          2026-08-28 — même verdict.
          ⚠️ Ce n'est PAS forcément le quartier affiché sur la fiche de
          l'usager : celui-là peut avoir été FORCÉ à la main (`quartier_auto =
          false` côté Socle), et la fiche montre alors le rattachement retenu,
          pas la géographie. D'où « d'après les limites du référentiel », qui
          dit d'où vient CE verdict-ci, plutôt qu'un « à confirmer » qui
          laisserait croire à une contradiction. */}
      {quartiers.length > 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {here ? (
            <>
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: here.color ?? NEUTRAL }}
              />
              <span>
                Quartier <span className="font-semibold text-foreground">{here.name}</span>
                {" "}— d'après les limites du référentiel
              </span>
            </>
          ) : (
            <span>Hors des quartiers du territoire</span>
          )}
        </p>
      ) : null}
    </div>
  );
}

function ZoomButton({ label, onClick, children }: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
