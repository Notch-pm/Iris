import { cn } from "@/lib/utils";
import { displayStatusLabel, type ReplyValidationState, type RequestStatus } from "./statuts";

/** Sous-état « Réponse en validation » (courrier de réponse attendu chez Clara). */
const REPLY_STYLE = "bg-warning/15 text-foreground border-warning/40";
const REPLY_INK = "text-warning";

const STYLES: Record<RequestStatus, string> = {
  a_traiter: "bg-secondary text-secondary-foreground border-transparent",
  en_instruction: "bg-primary/10 text-primary border-primary/30",
  en_attente: "bg-warning/15 text-foreground border-warning/40",
  annulee: "bg-muted text-muted-foreground border-transparent",
  resolue_positive: "bg-success/15 text-success border-success/30",
  resolue_negative: "bg-destructive/10 text-destructive border-destructive/30",
  archivee: "bg-muted text-muted-foreground border-border",
};

/** Encre de la variante « point + texte » (ligne de liste) : la même teinte que la pastille, sans fond. */
const INKS: Record<RequestStatus, string> = {
  a_traiter: "text-foreground",
  en_instruction: "text-primary",
  en_attente: "text-warning",
  annulee: "text-muted-foreground",
  resolue_positive: "text-success",
  resolue_negative: "text-destructive",
  archivee: "text-muted-foreground",
};

const STATUS_KNOWN = new Set(Object.keys(STYLES));

interface Props {
  status: string;
  /** Pastille d'en-tête : plus grande, avec un point de couleur. */
  size?: "sm" | "md";
  /**
   * `pill` (défaut) : pastille à fond. `dot` : point de couleur + libellé sans
   * fond — la ligne d'une liste dense (maquette « Liste — en-tête compacté »).
   */
  variant?: "pill" | "dot";
  /** Sous-état de `en_instruction` : affiché à la place du statut (pas un 8ᵉ statut). */
  replyState?: ReplyValidationState | null;
}

export function StatusBadge({ status, size = "sm", variant = "pill", replyState = null }: Props) {
  const code = status as RequestStatus;
  const inReply = code === "en_instruction" && replyState !== null;
  const label = STATUS_KNOWN.has(code) ? displayStatusLabel(code, replyState) : status;
  if (variant === "dot") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold",
          inReply ? REPLY_INK : (INKS[code] ?? "text-foreground"),
        )}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border font-semibold",
        size === "md" ? "px-[11px] py-[5px] text-[11.5px] font-bold" : "px-2.5 py-0.5 text-xs",
        inReply ? REPLY_STYLE : (STYLES[code] ?? "border-input"),
      )}
    >
      {size === "md" ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}
