// Dialogue de création/édition/duplication d'un profil de droits — formulaire
// contrôlé sur `ProfileDraft` (profileValidation.ts, livré). L'UI ne protège
// rien (RM-09) : les erreurs bloquantes ci-dessous sont un confort de saisie,
// la garde d'autorité est `save_permission_profile` (RM-38/39/42), dont le
// message est affiché tel quel en cas de refus.

import * as React from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SocleOrgRow } from "@/features/superadmin/socleOrgTree";
import {
  closureWithoutProcessFindings, ERROR_NAME_REQUIRED, ERROR_ORG_REQUIRED, validateProfileDraft,
  type ProfileDraft,
} from "./profileValidation";
import { OrgScopePicker } from "./OrgScopePicker";
import { ProfileMatrix } from "./ProfileMatrix";
import { RightsPicker } from "./RightsPicker";
import { useSaveProfile, type ProcedureCacheFullRow } from "./usePermissions";

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgRows: SocleOrgRow[];
  procedureRows: ProcedureCacheFullRow[];
  title: string;
  initialDraft: ProfileDraft;
  profileId?: string;
  expectedVersion?: number;
  /** Nombre d'utilisateurs attribués — affiché en information (RM-53), pas bloquant. */
  assignedCount?: number;
  onSaved: () => void;
  /** Verrou optimiste (RM-56) : permet de recharger les données avant de réessayer. */
  onReload?: () => void;
}

/** I7 : distingue le message de verrou optimiste (texte exact côté serveur, docs/droits.md) du reste. */
function isOptimisticLockError(message: string): boolean {
  return message.includes("modifié entre-temps");
}

/** I6 : avertissement RM-04 listant PRÉCISÉMENT les démarches concernées, jamais une phrase générique. */
function closureWarningText(findings: ReturnType<typeof closureWithoutProcessFindings>, names: string[]): string | null {
  if (!findings.default && names.length === 0) return null;
  const base = "Ce profil peut clore des demandes sans pouvoir les prendre en charge";
  if (findings.default && names.length > 0) {
    return `${base} — droits par défaut, et sur : ${names.join(", ")}.`;
  }
  if (findings.default) {
    return `${base} — droits par défaut (s'applique à toute démarche non listée, y compris futures).`;
  }
  return `${base} — démarche${names.length > 1 ? "s" : ""} concernée${names.length > 1 ? "s" : ""} : ${names.join(", ")}.`;
}

export function ProfileDialog({
  open, onOpenChange, orgId, orgRows, procedureRows, title, initialDraft, profileId, expectedVersion,
  assignedCount, onSaved, onReload,
}: ProfileDialogProps) {
  const [draft, setDraft] = React.useState<ProfileDraft>(initialDraft);
  const [submitted, setSubmitted] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const save = useSaveProfile(orgId);

  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const orgSectionRef = React.useRef<HTMLDivElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const allErrors = submitted ? validateProfileDraft(draft) : [];
  // I2 : les erreurs Nom / Périmètre sont reliées à leur champ (Field
  // error=…) ; le reste (« ce profil n'accorderait aucun droit ») dépend de
  // la combinaison administration/défaut/matrice et reste dans le bandeau
  // général — aucun champ unique ne le porterait mieux.
  const nameError = submitted && draft.name.trim() === "" ? ERROR_NAME_REQUIRED : undefined;
  const orgError = submitted && draft.organizationIds.length === 0 ? ERROR_ORG_REQUIRED : undefined;
  const otherErrors = allErrors.filter((e) => e !== ERROR_NAME_REQUIRED && e !== ERROR_ORG_REQUIRED);
  const closureFindings = closureWithoutProcessFindings(draft);
  const closureConcernedNames = closureFindings.procedureIds.map(
    (id) => procedureRows.find((p) => p.socle_id === id)?.name ?? id,
  );
  const closureWarning = closureWarningText(closureFindings, closureConcernedNames);
  const warnings = closureWarning ? [closureWarning] : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const currentErrors = validateProfileDraft(draft);
    if (currentErrors.length > 0) {
      // I2 : focus/scroll sur la PREMIÈRE erreur, dans l'ordre du formulaire.
      if (currentErrors.includes(ERROR_NAME_REQUIRED)) {
        nameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        nameInputRef.current?.focus();
      } else if (currentErrors.includes(ERROR_ORG_REQUIRED)) {
        orgSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        orgSectionRef.current?.focus();
      } else {
        formRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    try {
      await save.mutateAsync({ draft, profileId, expectedVersion });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  const lockError = serverError !== null && isOptimisticLockError(serverError);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          ref={formRef}
          onSubmit={(e) => void handleSubmit(e)}
          className="flex max-h-[72vh] flex-col gap-5 overflow-y-auto pr-1"
        >
          {assignedCount && assignedCount > 0 ? (
            <p className="rounded-[14px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Ce profil est attribué à {assignedCount} utilisateur{assignedCount > 1 ? "s" : ""} — les
              modifications s'appliquent immédiatement à leurs droits (RM-08).
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Nom" htmlFor="pf-name" required error={nameError}>
              <Input
                id="pf-name"
                ref={nameInputRef}
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </Field>
            <Field label="Description" htmlFor="pf-description">
              <Input
                id="pf-description"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
          </div>

          <label className="flex items-start gap-2.5 rounded-[14px] border border-border bg-muted/30 p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-input text-primary"
              checked={draft.isAdmin}
              onChange={(e) => setDraft((d) => ({ ...d, isAdmin: e.target.checked }))}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">
                Administration (accès aux Paramètres, aux membres, au journal des droits)
              </span>
              <span className="text-xs text-muted-foreground">
                N'accorde aucun droit sur les demandes. Combinée à la Clôture sur une
                organisation, elle permet aussi la réouverture et l'archivage/désarchivage des
                demandes de cette organisation.
              </span>
            </span>
          </label>

          <section ref={orgSectionRef} tabIndex={-1} className="flex flex-col gap-2 outline-none">
            <h4 className="text-sm font-bold">Périmètre d'organisations</h4>
            <p className="text-xs text-muted-foreground">
              Ce périmètre s'applique à toutes les démarches ci-dessous. Pour des droits
              différents selon l'organisation, créez un second profil.
            </p>
            <OrgScopePicker
              rows={orgRows}
              selected={draft.organizationIds}
              onChange={(ids) => setDraft((d) => ({ ...d, organizationIds: ids }))}
            />
            {orgError ? <p className="text-xs text-destructive">{orgError}</p> : null}
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-sm font-bold">Droits par défaut</h4>
            <p className="text-xs text-muted-foreground">
              S'applique à toute démarche non listée ci-dessous, y compris futures, ainsi qu'aux
              demandes historiques sans démarche.
            </p>
            <div className="max-w-xs">
              <RightsPicker
                idPrefix="pf-default"
                label="Droits par défaut"
                value={draft.defaultRights}
                onChange={(rights) => setDraft((d) => ({ ...d, defaultRights: rights }))}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-sm font-bold">Démarches</h4>
            <ProfileMatrix
              procedures={procedureRows}
              defaultRights={draft.defaultRights}
              value={draft.procedures}
              onChange={(procedures) => setDraft((d) => ({ ...d, procedures }))}
            />
          </section>

          {warnings.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-[14px] border border-secondary bg-secondary/20 px-3 py-2.5 text-xs text-secondary-foreground">
              {warnings.map((w) => <p key={w}>{w}</p>)}
            </div>
          ) : null}
          {otherErrors.length > 0 ? (
            <div role="alert" className="flex flex-col gap-1 rounded-[14px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              {otherErrors.map((e) => <p key={e}>{e}</p>)}
            </div>
          ) : null}
          {serverError ? (
            <div role="alert" className="flex flex-col gap-1.5 rounded-[14px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{serverError}</span>
                {profileId && onReload ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive"
                    onClick={() => { onReload(); onOpenChange(false); }}>
                    Recharger
                  </Button>
                ) : null}
              </div>
              {lockError ? (
                <p>
                  Recharger fermera cette fenêtre — vos modifications ici seront perdues.
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
