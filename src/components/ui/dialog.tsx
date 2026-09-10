import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * `dialog` (défaut) : fenêtre centrée. `sheet` : PLEIN ÉCRAN, pour le mobile —
 * une fenêtre centrée de 448 px sur un écran de 375 px n'est qu'un dialogue
 * mal rogné, et les insets de sécurité (encoche, indicateur d'accueil) doivent
 * être respectés. `drawer` : TIROIR collé en bas, pour un menu d'actions au
 * pouce (maquette « Instruire », 2026-09-14). Les pages mobiles les demandent ;
 * le bureau ne change pas.
 */
export type DialogVariant = "dialog" | "sheet" | "drawer";

const DIALOG_VARIANT: Record<DialogVariant, string> = {
  dialog:
    "left-1/2 top-1/2 max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border p-6",
  sheet:
    "inset-0 h-dvh w-full max-w-none rounded-none p-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]",
  drawer:
    "inset-x-0 bottom-0 max-h-[88dvh] w-full max-w-none rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2.5",
};

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    variant?: DialogVariant;
    /** La page mobile pose SON bouton de fermeture dans son en-tête : pas de doublon. */
    hideClose?: boolean;
  }
>(({ className, children, variant = "dialog", hideClose = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 overflow-y-auto bg-card shadow-iris-lg",
        DIALOG_VARIANT[variant],
        className,
      )}
      {...props}
    >
      {variant === "drawer" ? (
        <span aria-hidden="true" className="mx-auto mb-2.5 block h-[5px] w-11 rounded-full bg-border" />
      ) : null}
      {children}
      {hideClose ? null : (
        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 rounded-sm opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            variant === "sheet" ? "top-[calc(env(safe-area-inset-top)+1rem)] p-1" : "top-4",
            variant === "drawer" && "sr-only",
          )}
        >
          <X className="size-4" />
          <span className="sr-only">Fermer</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}
