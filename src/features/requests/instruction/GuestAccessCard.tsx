// Encart « Suivi en ligne sans compte » de la fiche demande (lot L4a).
//
// Affiché seulement si la demande a un accès invité ET que l'agent a le droit
// d'instruction (sans lui, rien n'est demandé au serveur). Deux gestes, chacun
// confirmé dans un `AlertDialog` (focus piégé, Échap = annuler) qui reste
// ouvert tant que le serveur n'a pas répondu : un refus se lit là où le geste
// a été fait.

import * as React from "react";
import { KeyRound } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import type { EdgeError } from "@/lib/edge";
import { cn } from "@/lib/utils";
import {
  GUEST_ACCESS_DIALOGS,
  GUEST_ACCESS_LABELS,
  guestAccessErrorMessage,
  guestAccessView,
  type GuestAccessAction,
} from "./guestAccess";
import { useGuestAccess, useGuestAccessAction } from "./useGuestAccess";

interface Props {
  requestId: string;
  /** Reflet du droit d'instruction (autorité : l'edge function). */
  canInstruct: boolean;
  onFlash: (text: string) => void;
  /** `rail` : colonne de la fiche (bureau) ; `mobile` : carte pleine largeur. */
  variant?: "rail" | "mobile";
}

const TONE_DOT: Record<"ok" | "warn" | "off", string> = {
  ok: "bg-primary",
  warn: "bg-amber-500",
  off: "bg-muted-foreground",
};

export function GuestAccessCard({ requestId, canInstruct, onFlash, variant = "rail" }: Props) {
  const status = useGuestAccess(requestId, canInstruct);
  const act = useGuestAccessAction();
  const [pending, setPending] = React.useState<GuestAccessAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const view = guestAccessView(status.data);
  const reasonId = `guest-access-reason-${requestId}`;

  if (!canInstruct || view === null) return null;

  const mobile = variant === "mobile";
  const dialog = pending ? GUEST_ACCESS_DIALOGS[pending] : null;

  const open = (action: GuestAccessAction) => {
    setError(null);
    setPending(action);
  };
  const confirm = async () => {
    if (!pending) return;
    try {
      await act.mutateAsync({ requestId, action: pending });
      onFlash(GUEST_ACCESS_DIALOGS[pending].successMessage);
      setPending(null);
    } catch (e) {
      const err = e as EdgeError;
      setError(guestAccessErrorMessage(err.code, err.message));
    }
  };

  const body = (
    <>
      <span className={cn("flex items-center gap-1.5 font-bold", mobile ? "text-base" : "text-[12.5px]")}>
        <KeyRound className={mobile ? "size-4" : "size-3.5"} aria-hidden="true" />
        {GUEST_ACCESS_LABELS.title}
      </span>
      <p className={cn("flex items-center gap-1.5", mobile ? "text-sm" : "text-[12px]")}>
        <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[view.tone])} aria-hidden="true" />
        <span className={cn(view.tone !== "ok" && "font-semibold")}>{view.stateLabel}</span>
      </p>
      <ul className={cn("flex flex-col gap-0.5 text-muted-foreground", mobile ? "text-[13px]" : "text-[11.5px]")}>
        {view.details.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-2.5">
        {view.canRevoke ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={mobile ? undefined : "h-[30px] text-xs"}
            onClick={() => open("revoke")}
          >
            {GUEST_ACCESS_LABELS.revoke}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={mobile ? undefined : "h-[30px] text-xs"}
          disabled={!view.canReissue}
          aria-describedby={view.reissueDisabledReason ? reasonId : undefined}
          onClick={() => open("reissue")}
        >
          {GUEST_ACCESS_LABELS.reissue}
        </Button>
      </div>
      {view.reissueDisabledReason ? (
        <p id={reasonId} className={cn("text-muted-foreground", mobile ? "text-[13px]" : "text-[11px] leading-relaxed")}>
          {view.reissueDisabledReason}
        </p>
      ) : null}
    </>
  );

  return (
    <>
      {mobile ? (
        <section
          aria-label={GUEST_ACCESS_LABELS.title}
          className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm"
        >
          {body}
        </section>
      ) : (
        <Surface aria-label={GUEST_ACCESS_LABELS.title} className="gap-2.5 px-4 py-[15px]">
          {body}
        </Surface>
      )}

      <AlertDialog open={dialog !== null} onOpenChange={(o) => { if (!o && !act.isPending) setPending(null); }}>
        <AlertDialogContent>
          {dialog ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
              </AlertDialogHeader>
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">{dialog.body}</p>
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={act.isPending}>Annuler</AlertDialogCancel>
                <Button type="button" disabled={act.isPending} onClick={() => void confirm()}>
                  {act.isPending ? dialog.pendingLabel : dialog.confirmLabel}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
