import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        <Badge variant="secondary">Squelette</Badge>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Bienvenue dans Iris</CardTitle>
          <CardDescription>
            Le système transactionnel des demandes d'usagers de la gamme Edilumen. Le domaine
            métier (demandes, statuts, intégrations Socle et Clara) sera implémenté selon
            docs/architecture-proposee.md.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aucune donnée pour l'instant — le schéma de base n'est pas encore créé.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
