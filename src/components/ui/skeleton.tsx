import * as React from "react";
import { cn } from "@/lib/utils";

/** Bloc de chargement (motif Clara) : même rayon que les cartes, fond `muted`. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
