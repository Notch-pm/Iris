// Étape 4 — récapitulatif avant création : doublons probables à lier, groupes
// relisibles (démarche & instruction, usager, demande, réponses au formulaire)
// avec retour à l'étape concernée.

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FacetOption } from "@/features/requests/facets";
import type { RequesterResolution } from "@/features/contacts/rapprochement";
import type { FormValues } from "@fn/create-request-from-procedure/_shared/procedureForm";
import {
  CONSENTS,
  consentsSatisfied,
  consentStatement,
  type ConsentKind,
} from "@fn/_shared/consents/catalog";
import { PRIORITY_LABELS } from "../statuts";
import { activeFields, fieldIsRequired } from "./fiche";
import { displayFieldValue, requesterRows, type CreationStep, type LinkedRequests, type LoadedProcedure } from "./model";
import { depositLabel, type NearbyScored } from "./proches";

interface Props {
  procedure: LoadedProcedure;
  categoryLabel: string | null;
  destination: { value: string; options: FacetOption[]; onChange: (value: string) => void };
  channelLabel: string;
  priority: string;
  subject: string;
  body: string;
  resolution: RequesterResolution;
  values: FormValues;
  files: Record<string, File[]>;
  duplicates: NearbyScored[];
  dupDismissed: boolean;
  onDismissDup: () => void;
  linked: LinkedRequests;
  onToggleLink: (id: string, reference: string) => void;
  /** Réponses aux consentements RGPD — état d'écran, la garde vit au serveur. */
  consents: Record<ConsentKind, boolean>;
  onToggleConsent: (kind: ConsentKind, granted: boolean) => void;
  /** Organisme principal, interpolé dans le libellé du consentement au partage. */
  organismName: string | null;
  onEdit: (step: CreationStep) => void;
  now: Date;
}

interface Row {
  label: string;
  value: React.ReactNode;
  missing?: boolean;
  mono?: boolean;
}

function Group({ title, onEdit, rows, children }: {
  title: string;
  onEdit: () => void;
  rows: Row[];
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card px-[18px] py-4 shadow-airbnb-sm">
      <div className="flex items-center justify-between gap-2.5">
        <h4 className="text-sm font-bold">{title}</h4>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onEdit}>
          Modifier
        </Button>
      </div>
      {rows.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-5 gap-y-2.5 md:grid-cols-2">
          {rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="flex flex-col gap-0.5 border-b border-border pb-2">
              <dt className="text-[11px] font-semibold text-muted-foreground">{r.label}</dt>
              <dd className={cn(
                "text-[13px] font-semibold",
                r.missing ? "text-destructive" : "text-foreground",
                r.mono && "font-mono text-xs font-medium",
              )}>
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Consentements RGPD — les DEUX questions posées à l'usager, à chaque dépôt,
 * quelle que soit la démarche.
 *
 * Elles ne sont pas dans `form_schema` et ne le seront pas : un consentement
 * qu'un service pourrait décocher dans son paramétrage ne vaudrait rien. Le
 * catalogue est fermé (`@fn/_shared/consents/catalog`), partagé avec les edge
 * functions, et c'est le SERVEUR qui recompose la phrase consignée — l'écran
 * l'affiche ici à l'identique pour que l'agent lise à l'usager exactement ce
 * qui sera enregistré.
 *
 * Sa place est au récapitulatif : c'est le moment du dépôt, pas celui de la
 * saisie. L'obligatoire ferme les boutons de création tant qu'il n'est pas
 * coché (reflet — la garde est dans `create-request-from-procedure`).
 */
function ConsentGroup({ consents, onToggle, organismName }: {
  consents: Record<ConsentKind, boolean>;
  onToggle: (kind: ConsentKind, granted: boolean) => void;
  organismName: string | null;
}) {
  const missing = !consentsSatisfied(consents);
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card px-[18px] py-4 shadow-airbnb-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold">Consentements de l'usager</h4>
        <span className="text-[11px] font-semibold text-muted-foreground">
          À lire à l'usager — enregistrés au référentiel
        </span>
      </div>
      {CONSENTS.map((def) => (
        <label
          key={def.kind}
          className="flex items-start gap-2.5 rounded-[10px] border border-border bg-muted/30 p-3"
        >
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input text-primary"
            checked={consents[def.kind] === true}
            onChange={(e) => onToggle(def.kind, e.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold leading-relaxed">
              {consentStatement(def.kind, organismName)}
            </span>
            <span className="text-xs text-muted-foreground">
              {def.required
                ? "Obligatoire — sans ce consentement, la demande ne peut pas être déposée."
                : "Facultatif — l'usager peut le refuser sans conséquence sur sa demande."}
            </span>
          </span>
        </label>
      ))}
      {missing ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          Le consentement au traitement des informations est obligatoire pour valider le dépôt.
        </p>
      ) : null}
    </section>
  );
}

export function RequestSummary({
  procedure, categoryLabel, destination, channelLabel, priority, subject, body, resolution,
  values, files, duplicates, dupDismissed, onDismissDup, linked, onToggleLink,
  consents, onToggleConsent, organismName, onEdit, now,
}: Props) {
  const topDup = duplicates[0];
  const showBanner = !dupDismissed && duplicates.length > 0 && topDup !== undefined;

  const answerRows: Row[] = activeFields(procedure.schema, values).map((entry) => {
    const field = entry.field;
    const required = fieldIsRequired(entry, values);
    if (field.type === "attachment") {
      const names = (files[field.id] ?? []).map((f) => f.name);
      const missing = required && names.length === 0;
      return { label: field.label, value: names.length > 0 ? names.join(", ") : "Non fournie", missing };
    }
    const text = displayFieldValue(field, values[field.id]);
    const missing = required && text === "";
    return { label: field.label, value: text === "" ? "—" : text, missing };
  });

  const linkedCount = Object.keys(linked).length;

  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      {showBanner ? (
        <div role="alert" className="flex gap-3 rounded-[14px] border border-secondary bg-secondary/30 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-secondary-foreground" aria-hidden="true" />
          <div className="flex flex-1 flex-col gap-2">
            <span className="font-extrabold text-secondary-foreground">
              {duplicates.length} demande{duplicates.length > 1 ? "s" : ""} très proche{duplicates.length > 1 ? "s" : ""} détectée{duplicates.length > 1 ? "s" : ""}
            </span>
            <span className="text-[13px] leading-relaxed text-secondary-foreground/90">
              {topDup.reference} — {topDup.socle_procedure_label ?? topDup.subject}, {depositLabel(topDup.created_at, now)}.{" "}
              {topDup.reasons.join(", ")}. Liez les deux demandes pour éviter un doublon d'instruction,
              ou poursuivez en connaissance de cause.
            </span>
            <span className="flex flex-wrap gap-2">
              <Button type="button" size="sm"
                className="bg-secondary-foreground text-primary-foreground hover:brightness-110"
                onClick={() => onToggleLink(topDup.id, topDup.reference)}>
                {linked[topDup.id] ? `Liée à ${topDup.reference} ✓` : `Lier à ${topDup.reference}`}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-secondary-foreground" onClick={onDismissDup}>
                Ignorer et continuer
              </Button>
            </span>
          </div>
        </div>
      ) : null}

      <Group title="Démarche & instruction" onEdit={() => onEdit(1)} rows={[
        { label: "Démarche", value: procedure.snapshot.name },
        { label: "Catégorie de démarche", value: categoryLabel ?? "—" },
        { label: "Priorité", value: PRIORITY_LABELS[priority] ?? priority },
        { label: "Canal", value: channelLabel },
      ]}>
        <div className="max-w-md">
          <Field
            label="Organisme"
            htmlFor="rs-destination"
            required
            hint="Organisation Socle qui porte la demande et décide de qui pourra l'instruire."
            error={
              destination.options.length === 0
                ? "Aucune organisation de votre périmètre n'autorise la création sur cette démarche — contactez votre administrateur."
                : destination.value === ""
                  ? "Obligatoire — choisissez l'organisme qui portera la demande."
                  : undefined
            }
          >
            <Select
              id="rs-destination"
              className="h-10"
              value={destination.value}
              disabled={destination.options.length === 0}
              onChange={(e) => destination.onChange(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {destination.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Group>

      <Group title="Usager" onEdit={() => onEdit(2)}
        rows={requesterRows(resolution).map((r) => ({ label: r.label, value: r.value, mono: r.mono }))} />

      <Group title="Demande" onEdit={() => onEdit(3)} rows={[
        { label: "Objet", value: subject.trim() === "" ? "—" : subject, missing: subject.trim() === "" },
        { label: "Description", value: body.trim() === "" ? "—" : <span className="whitespace-pre-wrap font-medium">{body}</span> },
      ]} />

      <Group title="Réponses au formulaire" onEdit={() => onEdit(3)} rows={answerRows}>
        {answerRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Cette démarche n'a pas de formulaire.</p>
        ) : null}
      </Group>

      <ConsentGroup
        consents={consents}
        onToggle={onToggleConsent}
        organismName={organismName}
      />

      {linkedCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          À la création, la demande sera liée à {Object.values(linked).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
