// Section « Organisations » des Paramètres — l'arbre des organisations que
// l'utilisateur administre, et, par organisation, les modèles d'e-mail qui y
// sont actifs.
//
// L'arbre n'affiche QUE ce que l'utilisateur administre (`administrable_
// organizations`, qui applique `has_admin_scope` nœud par nœud). Un
// administrateur borné à une branche voit sa branche, promue en racine — le
// calcul est dans `buildOrgTree`, pur et testé.
//
// L'état de la synchro du miroir Socle reste affiché en dessous : c'est la
// même matière, et c'est là qu'on vient quand une organisation manque.

import * as React from "react";
import { Building2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ReferentielPanel } from "@/features/permissions/ReferentielPanel";
import type { SocleSyncMutation } from "@/features/socle/useSocleSync";
import { buildOrgTree, flattenOrgTree, type OrgNode } from "./templates";
import { OrganisationToggle, ToggleListEmpty } from "./OrganisationToggles";
import {
  useAdministrableOrganizations, useEmailTemplates, useTemplateLinks,
  useToggleTemplateOrganization,
} from "./useEmailTemplates";

interface Props {
  orgId: string;
  sync: SocleSyncMutation;
  onOpenCoverage: () => void;
}

export function OrganisationsPanel({ orgId, sync, onOpenCoverage }: Props) {
  const orgs = useAdministrableOrganizations(orgId);
  const templates = useEmailTemplates(orgId);
  const links = useTemplateLinks(orgId);
  const [editing, setEditing] = React.useState<OrgNode | null>(null);

  const nodes = React.useMemo(
    () => flattenOrgTree(buildOrgTree(orgs.data ?? [])),
    [orgs.data],
  );

  /** Combien de modèles sont actifs sur une organisation donnée. */
  const activeCount = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of links.data ?? []) {
      counts.set(l.socle_org_id, (counts.get(l.socle_org_id) ?? 0) + 1);
    }
    return counts;
  }, [links.data]);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[640px] text-sm text-muted-foreground">
        Les organisations du Référentiel que vous administrez. Depuis chacune, choisissez les
        modèles d'e-mail qui y sont utilisables.
      </p>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Organisation</th>
                  <th className="px-4 py-2">Modèles d'e-mail</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orgs.isLoading ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                      Chargement…
                    </td>
                  </tr>
                ) : orgs.isError ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-destructive" role="alert">
                      Organisations indisponibles.
                    </td>
                  </tr>
                ) : nodes.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
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
                            : `${count} modèle${count > 1 ? "s" : ""} actif${count > 1 ? "s" : ""}`}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Modifier les modèles de cette organisation"
                              aria-label={`Modifier les modèles de ${n.name}`}
                              onClick={() => setEditing(n)}
                            >
                              <Pencil />
                            </Button>
                          </div>
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

      {editing ? (
        <OrganisationTemplatesDialog
          org={editing}
          orgId={orgId}
          templates={templates.data ?? []}
          links={links.data ?? []}
          loading={templates.isLoading || links.isLoading}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

interface DialogProps {
  org: OrgNode;
  orgId: string;
  templates: { id: string; name: string; description: string | null }[];
  links: { template_id: string; socle_org_id: string }[];
  loading: boolean;
  onClose: () => void;
}

function OrganisationTemplatesDialog({
  org, orgId, templates, links, loading, onClose,
}: DialogProps) {
  const toggle = useToggleTemplateOrganization(orgId);
  const [error, setError] = React.useState<string | null>(null);

  const active = React.useMemo(
    () => new Set(links.filter((l) => l.socle_org_id === org.socle_org_id)
      .map((l) => l.template_id)),
    [links, org.socle_org_id],
  );

  async function onToggle(templateId: string, next: boolean) {
    setError(null);
    try {
      await toggle.mutateAsync({ templateId, socleOrgId: org.socle_org_id, active: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modification impossible.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{org.name}</DialogTitle>
          <DialogDescription>
            Modèles d'e-mail utilisables dans cette organisation. Chaque changement est
            enregistré immédiatement.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[55vh] flex-col overflow-y-auto">
          {loading ? (
            <ToggleListEmpty>Chargement…</ToggleListEmpty>
          ) : templates.length === 0 ? (
            <ToggleListEmpty>
              Aucun modèle d'e-mail n'existe encore. Créez-en un depuis « Modèles d'e-mail ».
            </ToggleListEmpty>
          ) : (
            templates.map((t) => (
              <OrganisationToggle
                key={t.id}
                id={`org-${org.socle_org_id}-${t.id}`}
                label={t.name}
                hint={t.description ?? undefined}
                checked={active.has(t.id)}
                disabled={toggle.isPending}
                onChange={(next) => void onToggle(t.id, next)}
              />
            ))
          )}
        </div>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
