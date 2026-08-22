// Modification d'une fiche usager — dialogue calqué sur `ContactFormDialog`
// de Clara (identité, coordonnées, adresse), restreint aux champs qu'Iris lit.
//
// L'enregistrement écrit dans le SOCLE : la correction profite à toute la
// gamme, et rien n'est conservé côté Iris. Le type d'usager n'est pas
// modifiable (immuable côté Socle), pas plus que le statut (archivage). Les
// refus du Socle (SIRET déjà pris, invariants) sont affichés tels quels.

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { contactTypeLabel } from "./usager";
import {
  buildContactPatch, formFromContact, isPerson, validateUsagerForm,
  type FieldErrors, type UsagerForm,
} from "./usagerEdit";
import { useUpdateContact } from "./useContacts";
import type { SocleContact } from "./rapprochement";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  contact: SocleContact;
  /** Confirmation à afficher par la page appelante. */
  onSaved: (message: string) => void;
}

export function UsagerEditDialog({ open, onOpenChange, organizationId, contact, onSaved }: Props) {
  const initial = React.useMemo(() => formFromContact(contact), [contact]);
  const [form, setForm] = React.useState<UsagerForm>(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [error, setError] = React.useState<string | null>(null);
  const update = useUpdateContact();

  // Réouverture (ou fiche relue) : on repart de l'état du Socle.
  React.useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
      setError(null);
    }
  }, [open, initial]);

  const person = isPerson(contact.contact_type);
  const set = (key: keyof UsagerForm) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const patch = buildContactPatch(initial, form, contact.contact_type);
  const changed = Object.keys(patch).length;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const found = validateUsagerForm(form, contact.contact_type);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setError("Corrigez les champs signalés avant d'enregistrer.");
      return;
    }
    if (changed === 0) {
      setError("Aucune modification à enregistrer.");
      return;
    }
    try {
      await update.mutateAsync({ organizationId, socleContactId: contact.id, patch });
      onOpenChange(false);
      onSaved(`Fiche usager mise à jour dans le Socle — ${changed} champ${changed > 1 ? "s" : ""}`);
    } catch (err) {
      // Message du Socle relayé tel quel (SIRET en doublon, invariant de type…).
      setError(err instanceof Error ? err.message : "Modification refusée.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modifier l'usager</DialogTitle>
          <DialogDescription>
            {contactTypeLabel(contact.contact_type)} · la modification est enregistrée dans le
            référentiel Socle, pour toute la gamme. Le type d'usager n'est pas modifiable.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-bold">Identité</h3>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
              {person ? (
                <>
                  <Field label="Civilité" htmlFor="ue-civility" required error={errors.civility}>
                    <Select id="ue-civility" value={form.civility}
                      onChange={(e) => set("civility")(e.target.value)}>
                      <option value="">—</option>
                      <option value="madame">Madame</option>
                      <option value="monsieur">Monsieur</option>
                    </Select>
                  </Field>
                  <Field label="Prénom(s)" htmlFor="ue-first">
                    <Input id="ue-first" value={form.firstName} maxLength={200}
                      onChange={(e) => set("firstName")(e.target.value)} />
                  </Field>
                  <Field label="Nom de naissance" htmlFor="ue-last" error={errors.lastName}>
                    <Input id="ue-last" value={form.lastName} maxLength={200}
                      onChange={(e) => set("lastName")(e.target.value)} />
                  </Field>
                  <Field label="Nom d'usage" htmlFor="ue-usage">
                    <Input id="ue-usage" value={form.usageName} maxLength={200}
                      onChange={(e) => set("usageName")(e.target.value)} />
                  </Field>
                  <Field label="Date de naissance" htmlFor="ue-birth" error={errors.birthDate}>
                    <Input id="ue-birth" type="date" value={form.birthDate}
                      onChange={(e) => set("birthDate")(e.target.value)} />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Raison sociale" htmlFor="ue-legal" required error={errors.legalName}>
                    <Input id="ue-legal" value={form.legalName} maxLength={300}
                      onChange={(e) => set("legalName")(e.target.value)} />
                  </Field>
                  <Field label="SIRET" htmlFor="ue-siret" hint="14 chiffres" error={errors.siret}>
                    <Input id="ue-siret" value={form.siret} inputMode="numeric"
                      onChange={(e) => set("siret")(e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-sm font-bold">Coordonnées</h3>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
              <Field label="Courriel" htmlFor="ue-email" error={errors.email}>
                <Input id="ue-email" type="email" value={form.email} maxLength={255}
                  onChange={(e) => set("email")(e.target.value)} />
              </Field>
              <Field label="Canal préféré" htmlFor="ue-channel">
                <Select id="ue-channel" value={form.preferredChannel}
                  onChange={(e) => set("preferredChannel")(e.target.value)}>
                  <option value="">—</option>
                  <option value="email">Courriel</option>
                  <option value="telephone">Téléphone</option>
                  <option value="courrier">Courrier</option>
                </Select>
              </Field>
              <Field label="Téléphone mobile" htmlFor="ue-mobile">
                <Input id="ue-mobile" value={form.mobilePhone} maxLength={50}
                  onChange={(e) => set("mobilePhone")(e.target.value)} />
              </Field>
              <Field label="Téléphone fixe" htmlFor="ue-landline">
                <Input id="ue-landline" value={form.landlinePhone} maxLength={50}
                  onChange={(e) => set("landlinePhone")(e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-sm font-bold">Adresse</h3>
            <p className="text-xs text-muted-foreground">
              Le quartier est recalculé par le Socle à partir de l'adresse — il ne se saisit pas ici.
            </p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
              <Field label="Adresse" htmlFor="ue-line1" className="md:col-span-2">
                <Input id="ue-line1" value={form.addressLine1} maxLength={300}
                  onChange={(e) => set("addressLine1")(e.target.value)} />
              </Field>
              <Field label="Complément" htmlFor="ue-line2" className="md:col-span-2">
                <Input id="ue-line2" value={form.addressLine2} maxLength={300}
                  onChange={(e) => set("addressLine2")(e.target.value)} />
              </Field>
              <Field label="Code postal" htmlFor="ue-postal">
                <Input id="ue-postal" value={form.postalCode} maxLength={20}
                  onChange={(e) => set("postalCode")(e.target.value)} />
              </Field>
              <Field label="Ville" htmlFor="ue-city">
                <Input id="ue-city" value={form.city} maxLength={200}
                  onChange={(e) => set("city")(e.target.value)} />
              </Field>
              <Field label="Pays" htmlFor="ue-country" required error={errors.country}>
                <Input id="ue-country" value={form.country} maxLength={100}
                  onChange={(e) => set("country")(e.target.value)} />
              </Field>
            </div>
          </section>

          {error ? (
            <p role="alert" className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="mt-0 items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {changed === 0
                ? "Aucune modification"
                : `${changed} champ${changed > 1 ? "s" : ""} modifié${changed > 1 ? "s" : ""}`}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={update.isPending || changed === 0}>
                {update.isPending ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
