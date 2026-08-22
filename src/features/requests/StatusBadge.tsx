import { cn } from "@/lib/utils";
import { STATUS_LABELS, type RequestStatus } from "./statuts";

const STYLES: Record<RequestStatus, string> = {
  a_traiter: "bg-secondary text-secondary-foreground border-transparent",
  en_instruction: "bg-primary/10 text-primary border-primary/30",
  en_attente: "bg-warning/15 text-foreground border-warning/40",
  annulee: "bg-muted text-muted-foreground border-transparent",
  resolue_positive: "bg-success/15 text-success border-success/30",
  resolue_negative: "bg-destructive/10 text-destructive border-destructive/30",
  archivee: "bg-muted text-muted-foreground border-border",
};

interface Props {
  status: string;
  /** Pastille d'en-tête : plus grande, avec un point de couleur. */
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "sm" }: Props) {
  const code = status as RequestStatus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border font-semibold",
        size === "md" ? "px-[11px] py-[5px] text-[11.5px] font-bold" : "px-2.5 py-0.5 text-xs",
        STYLES[code] ?? "border-input",
      )}
    >
      {size === "md" ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {STATUS_LABELS[code] ?? status}
    </span>
  );
}
