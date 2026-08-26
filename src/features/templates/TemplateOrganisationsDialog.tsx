// Activation d'un modèle d'e-mail, organisation par organisation.
//
// Modale distincte de celle du contenu, pour deux raisons :
//   · ce sont deux gestes différents — écrire un texte, et décider où il sert ;
//   · ils n'ont pas le même mode d'enregistrement. Le texte se valide en bloc,
//     un rattachement s'écrit AU CLIC (c'est une ligne, pas un champ). Les
//     mêler obligerait à réconcilier deux écritures qui n'échouent pas
//     ensemble.
//
// Elle s'ouvre soit dans la foulée de l'enregistrement d'un modèle, soit depuis
// l'action dédiée de la liste.

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { buildOrgTree, flattenOrgTree } from "./templates";
import { OrganisationToggle, ToggleListEmpty } from "./OrganisationToggles";
import {
  useAdministrableOrganizations, useTemplateLinks, useToggleTemplateOrganization,
} from "./useEmailTemplates";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  templateId: string;
  templateName: string;
  /** Vrai quand la modale suit l'enregistrement d'un NOUVEAU modèle : on le dit,
   *  sans quoi « aucune organisation cochée » ressemble à un bogue. */
  justCreated?: boolean;
}

export function TemplateOrganisationsDialog({
  open, onOpenChange, orgId, templateId, templateName, justCreated,
}: Props) {
  const orgs = useAdministrableOrganizations(orgId);
  const links = useTemplateLinks(orgId);
  const toggle = useToggleTemplateOrganization(orgId);
  const [error, setError] = React.useState<string | null>(null);

  const nodes = React.useMemo(
    () => flattenOrgTree(buildOrgTree(orgs.data ?? [])),
    [orgs.data],
  );
  const active = React.useMemo(
    () => new Set((links.data ?? [])
      .filter((l) => l.template_id === templateId)
      .map((l) => l.socle_org_id)),
    [links.data, templateId],
  );

  async function onToggle(socleOrgId: string, next: boolean) {
    setError(null);
    try {
      await toggle.mutateAsync({ templateId, socleOrgId, active: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modification impossible.");
    }
  }

  const loading = orgs.isLoading || links.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Organisations — « {templateName} »</DialogTitle>
          <DialogDescription>
            {justCreated
              ? "Modèle enregistré. Il n'est encore actif nulle part : choisissez les organisations où il pourra servir."
              : "Organisations où ce modèle peut être utilisé. Seules celles que vous administrez sont proposées."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[55vh] flex-col overflow-y-auto">
          {loading ? (
            <ToggleListEmpty>Chargement…</ToggleListEmpty>
          ) : orgs.isError ? (
            <ToggleListEmpty>Organisations indisponibles.</ToggleListEmpty>
          ) : nodes.length === 0 ? (
            <ToggleListEmpty>Vous n'administrez aucune organisation.</ToggleListEmpty>
          ) : (
            nodes.map((n) => (
              <OrganisationToggle
                key={n.socle_org_id}
                id={`scope-${templateId}-${n.socle_org_id}`}
                depth={n.depth}
                label={n.name}
                hint={n.obsolete ? "Organisation obsolète dans le Socle" : undefined}
                checked={active.has(n.socle_org_id)}
                disabled={toggle.isPending}
                onChange={(next) => void onToggle(n.socle_org_id, next)}
              />
            ))
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Chaque changement est enregistré immédiatement.
        </p>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
