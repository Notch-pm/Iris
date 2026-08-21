import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FieldProps {
  label?: React.ReactNode;
  hint?: string;
  error?: string;
  htmlFor?: string;
  /** Affiche un astérisque rouge après le libellé pour marquer le champ obligatoire. */
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, error, htmlFor, required, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      {children}
      {hint && !error ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
