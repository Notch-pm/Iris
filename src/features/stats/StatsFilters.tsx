import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PERIOD_LABELS, PERIODS, type StatPeriod } from "./stats";

interface StatsFiltersProps {
  organismes: { value: string; label: string }[];
  /** Organisme porteur Socle filtré, null = tous. */
  socleOrgId: string | null;
  period: StatPeriod;
  onOrganismeChange: (socleOrgId: string | null) => void;
  onPeriodChange: (p: StatPeriod) => void;
}

const ALL = "__all__";

/** Filtres de l'écran (motif Clara) : un organisme, une période. */
export function StatsFilters({
  organismes,
  socleOrgId,
  period,
  onOrganismeChange,
  onPeriodChange,
}: StatsFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        aria-label="Organisme"
        className="w-64"
        value={socleOrgId ?? ALL}
        onChange={(e) => onOrganismeChange(e.target.value === ALL ? null : e.target.value)}
      >
        <option value={ALL}>Tous les organismes</option>
        {organismes.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      <div className="flex gap-1 rounded-[10px] border border-border p-1" role="group" aria-label="Période">
        {PERIODS.map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={period === p ? "primary" : "ghost"}
            className="h-7 px-3 text-xs"
            aria-pressed={period === p}
            onClick={() => onPeriodChange(p)}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>
    </div>
  );
}
