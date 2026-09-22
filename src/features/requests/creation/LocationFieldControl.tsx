// Le champ « Lieu d'intervention » d'une démarche (type `location`, Socle
// 1.29.0), saisi par un agent : une adresse sur une ligne, complétée par la
// BAN, et la carte de contrôle sous le champ.
//
// Ce qui s'écrit, c'est la forme du contrat — `{ address, lat, lon, precision,
// adjusted }` :
//   - une proposition retenue → son libellé et SON point, `adjusted: false` ;
//   - une saisie libre → l'adresse tapée, sans point (lat/lon nuls).
// Le point GÉOCODÉ que la carte montre sous une saisie libre n'est jamais
// écrit : Iris ne fabrique pas de coordonnée, il enregistre ce que la BAN a
// proposé et ce que l'agent a retenu. Pas de marqueur déplaçable ici non plus :
// l'ajustement à 150 m est un savoir de l'usager, sur place, sur le portail —
// un point posé par un agent depuis son bureau serait une invention.
//
// Retaper l'adresse d'une demande existante remet le point à zéro : c'est dit
// dans le dialogue d'édition, et c'est le seul comportement honnête.

import { AddressField } from "@/components/address/AddressField";
import { useQuartiers } from "@/features/socle/useQuartiers";
import { useTenant } from "@/features/tenant/TenantProvider";
import {
  locationAddressText,
  type LocationField,
  type LocationValue,
} from "@fn/create-request-from-procedure/_shared/procedureForm";

interface Props {
  field: LocationField;
  value: unknown;
  onChange: (value: LocationValue | undefined) => void;
  error?: string;
}

export function LocationFieldControl({ field, value, onChange, error }: Props) {
  const { current: tenant } = useTenant();
  const { quartiers } = useQuartiers(tenant?.organizationId ?? "");
  // ⚠️ Ce qui s'affiche est lu de la valeur BRUTE (`locationAddressText`),
  // jamais de `parseLocationValue` (qui rogne) : sans cela, l'espace serait
  // intapable — elle disparaîtrait à l'instant où elle est frappée.

  return (
    <AddressField
      id={`pf-${field.id}`}
      label={field.label}
      required={field.required === true}
      hint={field.help}
      error={error}
      singleLine
      quartiers={quartiers}
      value={{ line: locationAddressText(value), postcode: "", city: "" }}
      onChange={(next, suggestion) => {
        if (suggestion) {
          onChange({
            address: suggestion.label,
            lat: suggestion.lat,
            lon: suggestion.lon,
            precision: suggestion.precision,
            adjusted: false,
          });
          return;
        }
        // Champ vidé = plus de réponse ; tout le reste est gardé tel quel, y
        // compris une saisie encore blanche (la frontière la tiendra pour vide).
        onChange(
          next.line === ""
            ? undefined
            : { address: next.line, lat: null, lon: null, precision: null, adjusted: false },
        );
      }}
    />
  );
}
