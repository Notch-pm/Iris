// Bloc « Lieu d'intervention » de l'onglet Résumé : l'adresse saisie dans le
// formulaire de la démarche, une carte OpenStreetMap centrée dessus et le
// bouton « Guider » (itinéraire Google Maps, nouvel onglet).
//
// La carte est un CONFORT : l'adresse et l'itinéraire restent disponibles même
// si le géocodage ou les tuiles ne répondent pas. Attribution OpenStreetMap
// obligatoire (ODbL) — ne pas la retirer.

import * as React from "react";
import { Minus, Navigation, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill, Surface, SurfaceHead } from "@/components/ui/surface";
import { TileLayer, useElementSize } from "@/components/map/TileLayer";
import {
  clampZoom,
  DEFAULT_ZOOM,
  googleMapsDirectionsUrl,
  openStreetMapUrl,
  PRECISION_LABELS,
  zoomForPrecision,
  type GeoPoint,
} from "@/lib/carto";
import type { InterventionLocation } from "./lieu";
import { useGeocode } from "./useGeocode";

const MAP_HEIGHT = 220;

export function LieuIntervention({ lieu }: { lieu: InterventionLocation }) {
  const geocode = useGeocode(lieu.query, lieu.postcode);
  const point = geocode.data ?? null;
  const [zoomShift, setZoomShift] = React.useState(0);
  const baseZoom = point ? zoomForPrecision(point.precision) : DEFAULT_ZOOM;
  const zoom = clampZoom(baseZoom + zoomShift);
  const itinerary = googleMapsDirectionsUrl(lieu.query);

  // Nouvelle adresse localisée → on repart du zoom adapté à sa finesse.
  React.useEffect(() => setZoomShift(0), [point?.lat, point?.lon]);

  return (
    <Surface>
      <SurfaceHead
        title={lieu.title}
        sub="Adresse renseignée dans le formulaire de la démarche"
        action={
          itinerary ? (
            <Button asChild variant="outline" size="sm">
              <a href={itinerary} target="_blank" rel="noreferrer">
                <Navigation aria-hidden="true" /> Guider
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              aria-disabled="true"
              title="Aucune adresse à guider"
            >
              <Navigation aria-hidden="true" /> Guider
            </Button>
          )
        }
      />

      {lieu.empty ? (
        <p className="text-sm text-muted-foreground">
          La démarche pose la question, mais aucune adresse n'a été renseignée au dépôt.
        </p>
      ) : (
        <>
          <address className="flex flex-col gap-0.5 not-italic">
            {lieu.lines.map((line) => (
              <span key={line} className="text-[13.5px] font-semibold leading-snug">{line}</span>
            ))}
            {lieu.details.map((detail) => (
              <span key={detail.label} className="text-xs text-muted-foreground">
                {detail.label} : <span className="font-semibold text-foreground">{detail.value}</span>
              </span>
            ))}
          </address>

          {lieu.query === "" ? (
            <MapPlaceholder>
              Adresse incomplète (ni voie ni commune) : ni carte ni itinéraire possibles.
            </MapPlaceholder>
          ) : geocode.isLoading ? (
            <MapPlaceholder>Localisation de l'adresse…</MapPlaceholder>
          ) : geocode.isError ? (
            <MapPlaceholder
              action={
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                  onClick={() => void geocode.refetch()}>
                  Réessayer
                </Button>
              }
            >
              Carte indisponible : le service de localisation n'a pas répondu.
            </MapPlaceholder>
          ) : !point ? (
            <MapPlaceholder>
              Adresse non localisée — l'itinéraire reste possible depuis l'adresse saisie.
            </MapPlaceholder>
          ) : (
            <>
              <MapCanvas point={point} zoom={zoom} onZoom={(step) => setZoomShift((s) => s + step)} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Pill tone={point.precision === "adresse" ? "ok" : "pending"}>
                  {PRECISION_LABELS[point.precision]}
                </Pill>
                <a
                  href={openStreetMapUrl(point.lat, point.lon, zoom)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Ouvrir dans OpenStreetMap
                </a>
              </div>
            </>
          )}
        </>
      )}
    </Surface>
  );
}

function MapPlaceholder({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground"
      style={{ height: MAP_HEIGHT }}
    >
      {children}
      {action}
    </div>
  );
}

/**
 * Carte statique composée des tuiles OpenStreetMap : le point est au centre
 * exact du conteneur (cf. `mapTiles`), le marqueur pointe donc sur ce centre.
 * Pas de déplacement à la souris — « Ouvrir dans OpenStreetMap » prend le
 * relais pour explorer les environs.
 */
function MapCanvas({ point, zoom, onZoom }: {
  point: GeoPoint;
  zoom: number;
  onZoom: (step: number) => void;
}) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();

  return (
    <div
      ref={ref}
      role="img"
      aria-label={`Carte du lieu d'intervention${point.label ? ` : ${point.label}` : ""}`}
      className="relative overflow-hidden rounded-xl border border-border bg-muted"
      style={{ height: MAP_HEIGHT }}
    >
      <TileLayer view={{ lat: point.lat, lon: point.lon, zoom, width, height }} />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-airbnb-md ring-[3px] ring-background"
      />

      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <ZoomButton label="Zoomer" onClick={() => onZoom(1)}><Plus aria-hidden="true" /></ZoomButton>
        <ZoomButton label="Dézoomer" onClick={() => onZoom(-1)}><Minus aria-hidden="true" /></ZoomButton>
      </div>
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
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-lg border border-border bg-card/95 shadow-airbnb-sm transition-colors hover:bg-secondary [&_svg]:size-4"
    >
      {children}
    </button>
  );
}
