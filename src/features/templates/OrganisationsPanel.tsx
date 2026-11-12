// Section « Organisations » des Paramètres — l'arbre des organisations que
// l'utilisateur administre, et, par organisation, les modèles d'e-mail qui y
// sont proposés. LECTURE SEULE depuis le 2026-11-12 : les modèles se rédigent
// et s'activent dans le Socle (Référentiels › Modèles de courriels) ; Iris en
// tient le miroir, rafraîchi par la synchronisation affichée en dessous.
//
// L'arbre n'affiche QUE ce que l'utilisateur administre (`administrable_
// organizations`, qui applique `has_admin_scope` nœud par nœud). Un
// administrateur borné à une branche voit sa branche, promue en racine — le
// calcul est dans `buildOrgTree`, pur et testé.
//
// L'état de la synchro du miroir Socle reste affiché en dessous : c'est la
// même matière, et c'est là qu'on vient quand une organisation manque.

import * as React from "react";
import { Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReferentielPanel } from "@/features/permissions/ReferentielPanel";
import type { SocleSyncMutation } from "@/features/socle/useSocleSync";
import { buildOrgTree, flattenOrgTree } from "./templates";
import { useAdministrableOrganizations, useSocleCustomTemplates } from "./useEmailTemplates";

interface Props {
  orgId: string;
  sync: SocleSyncMutation;
  onOpenCoverage: () => void;
}

export function OrganisationsPanel({ orgId, sync, onOpenCoverage }: Props) {
  const orgs = useAdministrableOrganizations(orgId);
  const templates = useSocleCustomTemplates(orgId);

  const nodes = React.useMemo(
    () => flattenOrgTree(buildOrgTree(orgs.data ?? [])),
    [orgs.data],
  );

  /** Combien de modèles sont proposés sur une organisation donnée. */
  const activeCount = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates.data ?? []) {
      for (const socleOrgId of t.socleOrgIds) {
        counts.set(socleOrgId, (counts.get(socleOrgId) ?? 0) + 1);
      }
    }
    return counts;
  }, [templates.data]);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[640px] text-sm text-muted-foreground">
        Les organisations du Référentiel que vous administrez, et le nombre de modèles d'e-mail
        proposés aux agents sur chacune. Les modèles se rédigent et s'activent dans le Socle
        (Référentiels › Modèles de courriels) ; ils arrivent ici à la synchronisation.
      </p>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Organisation</th>
                  <th className="px-4 py-2">Modèles d'e-mail</th>
                </tr>
              </thead>
              <tbody>
                {orgs.isLoading ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                      Chargement…
                    </td>
                  </tr>
                ) : orgs.isError ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-destructive" role="alert">
                      Organisations indisponibles.
                    </td>
                  </tr>
                ) : nodes.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-10 text-center text-muted-foreground">
                      <Building2 className="mx-auto mb-2 size-6 opacity-40" aria-hidden="true" />
                      Vous n'administrez aucune organisation.
                    </td>
                  </tr>
                ) : (
                  nodes.map((n) => {
                    const count = activeCount.get(n.socle_org_id) ?? 0;
                    return (
                      <tr
                        key={n.socle_org_id}
                        className="border-b border-border/60 last:border-0 hover:bg-muted/50"
                      >
                        <td className="px-4 py-3">
                          <span
                            className="flex items-center gap-2"
                            style={{ paddingLeft: `${n.depth * 22}px` }}
                          >
                            {n.depth > 0 ? (
                              <span aria-hidden="true" className="text-muted-foreground/60">└</span>
                            ) : null}
                            <span className="font-medium">{n.name}</span>
                            {n.obsolete ? <Badge variant="muted">Obsolète</Badge> : null}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {count === 0
                            ? "Aucun"
                            : `${count} modèle${count > 1 ? "s" : ""} proposé${count > 1 ? "s" : ""}`}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Le miroir Socle et sa synchro : c'est ici qu'on vient si une
          organisation manque à l'arbre ci-dessus. */}
      <ReferentielPanel orgId={orgId} sync={sync} onOpenCoverage={onOpenCoverage} />

    </div>
  );
}
