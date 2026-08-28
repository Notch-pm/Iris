// Champ « Adresse » assisté : une ligne unique qui propose, une carte qui
// montre où l'adresse est tombée, et un dépliant pour les précisions d'accès.
//
// TROIS RÈGLES, dans cet ordre :
//  1. **Il propose, il ne garde pas la porte.** Retenir une proposition est
//     toujours facultatif : le texte libre est conservé tel quel, et « Adresse
//     introuvable ? » ouvre la saisie manuelle. La BAN ignore les adresses
//     neuves, les lieux-dits mal nommés et tout ce qui n'est pas en France.
//  2. **Le clavier fait tout.** ↑ ↓ pour parcourir, Entrée choisit ET NE SOUMET
//     PAS le formulaire, Échap ferme — motif éprouvé de `MentionTextarea`.
//  3. **Iris n'invente aucun champ.** Les deux contrats d'adresse appartiennent
//     au Socle et n'ont pas les mêmes clés : le dépliant montre ce que le
//     contexte porte (`extras`), fourni par l'appelant, et rien d'autre.

import * as React from "react";
import { ChevronDown, LocateFixed, Search } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useGeocode } from "@/components/map/useGeocode";
import { MIN_QUERY_LENGTH, suggestionContext, type AddressSuggestion } from "@/lib/adresse";
import { PRECISION_LABELS, type GeoPoint } from "@/lib/carto";
import type { QuartierShape } from "@/lib/quartiers";
import { AddressMap } from "./AddressMap";
import {
  browserPosition, reverseGeocode, reverseGeocodingAvailable, useAddressSuggestions,
} from "./useAddressSuggestions";

/** Ce que la ligne unique porte, quel que soit le contrat de destination. */
export interface AddressValue {
  /** Numéro + voie — « 10 bis Avenue de Frémeur ». */
  line: string;
  postcode: string;
  city: string;
}

/** Champ d'appoint du dépliant : ce que le contrat porte, nommé par l'appelant. */
export interface AddressExtra {
  key: string;
  label: string;
  value: string;
  maxLength?: number;
  hint?: string;
}

interface Props {
  id: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  value: AddressValue;
  /**
   * `suggestion` est non nulle quand la valeur vient de la liste : l'appelant
   * en tire les clés propres à SON contrat (numéro/BTQ/voie séparés, par
   * exemple). Elle est nulle sur une saisie libre.
   */
  onChange: (next: AddressValue, suggestion: AddressSuggestion | null) => void;
  extras?: AddressExtra[];
  onExtraChange?: (key: string, value: string) => void;
  /** Assistance BAN — à retirer hors de France, que le référentiel ne couvre pas. */
  assisted?: boolean;
  /** Carte de contrôle sous le champ (à couper dans les formulaires denses). */
  showMap?: boolean;
  /**
   * Le contrat de destination n'a QU'UNE clé d'adresse (champ `adresse` du
   * `requester_config` du Socle) : ni code postal ni ville à part. On n'affiche
   * alors ni les deux champs, ni le rappel — ils n'iraient nulle part. Taper
   * librement EST la sortie de secours, il n'y en a pas d'autre à proposer.
   */
  singleLine?: boolean;
  quartiers?: QuartierShape[];
  hint?: string;
  error?: string;
  className?: string;
}

export function AddressField({
  id, label = "Adresse", required, disabled, value, onChange,
  extras = [], onExtraChange, assisted = true, showMap = true, singleLine = false, quartiers,
  hint, error, className,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  // Dépliés d'office s'ils portent déjà quelque chose : masquer une donnée
  // existante serait pire que de montrer un champ vide.
  const [more, setMore] = React.useState(() => extras.some((e) => e.value.trim() !== ""));
  const [manual, setManual] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const listId = `${id}-suggestions`;

  const { suggestions, isLoading, isError, isStale } = useAddressSuggestions(value.line, assisted && !disabled);
  const showList = open && assisted && !disabled && suggestions.length > 0;

  React.useEffect(() => setIndex(0), [suggestions]);

  // Point de la carte : celui de la proposition retenue tant qu'on n'a pas
  // retouché la saisie, sinon l'adresse écrite, géocodée comme sur une fiche.
  const [picked, setPicked] = React.useState<GeoPoint | null>(null);
  const written = [value.line, [value.postcode, value.city].filter((v) => v !== "").join(" ")]
    .filter((v) => v.trim() !== "")
    .join(", ");
  const geocoded = useGeocode(showMap && assisted && picked === null ? written : "", value.postcode || null);
  const point = picked ?? geocoded.data ?? null;

  function choose(suggestion: AddressSuggestion) {
    setPicked({
      lat: suggestion.lat,
      lon: suggestion.lon,
      label: suggestion.label,
      precision: suggestion.precision,
      score: suggestion.score,
    });
    setOpen(false);
    onChange(
      {
        line: suggestion.precision === "commune" ? "" : suggestion.name,
        postcode: suggestion.postcode,
        city: suggestion.city,
      },
      suggestion,
    );
  }

  function typeLine(line: string) {
    setPicked(null);
    setOpen(true);
    onChange({ ...value, line }, null);
  }

  async function useMyPosition() {
    setLocating(true);
    try {
      const position = await browserPosition();
      if (!position) return;
      const suggestion = await reverseGeocode(position.lat, position.lon);
      if (suggestion) choose(suggestion);
    } catch {
      // Panne du service : rien ne change, l'agent continue de taper.
    } finally {
      setLocating(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      if (e.key === "ArrowDown" && suggestions.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      // Tant que la liste est ouverte, Entrée CHOISIT et ne soumet pas :
      // l'inverse enverrait des formulaires à moitié écrits.
      e.preventDefault();
      const suggestion = suggestions[index];
      if (suggestion) choose(suggestion);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
    // Tab n'est pas détourné : il doit continuer de sortir du champ.
  }

  const canLocate = assisted && !disabled && reverseGeocodingAvailable();
  const recap = singleLine ? "" : [value.postcode, value.city].filter((v) => v.trim() !== "").join(" ");

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <Field
        label={label}
        htmlFor={id}
        required={required}
        hint={hint ?? (assisted ? "Commencez à taper : les adresses du référentiel sont proposées." : undefined)}
        error={error}
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={id}
            value={value.line}
            disabled={disabled}
            autoComplete="street-address"
            className={cn("pl-9", canLocate && "pr-10")}
            role={assisted ? "combobox" : undefined}
            aria-expanded={assisted ? showList : undefined}
            aria-controls={assisted ? listId : undefined}
            aria-autocomplete={assisted ? "list" : undefined}
            aria-activedescendant={showList ? `${listId}-${index}` : undefined}
            onChange={(e) => typeLine(e.target.value)}
            onFocus={() => setOpen(true)}
            // Le clic sur une proposition passe par onMouseDown, avant le blur.
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          {canLocate ? (
            <button
              type="button"
              title="Utiliser ma position"
              disabled={locating}
              onClick={() => void useMyPosition()}
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <LocateFixed className={cn("size-4", locating && "animate-pulse")} aria-hidden="true" />
              <span className="sr-only">Utiliser ma position</span>
            </button>
          ) : null}

          {showList ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Adresses proposées"
              className="absolute left-0 top-[calc(100%+4px)] z-30 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-airbnb-lg"
            >
              {suggestions.map((suggestion, i) => (
                <li key={suggestion.id} id={`${listId}-${i}`} role="option" aria-selected={i === index}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); choose(suggestion); }}
                    onMouseEnter={() => setIndex(i)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                      i === index ? "bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <span className="truncate text-[13px] font-medium">{suggestion.label}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {suggestionContext(suggestion)}
                      {suggestion.precision !== "adresse"
                        ? ` · ${PRECISION_LABELS[suggestion.precision]}`
                        : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Field>

      {/* Annonce vocale des propositions — sans elle, la liste n'existe que pour l'œil. */}
      <span role="status" aria-live="polite" className="sr-only">
        {showList ? `${suggestions.length} adresse${suggestions.length > 1 ? "s" : ""} proposée${suggestions.length > 1 ? "s" : ""}` : ""}
      </span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        {recap !== "" && !manual ? <span className="font-semibold text-foreground">{recap}</span> : null}
        {assisted && isError ? (
          <span className="text-muted-foreground">
            Suggestions indisponibles — saisissez l'adresse à la main.
          </span>
        ) : null}
        {assisted && !isError && isLoading && !isStale && value.line.trim().length >= MIN_QUERY_LENGTH ? (
          <span className="text-muted-foreground">Recherche…</span>
        ) : null}
        <span className="flex-1" />
        {extras.length > 0 ? (
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} aria-hidden="true" />
            {more ? "Moins de champs" : "Plus de champs"}
          </button>
        ) : null}
        {assisted && !manual && !singleLine ? (
          <button
            type="button"
            onClick={() => setManual(true)}
            className="font-semibold text-muted-foreground hover:underline"
          >
            Adresse introuvable ?
          </button>
        ) : null}
      </div>

      {/* Saisie manuelle : la sortie de secours. Toujours atteignable, jamais
          imposée — la BAN ne connaît pas toutes les adresses, et pas l'étranger. */}
      {(manual || !assisted) && !singleLine ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Code postal" htmlFor={`${id}-postcode`}>
            <Input
              id={`${id}-postcode`}
              value={value.postcode}
              disabled={disabled}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={20}
              onChange={(e) => { setPicked(null); onChange({ ...value, postcode: e.target.value }, null); }}
            />
          </Field>
          <Field label="Ville" htmlFor={`${id}-city`}>
            <Input
              id={`${id}-city`}
              value={value.city}
              disabled={disabled}
              autoComplete="address-level2"
              maxLength={200}
              onChange={(e) => { setPicked(null); onChange({ ...value, city: e.target.value }, null); }}
            />
          </Field>
        </div>
      ) : null}

      {more && extras.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {extras.map((extra) => (
            <Field key={extra.key} label={extra.label} htmlFor={`${id}-${extra.key}`} hint={extra.hint}>
              <Input
                id={`${id}-${extra.key}`}
                value={extra.value}
                disabled={disabled}
                maxLength={extra.maxLength}
                onChange={(e) => onExtraChange?.(extra.key, e.target.value)}
              />
            </Field>
          ))}
        </div>
      ) : null}

      {showMap && assisted && point ? (
        <AddressMap point={point} quartiers={quartiers} pending={geocoded.isFetching} />
      ) : null}
    </div>
  );
}
