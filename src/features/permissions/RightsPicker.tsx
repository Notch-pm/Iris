// Sélecteur de niveau de droits — préréglages RM-03 + mode « détaillé » (trois
// cases, la consultation étant toujours impliquée par un droit d'écriture).
// Réutilisé pour les droits par défaut du profil et chaque ligne de la
// matrice (`ProfileMatrix`).

import * as React from "react";
import { Select } from "@/components/ui/select";
import { ALL_RIGHTS, RIGHT_LABELS, type Right } from "@/features/rights/rights";
import { PRESET_LEVELS, presetFor, rightsForPreset, type PresetLevelId } from "./profileValidation";

const DETAIL_MODE = "__detail__";
const DETAIL_RIGHTS: Right[] = ["creation", "instruction", "cloture"];

interface RightsPickerProps {
  value: Right[];
  onChange: (rights: Right[]) => void;
  idPrefix: string;
  label?: string;
}

export function RightsPicker({ value, onChange, idPrefix, label }: RightsPickerProps) {
  const preset = presetFor(value);
  const [forceDetail, setForceDetail] = React.useState(preset === null);
  const showDetail = forceDetail || preset === null;

  function onSelectChange(raw: string) {
    if (raw === DETAIL_MODE) {
      setForceDetail(true);
      return;
    }
    setForceDetail(false);
    onChange(rightsForPreset(raw as PresetLevelId));
  }

  function toggleDetailRight(right: Right, checked: boolean) {
    const set = new Set(value);
    if (checked) set.add(right);
    else set.delete(right);
    onChange(ALL_RIGHTS.filter((r) => set.has(r)));
  }

  const hasAnyWriteRight = value.some((r) => r !== "consultation");

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        aria-label={label ?? "Niveau de droits"}
        id={`${idPrefix}-preset`}
        className="h-9 text-xs"
        value={showDetail ? DETAIL_MODE : (preset ?? DETAIL_MODE)}
        onChange={(e) => onSelectChange(e.target.value)}
      >
        {PRESET_LEVELS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value={DETAIL_MODE}>Détaillé…</option>
      </Select>
      {showDetail ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
          {DETAIL_RIGHTS.map((right) => (
            <label key={right} className="flex items-center gap-1.5 text-xs font-medium">
              <input
                type="checkbox"
                id={`${idPrefix}-${right}`}
                checked={value.includes(right)}
                onChange={(e) => toggleDetailRight(right, e.target.checked)}
                className="size-3.5 rounded border-input text-primary"
              />
              {RIGHT_LABELS[right]}
            </label>
          ))}
          <span className="text-xs text-muted-foreground">
            {hasAnyWriteRight ? "Consultation incluse automatiquement." : "Aucun droit."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
