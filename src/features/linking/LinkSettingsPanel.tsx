// Section « Demandes liées » des Paramètres — les démarches MUTUALISABLES.
//
// Une démarche mutualisable est une démarche où plusieurs habitants peuvent
// signaler le même incident : leurs demandes se lient et pourront se résoudre
// ensemble. Le rayon et la fenêtre bornent la recherche des demandes
// approchantes. Réglage de l'organisation principale : un administrateur d'une
// seule branche lit, il ne règle pas — l'UI le reflète, la RPC le garde.

import * as React from "react";
import { Link2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTenant } from "@/features/tenant/TenantProvider";
import { isAdminOn } from "@/features/rights/rights";
import { useAllProcedureRows } from "@/features/permissions/usePermissions";
import {
  enabledCount, linkSettingViews, parseRadius, parseWindow, type LinkSettingView,
} from "./linking";
import { useLinkSettings, useSaveLinkSetting } from "./useLinkSettings";

export function LinkSettingsPanel({ orgId }: { orgId: string }) {
  const { current, rights } = useTenant();
  const procedures = useAllProcedureRows(orgId);
  const settings = useLinkSettings(orgId);
  const save = useSaveLinkSetting(orgId);
  const canEdit = current ? isAdminOn(rights, current.socleOrgId) : false;

  const views = React.useMemo(
    () => linkSettingViews(procedures.data ?? [], settings.data ?? []),
    [procedures.data, settings.data],
  );

  const loading = procedures.isLoading || settings.isLoading;
  const failed = procedures.isError || settings.isError;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[680px] text-sm text-muted-foreground">
        Activez les démarches où plusieurs usagers peuvent signaler <strong>le même incident</strong>{" "}
        — un nid-de-poule, un lampadaire éteint. Leurs demandes pourront être liées, puis résolues
        ensemble. Laissez éteintes celles dont chaque demande est personnelle : une carte de
        déchetterie accordée à l'un n'en accorde pas une à l'autre.
      </p>
      <p className="max-w-[680px] text-[13px] text-muted-foreground">
        Le <strong>rayon</strong> et la <strong>fenêtre</strong> bornent la recherche des demandes
        approchantes : à quelle distance du lieu signalé, et depuis combien de jours.
      </p>
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

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Démarche</th>
                  <th className="px-4 py-2">Mutualisable</th>
                  <th className="px-4 py-2">Rayon (m)</th>
                  <th className="px-4 py-2">Fenêtre (jours)</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>
                ) : failed ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-destructive" role="alert">Démarches indisponibles.</td></tr>
                ) : views.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                      <Link2 className="mx-auto mb-2 size-6 opacity-40" aria-hidden="true" />
                      Aucune démarche dans le référentiel du tenant.
                    </td>
                  </tr>
                ) : (
                  views.map((v) => (
                    <LinkSettingLine
                      key={v.procedureId}
                      view={v}
                      disabled={!canEdit || save.isPending}
                      onSave={(next) => save.mutate({ procedureId: v.procedureId, ...next })}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {!loading && !failed ? (
        <p className="text-[12px] text-muted-foreground">
          {enabledCount(views) === 0
            ? "Aucune démarche mutualisable."
            : `${enabledCount(views)} démarche${enabledCount(views) > 1 ? "s" : ""} mutualisable${enabledCount(views) > 1 ? "s" : ""}.`}
        </p>
      ) : null}
    </div>
  );
}

interface LineProps {
  view: LinkSettingView;
  disabled: boolean;
  onSave: (next: { enabled: boolean; radiusM: number; windowDays: number }) => void;
}

function LinkSettingLine({ view, disabled, onSave }: LineProps) {
  const [radius, setRadius] = React.useState(String(view.radiusM));
  const [windowDays, setWindowDays] = React.useState(String(view.windowDays));
  // Le serveur fait foi : une valeur relue remplace la saisie.
  React.useEffect(() => setRadius(String(view.radiusM)), [view.radiusM]);
  React.useEffect(() => setWindowDays(String(view.windowDays)), [view.windowDays]);

  const radiusParsed = parseRadius(radius);
  const windowParsed = parseWindow(windowDays);
  const id = `link-${view.procedureId}`;

  const commitNumbers = () => {
    if (radiusParsed.value === null || windowParsed.value === null) return;
    if (radiusParsed.value === view.radiusM && windowParsed.value === view.windowDays) return;
    onSave({ enabled: view.enabled, radiusM: radiusParsed.value, windowDays: windowParsed.value });
  };

  return (
    <tr className="border-b border-border/60 last:border-0 align-top">
      <td className="px-4 py-3">
        <label htmlFor={id} className="flex flex-col">
          <span className="font-medium">{view.name}</span>
          <span className="text-[12px] text-muted-foreground">
            {view.category ?? "Sans catégorie"}
            {view.obsolete ? <Badge variant="muted" className="ml-2">Obsolète</Badge> : null}
          </span>
        </label>
      </td>
      <td className="px-4 py-3">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-label={`${view.name} : mutualisable`}
          className="mt-1 size-4 accent-[hsl(var(--primary))]"
          checked={view.enabled}
          disabled={disabled}
          onChange={(e) => onSave({ enabled: e.target.checked, radiusM: view.radiusM, windowDays: view.windowDays })}
        />
      </td>
      <td className="px-4 py-3">
        <Input
          inputMode="numeric"
          aria-label={`${view.name} : rayon en mètres`}
          aria-invalid={radiusParsed.error ? true : undefined}
          className="h-9 w-24"
          value={radius}
          disabled={disabled || !view.enabled}
          onChange={(e) => setRadius(e.target.value)}
          onBlur={commitNumbers}
        />
        {radiusParsed.error ? <p className="mt-1 text-[11px] text-destructive">{radiusParsed.error}</p> : null}
      </td>
      <td className="px-4 py-3">
        <Input
          inputMode="numeric"
          aria-label={`${view.name} : fenêtre en jours`}
          aria-invalid={windowParsed.error ? true : undefined}
          className="h-9 w-24"
          value={windowDays}
          disabled={disabled || !view.enabled}
          onChange={(e) => setWindowDays(e.target.value)}
          onBlur={commitNumbers}
        />
        {windowParsed.error ? <p className="mt-1 text-[11px] text-destructive">{windowParsed.error}</p> : null}
      </td>
    </tr>
  );
}
