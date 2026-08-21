// Rendu du form_schema d'une démarche Socle : sections, champs simples et
// choix, conditions d'affichage, pièces justificatives (formats, cardinalités).
// La visibilité est recalculée à chaque saisie via le moteur partagé — le même
// moteur revalide côté serveur : ce rendu n'est qu'un confort.

import * as React from "react";
import { Paperclip, X } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  attachmentIsRequired,
  evaluateCondition,
  isSection,
  type Field as SchemaField,
  type FieldOption,
  type FormSchema,
  type FormValues,
  type Section,
} from "@fn/create-request-from-procedure/_shared/procedureForm";

interface Props {
  schema: FormSchema;
  /** Valeurs par id de champ (les conditions référencent les ids). */
  values: FormValues;
  onChange: (fieldId: string, value: unknown) => void;
  /** Fichiers choisis par id de champ pièce. */
  files: Record<string, File[]>;
  onFilesChange: (fieldId: string, files: File[]) => void;
  errors: Record<string, string>;
}

function FieldLabel({ text, required, conditional }: { text: string; required: boolean; conditional: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span>{text}</span>
      {required ? <span className="font-bold text-destructive" aria-hidden="true">*</span> : null}
      {conditional ? (
        <span className="rounded-full bg-secondary/50 px-1.5 py-0.5 text-[9.5px] font-bold leading-none text-secondary-foreground">
          conditionnel
        </span>
      ) : null}
    </span>
  );
}

/** Choix exclusif en pilules (Oui/Non, listes courtes) — réponse explicite, rien de présélectionné. */
function Segmented({ options, value, onChange, label }: {
  options: FieldOption[];
  value: string | null;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const checked = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
              checked
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-secondary hover:bg-secondary",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function AttachmentControl({ field, values, files, onFilesChange, error }: {
  field: Extract<SchemaField, { type: "attachment" }>;
  values: FormValues;
  files: Record<string, File[]>;
  onFilesChange: (fieldId: string, files: File[]) => void;
  error?: string;
}) {
  const chosen = files[field.id] ?? [];
  const required = attachmentIsRequired(field, values);
  const accept = field.acceptedFormats.map((f) => `.${f}`).join(",");
  const full = chosen.length >= field.maxFiles;
  const meta = [
    field.acceptedFormats.length > 0 ? field.acceptedFormats.map((f) => f.toUpperCase()).join(", ") : "Tout format",
    field.maxFiles > 1 ? `${field.maxFiles} fichiers max.` : "Un seul fichier",
  ].join(" — ");
  const [dragging, setDragging] = React.useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    onFilesChange(field.id, [...chosen, ...Array.from(list)].slice(0, field.maxFiles));
  };

  return (
    <Field
      label={<FieldLabel text={field.label} required={required} conditional={Boolean(field.visibleIf || field.requiredIf)} />}
      hint={field.help}
      error={error}
    >
      <label
        onDragOver={(e) => { e.preventDefault(); if (!full) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!full) addFiles(e.dataTransfer.files); }}
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-[10px] border px-3.5 py-2 text-left transition-colors",
          full ? "cursor-default" : "cursor-pointer",
          chosen.length > 0
            ? "border-solid border-primary/40 bg-primary/[0.04]"
            : "border-dashed border-border bg-card hover:bg-secondary/20",
          dragging && "border-primary bg-primary/[0.06]",
        )}
      >
        <Paperclip className={cn("size-4 shrink-0", chosen.length > 0 ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
        <span className="text-[13px] font-semibold">
          {full
            ? (field.maxFiles > 1 ? "Nombre maximal de fichiers atteint" : "Fichier déposé")
            : chosen.length > 0 ? "Ajouter un autre fichier" : "Déposer un fichier ou parcourir"}
        </span>
        <span className="text-[11.5px] text-muted-foreground">{meta}</span>
        <input
          id={`pf-${field.id}`}
          type="file"
          className="sr-only"
          accept={accept === "" ? undefined : accept}
          multiple={field.maxFiles > 1}
          disabled={full}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
      </label>
      {chosen.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {chosen.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{f.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
              </span>
              <button
                type="button"
                aria-label={`Retirer ${f.name}`}
                onClick={() => onFilesChange(field.id, chosen.filter((_, j) => j !== i))}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  );
}

function FieldControl({ field, values, onChange, files, onFilesChange, errors }: {
  field: SchemaField;
} & Omit<Props, "schema">) {
  const value = values[field.id];
  const error = errors[field.id];

  if (field.type === "attachment") {
    return (
      <AttachmentControl field={field} values={values} files={files}
        onFilesChange={onFilesChange} error={error} />
    );
  }

  const common = {
    label: (
      <FieldLabel text={field.label} required={field.required === true} conditional={Boolean(field.visibleIf)} />
    ),
    htmlFor: `pf-${field.id}`,
    hint: field.help,
    error,
  };

  switch (field.type) {
    case "textarea":
      return (
        <Field {...common}>
          <Textarea id={`pf-${field.id}`} placeholder={field.placeholder} maxLength={field.maxLength}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(field.id, e.target.value)} />
        </Field>
      );
    case "select":
      return (
        <Field {...common}>
          <Select id={`pf-${field.id}`} className="h-11 px-4" value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(field.id, e.target.value)}>
            <option value="">Sélectionner…</option>
            {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      );
    case "radio":
      return (
        <Field {...common}>
          {field.options.length <= 4 ? (
            <Segmented label={field.label} options={field.options}
              value={typeof value === "string" ? value : null}
              onChange={(v) => onChange(field.id, v)} />
          ) : (
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={field.label}>
              {field.options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`pf-${field.id}`} checked={value === o.value}
                    onChange={() => onChange(field.id, o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </Field>
      );
    case "checkboxes": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field {...common}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={field.label}>
            {field.options.map((o) => {
              const checked = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => onChange(field.id, checked
                    ? selected.filter((v) => v !== o.value)
                    : [...selected, o.value])}
                  className={cn(
                    "h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                    checked
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-secondary hover:bg-secondary",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </Field>
      );
    }
    case "boolean":
      return (
        <Field {...common}>
          <Segmented label={field.label}
            options={[{ value: "true", label: "Oui" }, { value: "false", label: "Non" }]}
            value={value === true ? "true" : value === false ? "false" : null}
            onChange={(v) => onChange(field.id, v === "true")} />
        </Field>
      );
    default: {
      const inputType = field.type === "number" ? "number"
        : field.type === "date" ? "date"
        : field.type === "email" ? "email"
        : field.type === "phone" ? "tel"
        : "text";
      return (
        <Field {...common}>
          <Input id={`pf-${field.id}`} type={inputType} placeholder={field.placeholder}
            maxLength={field.maxLength}
            value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
            onChange={(e) => onChange(field.id, e.target.value)} />
        </Field>
      );
    }
  }
}

/** Un champ long ou une pièce occupe toute la largeur de la grille. */
function spansFullWidth(field: SchemaField): boolean {
  return field.type === "textarea" || field.type === "attachment" || field.type === "checkboxes";
}

function FieldGrid({ fields, values, ...rest }: { fields: SchemaField[] } & Omit<Props, "schema">) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 md:grid-cols-2">
      {fields.map((field) =>
        evaluateCondition(field.visibleIf, values) ? (
          <div key={field.id} className={cn(spansFullWidth(field) && "md:col-span-2")}>
            <FieldControl field={field} values={values} {...rest} />
          </div>
        ) : null)}
    </div>
  );
}

export function ProcedureFormFields({ schema, values, onChange, files, onFilesChange, errors }: Props) {
  if (schema.content.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Cette démarche n'a pas de formulaire — passez au récapitulatif.
      </p>
    );
  }

  // Les champs racine consécutifs partagent une même grille ; chaque section
  // forme son propre groupe titré.
  const groups: ({ kind: "fields"; fields: SchemaField[] } | { kind: "section"; section: Section })[] = [];
  for (const node of schema.content) {
    if (isSection(node)) {
      groups.push({ kind: "section", section: node });
    } else {
      const last = groups[groups.length - 1];
      if (last && last.kind === "fields") last.fields.push(node);
      else groups.push({ kind: "fields", fields: [node] });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group, i) => {
        if (group.kind === "fields") {
          return (
            <FieldGrid key={`fields-${i}`} fields={group.fields} values={values} onChange={onChange}
              files={files} onFilesChange={onFilesChange} errors={errors} />
          );
        }
        const section = group.section;
        if (!evaluateCondition(section.visibleIf, values)) return null;
        return (
          <fieldset key={section.id} className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4 shadow-airbnb-sm">
            <legend className="px-1 text-sm font-bold">
              <span className="flex items-center gap-1.5">
                {section.title}
                {section.visibleIf ? (
                  <span className="rounded-full bg-secondary/50 px-1.5 py-0.5 text-[9.5px] font-bold leading-none text-secondary-foreground">
                    conditionnel
                  </span>
                ) : null}
              </span>
            </legend>
            {section.description ? (
              <p className="-mt-1 text-sm text-muted-foreground">{section.description}</p>
            ) : null}
            <FieldGrid fields={section.fields} values={values} onChange={onChange}
              files={files} onFilesChange={onFilesChange} errors={errors} />
          </fieldset>
        );
      })}
    </div>
  );
}
