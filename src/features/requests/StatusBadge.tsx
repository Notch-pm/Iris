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

export function StatusBadge({ status }: { status: string }) {
  const code = status as RequestStatus;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        STYLES[code] ?? "border-input",
      )}
    >
      {STATUS_LABELS[code] ?? status}
    </span>
  );
}
