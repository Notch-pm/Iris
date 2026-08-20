// Rendu du form_schema d'une démarche Socle : sections, champs simples et
// choix, conditions d'affichage, pièces justificatives (formats, cardinalités).
// La visibilité est recalculée à chaque saisie via le moteur partagé — le même
// moteur revalide côté serveur : ce rendu n'est qu'un confort.

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  attachmentIsRequired,
  evaluateCondition,
  isSection,
  type Field as SchemaField,
  type FormSchema,
  type FormValues,
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

function FieldControl({ field, values, onChange, files, onFilesChange, errors }: {
  field: SchemaField;
} & Omit<Props, "schema">) {
  const value = values[field.id];
  const error = errors[field.id];

  if (field.type === "attachment") {
    const chosen = files[field.id] ?? [];
    const required = attachmentIsRequired(field, values);
    const accept = field.acceptedFormats.map((f) => `.${f}`).join(",");
    const hint = [
      field.acceptedFormats.length > 0 ? `Formats : ${field.acceptedFormats.join(", ")}` : null,
      field.maxFiles > 1 ? `${field.maxFiles} fichiers maximum` : "Un seul fichier",
      field.help ?? null,
    ].filter(Boolean).join(" · ");
    return (
      <Field label={field.label} htmlFor={`pf-${field.id}`} required={required}
        hint={hint} error={error}>
        <input
          id={`pf-${field.id}`}
          type="file"
          className="text-sm"
          accept={accept === "" ? undefined : accept}
          multiple={field.maxFiles > 1}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            onFilesChange(field.id, [...chosen, ...list].slice(0, field.maxFiles));
            e.target.value = "";
          }}
        />
        {chosen.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {chosen.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{f.name}</span>
                <Button type="button" variant="ghost" size="sm"
                  onClick={() => onFilesChange(field.id, chosen.filter((_, j) => j !== i))}>
                  Retirer
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Field>
    );
  }

  const common = {
    label: field.label,
    htmlFor: `pf-${field.id}`,
    required: field.required === true,
    hint: field.help,
    error,
  };

  switch (field.type) {
    case "textarea":
      return (
        <Field {...common}>
          <Textarea id={`pf-${field.id}`} placeholder={field.placeholder}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(field.id, e.target.value)} />
        </Field>
      );
    case "select":
      return (
        <Field {...common}>
          <Select id={`pf-${field.id}`} value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(field.id, e.target.value)}>
            <option value="">—</option>
            {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      );
    case "radio":
      return (
        <Field {...common}>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={field.label}>
            {field.options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input type="radio" name={`pf-${field.id}`} checked={value === o.value}
                  onChange={() => onChange(field.id, o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        </Field>
      );
    case "checkboxes": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field {...common}>
          <div className="flex flex-col gap-1.5">
            {field.options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(o.value)}
                  onChange={(e) => onChange(field.id, e.target.checked
                    ? [...selected, o.value]
                    : selected.filter((v) => v !== o.value))} />
                {o.label}
              </label>
            ))}
          </div>
        </Field>
      );
    }
    case "boolean":
      return (
        <Field {...common}>
          <div className="flex gap-4" role="radiogroup" aria-label={field.label}>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`pf-${field.id}`} checked={value === true}
                onChange={() => onChange(field.id, true)} />
              Oui
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={`pf-${field.id}`} checked={value === false}
                onChange={() => onChange(field.id, false)} />
              Non
            </label>
          </div>
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

export function ProcedureFormFields({ schema, values, onChange, files, onFilesChange, errors }: Props) {
  if (schema.content.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Cette démarche n'a pas de formulaire — passez à l'étape suivante.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {schema.content.map((node) => {
        if (isSection(node)) {
          if (!evaluateCondition(node.visibleIf, values)) return null;
          return (
            <fieldset key={node.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold">{node.title}</legend>
              {node.description ? (
                <p className="text-sm text-muted-foreground">{node.description}</p>
              ) : null}
              {node.fields.map((field) =>
                evaluateCondition(field.visibleIf, values) ? (
                  <FieldControl key={field.id} field={field} values={values} onChange={onChange}
                    files={files} onFilesChange={onFilesChange} errors={errors} />
                ) : null)}
            </fieldset>
          );
        }
        if (!evaluateCondition(node.visibleIf, values)) return null;
        return (
          <FieldControl key={node.id} field={node} values={values} onChange={onChange}
            files={files} onFilesChange={onFilesChange} errors={errors} />
        );
      })}
    </div>
  );
}
