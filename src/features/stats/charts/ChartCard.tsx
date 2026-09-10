import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartCardProps {
  title: string;
  loading: boolean;
  /** Vrai quand la requête a répondu et qu'il n'y a rien à dessiner. */
  empty?: boolean;
  emptyText?: string;
  /** Hauteur réservée aux états chargement/vide (celle du graphique). */
  height?: number;
  children: React.ReactNode;
}

/** Carte d'un graphique (motif Clara) : titre discret, squelette, état vide. */
export function ChartCard({
  title,
  loading,
  empty = false,
  emptyText = "Aucune demande sur la période sélectionnée",
  height = 280,
  children,
}: ChartCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="w-full" style={{ height }} />
        ) : empty ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ height }}
          >
            {emptyText}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
