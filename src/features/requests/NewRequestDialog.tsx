import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FacetOption } from "./facets";
import { buildNewRequestInsert, EMPTY_NEW_REQUEST, type NewRequestForm } from "./newRequest";
import { PRIORITY_LABELS } from "./statuts";
import { useCreateRequest } from "./useRequests";
import { fetchProcedureSnapshot } from "@/features/socle/useSocleCatalog";

interface Props {
  organizationId: string;
  /** Catalogues Socle synchronisés (cache du tenant). */
  orgCatalog: FacetOption[];
  procCatalog: FacetOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewRequestDialog({
  organizationId, orgCatalog, procCatalog, open, onOpenChange,
}: Props) {
  const navigate = useNavigate();
  const createRequest = useCreateRequest();
  const [form, setForm] = React.useState<NewRequestForm>(EMPTY_NEW_REQUEST);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = <K extends keyof NewRequestForm>(key: K, value: NewRequestForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function reset() {
    setForm(EMPTY_NEW_REQUEST);
    setError(null);
  }

  function onProcedureChange(value: string) {
    const option = procCatalog.find((p) => p.value === value);
    set("procedureId", value === "" ? null : value);
    set("procedureLabel", option?.label ?? "");
  }

  function onDestinationChange(value: string) {
    const option = orgCatalog.find((o) => o.value === value);
    set("destinationId", value === "" ? null : value);
    set("destinationLabel", option?.label ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Snapshot de la démarche figé à la création, construit côté serveur via
      // socle-proxy — sans lui, la garde SQL refuserait de toute façon.
      const snapshot = form.procedureId
        ? await fetchProcedureSnapshot(organizationId, form.procedureId)
        : null;
      const built = buildNewRequestInsert(form, organizationId, snapshot ? { ...snapshot } : null);
      if (!built.ok) {
        setError(built.message);
        return;
      }
      const created = await createRequest.mutateAsync(built.insert);
      onOpenChange(false);
      reset();
      navigate(`/demandes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la création.");
    } finally {
      setSubmitting(false);
    }
  }

  const noCatalog = procCatalog.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle demande</DialogTitle>
          <DialogDescription>
            Toute demande est fondée sur une démarche Socle active du tenant. Elle naît
            « À traiter ».
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Démarche Socle" htmlFor="nr-procedure" required
            hint={noCatalog
              ? "Aucune démarche active pour ce tenant — le référentiel Socle doit être synchronisé."
              : undefined}>
            <Select id="nr-procedure" required value={form.procedureId ?? ""}
              disabled={noCatalog}
              onChange={(e) => onProcedureChange(e.target.value)}>
              <option value="">— Sélectionner une démarche —</option>
              {procCatalog.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Objet" htmlFor="nr-subject" required>
            <Input id="nr-subject" required value={form.subject}
              onChange={(e) => set("subject", e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="nr-body">
            <Textarea id="nr-body" value={form.body} onChange={(e) => set("body", e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priorité" htmlFor="nr-priority">
              <Select id="nr-priority" value={form.priority}
                onChange={(e) => set("priority", e.target.value as NewRequestForm["priority"])}>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Organisation destinataire" htmlFor="nr-destination">
              <Select id="nr-destination" value={form.destinationId ?? ""}
                onChange={(e) => onDestinationChange(e.target.value)}>
                <option value="">— À affecter —</option>
                {orgCatalog.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">Demandeur</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.anonymous}
                onChange={(e) => set("anonymous", e.target.checked)} />
              Demande anonyme (choix assumé — aucune notification possible)
            </label>
            {!form.anonymous ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nom" htmlFor="nr-lastname">
                  <Input id="nr-lastname" value={form.requesterLastName}
                    onChange={(e) => set("requesterLastName", e.target.value)} />
                </Field>
                <Field label="Prénom" htmlFor="nr-firstname">
                  <Input id="nr-firstname" value={form.requesterFirstName}
                    onChange={(e) => set("requesterFirstName", e.target.value)} />
                </Field>
                <Field label="Email" htmlFor="nr-email">
                  <Input id="nr-email" type="email" value={form.requesterEmail}
                    onChange={(e) => set("requesterEmail", e.target.value)} />
                </Field>
                <Field label="Téléphone" htmlFor="nr-phone">
                  <Input id="nr-phone" value={form.requesterPhone}
                    onChange={(e) => set("requesterPhone", e.target.value)} />
                </Field>
              </div>
            ) : null}
          </fieldset>

          {error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting || createRequest.isPending || noCatalog}>
              {submitting || createRequest.isPending ? "Création…" : "Créer la demande"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
