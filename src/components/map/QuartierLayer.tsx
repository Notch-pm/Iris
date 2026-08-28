// Couche des quartiers au-dessus d'une mosaïque de tuiles — brique partagée
// par la carte de contrôle d'un champ d'adresse et la carte des interventions.
//
// Le remplissage reste LÉGER : la carte doit rester lisible dessous. C'est le
// TRAIT qui porte l'information, puisque la question posée est « de quel côté
// de la limite suis-je ? ».
//
// Toute la géométrie vit dans `src/lib/quartiers.ts` (pure, testée) ; ce
// composant ne fait que projeter. Il est `pointer-events-none` : les épingles
// et le déplacement de la carte restent atteignables au travers.

import { markerPosition, type MapView } from "@/lib/carto";
import { quartierLabelPoint, type QuartierShape } from "@/lib/quartiers";

/** Couleur de repli quand le référentiel n'en donne pas. */
const NEUTRAL = "#64748b";

interface Props {
  quartiers: QuartierShape[];
  view: MapView;
  /** Poser le nom de chaque quartier en son centre (inutile sur une vignette). */
  labels?: boolean;
}

export function QuartierLayer({ quartiers, view, labels = true }: Props) {
  if (quartiers.length === 0 || view.width <= 0 || view.height <= 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={view.width}
      height={view.height}
      aria-hidden="true"
    >
      {quartiers.map((quartier) => {
        const color = quartier.color ?? NEUTRAL;
        return quartier.rings.map((ring, index) => {
          const path = ringPath(ring, view);
          if (path === "") return null;
          return (
            <path
              key={`${quartier.id}-${index}`}
              d={path}
              fill={color}
              fillOpacity={0.1}
              stroke={color}
              strokeWidth={2.5}
              strokeOpacity={0.95}
              strokeLinejoin="round"
            />
          );
        });
      })}

      {labels
        ? quartiers.map((quartier) => {
            const point = quartierLabelPoint(quartier);
            if (!point || quartier.name === "") return null;
            const { left, top } = markerPosition(point, view);
            // Hors cadre : ne rien dessiner plutôt qu'une étiquette collée au bord,
            // qui désignerait un quartier que l'agent ne voit pas.
            if (left < 0 || top < 0 || left > view.width || top > view.height) return null;
            return (
              <text
                key={`label-${quartier.id}`}
                x={left}
                y={top}
                textAnchor="middle"
                dominantBaseline="middle"
                // Halo blanc sous le texte : lisible sur n'importe quelle tuile.
                stroke="#fff"
                strokeWidth={3}
                strokeLinejoin="round"
                paintOrder="stroke"
                fill={quartier.color ?? NEUTRAL}
                style={{ font: "700 11px var(--font-sans)" }}
              >
                {quartier.name}
              </text>
            );
          })
        : null}
    </svg>
  );
}

/**
 * Anneau géographique → tracé SVG dans le conteneur. Réutilise la projection de
 * `markerPosition` : un quartier et une épingle tombent ainsi exactement au
 * même endroit, par construction.
 */
function ringPath(ring: { lat: number; lon: number }[], view: MapView): string {
  if (ring.length < 3) return "";
  const points = ring.map((vertex) => {
    const { left, top } = markerPosition(vertex, view);
    return `${left.toFixed(1)},${top.toFixed(1)}`;
  });
  return `M${points.join("L")}Z`;
}
