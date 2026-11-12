// Courrier de réponse papier, proposé DANS la modale de clôture (2026-11-12).
//
// Composant CONTRÔLÉ, partagé par la fiche (`TransitionDialog`) et le mobile
// (`MobileStatusSheet`) : l'état vit dans le dialogue, qui le remet à zéro à
// chaque ouverture et l'ajoute à ce qu'il soumet (`TransitionInput.letter`).
//
// La liste vient de `closureLetters` (module partagé avec le serveur) : les
// courriers de la démarche visibles pour l'issue CHOISIE, fusionnables, jamais
// un document interne. La génération elle-même suit la clôture, sans la
// conditionner (`useClosureLetter`).

import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { DocumentTemplate } from "@fn/_shared/document/templates";
import { FORMATS, type DocumentFormat } from "./documents";

export interface ClosureLetterDraft {
  enabled: boolean;
  templateId: string;
  format: DocumentFormat;
}

export function emptyClosureLetter(): ClosureLetterDraft {
  return { enabled: false, templateId: "", format: "pdf" };
}

/** Le choix est-il complet ? Interrupteur coupé = rien à compléter. */
export function closureLetterReady(draft: ClosureLetterDraft): boolean {
  return !draft.enabled || draft.templateId !== "";
}

/** Ce que le dialogue ajoute à sa soumission, ou rien. */
export function closureLetterChoice(
  draft: ClosureLetterDraft,
): { templateId: string; format: DocumentFormat } | undefined {
  return draft.enabled && draft.templateId !== ""
    ? { templateId: draft.templateId, format: draft.format }
    : undefined;
}

export function ClosureLetterSection({
  idPrefix,
  letters,
  loading,
  error,
  value,
  onChange,
}: {
  idPrefix: string;
  /** Courriers proposés pour l'issue choisie (`closureLetters`). */
  letters: DocumentTemplate[];
  loading: boolean;
  error: boolean;
  value: ClosureLetterDraft;
  onChange: (next: ClosureLetterDraft) => void;
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Recherche des courriers de la démarche…</p>;
  }
  if (error) {
    return (
      <p className="text-xs text-muted-foreground">
        Les courriers de la démarche n'ont pas pu être lus : vous pourrez en produire un depuis
        l'onglet Documents.
      </p>
    );
  }
  if (letters.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">Aucun courrier prévu par la démarche pour cette issue.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3">
      <label htmlFor={`${idPrefix}-letter-toggle`} className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Générer un courrier de réponse papier</span>
        <input
          id={`${idPrefix}-letter-toggle`}
          type="checkbox"
          role="switch"
          className="size-4 accent-[hsl(var(--primary))]"
          checked={value.enabled}
          onChange={(e) =>
            onChange({
              ...value,
              enabled: e.target.checked,
              // Un seul courrier prévu : il est déjà choisi.
              templateId: e.target.checked && letters.length === 1 ? letters[0].id : value.templateId,
            })}
        />
      </label>

      {value.enabled ? (
        <>
          <Field label="Courrier" htmlFor={`${idPrefix}-letter`} required
            error={value.templateId === "" ? "Choisissez le courrier à générer." : undefined}>
            <Select
              id={`${idPrefix}-letter`}
              value={value.templateId}
              onChange={(e) => onChange({ ...value, templateId: e.target.value })}
            >
              <option value="">— Choisir —</option>
              {letters.map((letter) => (
                <option key={letter.id} value={letter.id}>{letter.name}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Format"
            htmlFor={`${idPrefix}-letter-format`}
            hint={FORMATS.find((f) => f.value === value.format)?.sub}
          >
            <Select
              id={`${idPrefix}-letter-format`}
              value={value.format}
              onChange={(e) => onChange({ ...value, format: e.target.value as DocumentFormat })}
            >
              {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </Field>
          <p className="text-xs text-muted-foreground">
            Généré après la clôture, ajouté aux documents de la demande, puis{" "}
            {value.format === "pdf" ? "ouvert dans un nouvel onglet" : "téléchargé"}.
          </p>
        </>
      ) : null}
    </div>
  );
}
