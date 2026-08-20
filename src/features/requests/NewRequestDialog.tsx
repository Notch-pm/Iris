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
import type { RequestFacets } from "./facets";
import { buildNewRequestInsert, EMPTY_NEW_REQUEST, type NewRequestForm } from "./newRequest";
import { PRIORITY_LABELS } from "./statuts";
import { useCreateRequest } from "./useRequests";

const FREE_PROCEDURE = "__libre__";
const OTHER_PROCEDURE = "__autre__";

interface Props {
  organizationId: string;
  facets: RequestFacets | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewRequestDialog({ organizationId, facets, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const createRequest = useCreateRequest();
  const [form, setForm] = React.useState<NewRequestForm>(EMPTY_NEW_REQUEST);
  const [procedureChoice, setProcedureChoice] = React.useState(FREE_PROCEDURE);
  const [error, setError] = React.useState<string | null>(null);

  const set = <K extends keyof NewRequestForm>(key: K, value: NewRequestForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function reset() {
    setForm(EMPTY_NEW_REQUEST);
    setProcedureChoice(FREE_PROCEDURE);
    setError(null);
  }

  function onProcedureChange(value: string) {
    setProcedureChoice(value);
    if (value === FREE_PROCEDURE) {
      set("procedureId", null);
      set("procedureLabel", "");
    } else if (value === OTHER_PROCEDURE) {
      set("procedureId", null);
    } else {
      const option = facets?.procedures.find((p) => p.value === value);
      set("procedureId", value);
      set("procedureLabel", option?.label ?? "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const built = buildNewRequestInsert(form, organizationId);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    try {
      const created = await createRequest.mutateAsync(built.insert);
      onOpenChange(false);
      reset();
      navigate(`/demandes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la création.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle demande</DialogTitle>
          <DialogDescription>
            La demande naît « À traiter ». Le catalogue complet des démarches Socle arrivera
            avec la synchronisation du référentiel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Objet" htmlFor="nr-subject" required>
            <Input id="nr-subject" required value={form.subject}
              onChange={(e) => set("subject", e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="nr-body">
            <Textarea id="nr-body" value={form.body} onChange={(e) => set("body", e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Démarche Socle" htmlFor="nr-procedure">
              <Select id="nr-procedure" value={procedureChoice}
                onChange={(e) => onProcedureChange(e.target.value)}>
                <option value={FREE_PROCEDURE}>Demande libre (sans démarche)</option>
                {(facets?.procedures ?? []).map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
                <option value={OTHER_PROCEDURE}>Autre démarche…</option>
              </Select>
            </Field>
            <Field label="Priorité" htmlFor="nr-priority">
              <Select id="nr-priority" value={form.priority}
                onChange={(e) => set("priority", e.target.value as NewRequestForm["priority"])}>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
          </div>
          {procedureChoice === OTHER_PROCEDURE ? (
            <Field label="Libellé de la démarche" htmlFor="nr-procedure-label"
              hint="Sera rapprochée du référentiel Socle à la qualification.">
              <Input id="nr-procedure-label" value={form.procedureLabel}
                onChange={(e) => set("procedureLabel", e.target.value)} />
            </Field>
          ) : null}

          <Field label="Organisation destinataire" htmlFor="nr-destination"
            hint="Libellé libre tant que le miroir des organisations Socle n'est pas synchronisé.">
            <Input id="nr-destination" value={form.destinationLabel}
              onChange={(e) => set("destinationLabel", e.target.value)} />
          </Field>

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
            <Button type="submit" disabled={createRequest.isPending}>
              {createRequest.isPending ? "Création…" : "Créer la demande"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
