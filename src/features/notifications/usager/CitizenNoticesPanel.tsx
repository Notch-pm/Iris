// Section « Avis à l'usager » des Paramètres (B12) — l'interrupteur de la collectivité.
//
// Allumé, Iris prévient l'usager par courriel quand sa demande change de statut
// (prise en charge, attente de sa réponse, reprise, annulation, réouverture).
// Éteint par défaut, et allumé seulement là où l'espace usager du portail est
// ouvert (décision PO n° 2) : allumer, c'est écrire à de vrais habitants — d'où
// la confirmation. Réglage de l'organisation principale : l'UI le reflète, la
// RPC le garde.

import * as React from "react";
import { BellRing } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTenant } from "@/features/tenant/TenantProvider";
import { isAdminOn } from "@/features/rights/rights";
import { useCitizenNoticeSettings, useSaveCitizenNoticeSettings } from "./useCitizenNoticeSettings";

const SENT = [
  "la prise en charge de la demande par un agent ;",
  "l'attente de sa réponse (complément demandé, pièce non conforme) ;",
  "la reprise du traitement par un agent ;",
  "l'annulation de la demande ;",
  "la réouverture d'une demande close.",
];

export function CitizenNoticesPanel({ orgId }: { orgId: string }) {
  const { current, rights } = useTenant();
  const settings = useCitizenNoticeSettings(orgId);
  const save = useSaveCitizenNoticeSettings(orgId);
  const canEdit = current ? isAdminOn(rights, current.socleOrgId) : false;
  const [confirming, setConfirming] = React.useState(false);
  const enabled = settings.data?.enabled ?? false;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[680px] text-sm text-muted-foreground">
        Allumés, les avis préviennent l'usager par courriel quand sa demande change de statut. Ils
        ne partent qu'aux usagers qui suivent leur demande en ligne — compte sur le portail ou
        suivi par code — et portent un lien vers la demande et un lien pour ne plus être prévenu.
      </p>
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BellRing className="size-5 text-primary" aria-hidden="true" />
              <span className="font-semibold">Avis de statut à l'usager</span>
              {settings.isLoading ? null : (
                <Badge variant={enabled ? "secondary" : "muted"}>{enabled ? "Allumés" : "Éteints"}</Badge>
              )}
            </div>
            {canEdit && !settings.isLoading && !settings.isError ? (
              <Button
                variant={enabled ? "outline" : "primary"}
                disabled={save.isPending}
                onClick={() => (enabled ? save.mutate(false) : setConfirming(true))}
              >
                {enabled ? "Éteindre" : "Allumer"}
              </Button>
            ) : null}
          </div>
          {settings.isError ? (
            <p role="alert" className="text-[13px] text-destructive">Réglage indisponible.</p>
          ) : null}
          <div className="text-[13px] text-muted-foreground">
            <p>Un avis part pour :</p>
            <ul className="mt-1 list-disc pl-5">
              {SENT.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="mt-2">
              Rien ne part pour une résolution (l'avis de clôture en tient lieu), un renvoi à
              qualifier, un archivage ou un transfert, ni pour une demande issue de Clara ou
              masquée à l'usager. Les changements rapprochés sont regroupés : un seul avis, dix
              minutes après le premier, et rien si la demande est revenue à son état d'avant.
            </p>
          </div>
        </CardContent>
      </Card>
      {!canEdit ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          Lecture seule : ce réglage revient aux administrateurs de l'organisation principale.
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-[13px] text-destructive">
          {save.error instanceof Error ? save.error.message : "Enregistrement refusé."}
        </p>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allumer les avis à l'usager ?</AlertDialogTitle>
            <AlertDialogDescription>
              De vrais courriels partiront aux habitants dès le prochain changement de statut. À
              n'allumer que si l'espace usager du portail est ouvert pour la collectivité.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button
              disabled={save.isPending}
              onClick={() => save.mutate(true, { onSettled: () => setConfirming(false) })}
            >
              Allumer
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
