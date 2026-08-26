// Création / modification d'un modèle d'e-mail.
//
// Trois choses au même endroit, parce qu'écrire un modèle sans elles est
// pénible : les champs, la liste des variables (cliquables — on ne demande à
// personne de retenir `{{demande.date_instruction}}`), et l'aperçu du rendu.
//
// La validation locale DOUBLE la base (contraintes, garde de variables) : elle
// ne la remplace pas. L'unicité du nom, elle, ne se voit qu'au serveur — son
// message remonte du hook.

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  hasErrors, insertVariable, previewValues, renderTemplate, TEMPLATE_VARIABLES,
  validateTemplateDraft, VARIABLE_GROUP_LABELS, type TemplateDraft, type VariableGroup,
} from "./templates";
import { useSaveEmailTemplate } from "./useEmailTemplates";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  title: string;
  initialDraft: TemplateDraft;
  /** Absent = création. */
  templateId?: string;
  expectedVersion?: number;
  /** Reçoit l'identifiant ET le nom du modèle enregistré — l'appelant enchaîne
   *  sur la modale d'activation. Le nom vient d'ICI : le parent ne connaît que
   *  le brouillon INITIAL, pas ce qui vient d'être saisi. */
  onSaved: (templateId: string, name: string) => void;
}

const GROUP_ORDER: VariableGroup[] = ["usager", "demande", "agent", "organisation"];

export function EmailTemplateDialog({
  open, onOpenChange, orgId, title, initialDraft, templateId, expectedVersion, onSaved,
}: Props) {
  const save = useSaveEmailTemplate(orgId);
  const [draft, setDraft] = React.useState<TemplateDraft>(initialDraft);
  // Les erreurs n'apparaissent qu'après une première tentative : on ne
  // reproche rien à quelqu'un qui n'a pas fini de taper.
  const [submitted, setSubmitted] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const subjectRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  // On ne retient QUE le champ visé. La position du curseur et le texte sont
  // relus dans le DOM au moment de l'insertion : mémoriser un curseur dans une
  // ref le désynchronise du contenu dès la frappe suivante, et les insertions
  // partent alors au mauvais endroit.
  const lastField = React.useRef<"subject" | "body">("body");

  const errors = validateTemplateDraft(draft);
  const shown = submitted ? errors : {};

  const preview = React.useMemo(() => {
    const values = previewValues();
    return {
      subject: renderTemplate(draft.subject, values),
      body: renderTemplate(draft.body, values),
    };
  }, [draft.subject, draft.body]);

  function set(key: keyof TemplateDraft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setServerError(null);
  }

  function addVariable(key: string) {
    const field = lastField.current;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    if (!el) return;

    // `el.value` et `el.selectionStart` sont la vérité du moment — pas un
    // instantané pris à la frappe précédente.
    const out = insertVariable(el.value, el.selectionStart ?? el.value.length, key);
    set(field, out.text);

    // Le curseur doit atterrir après le jeton, une fois React a réécrit la valeur.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(out.caret, out.caret);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (hasErrors(errors)) return;
    try {
      const savedId = await save.mutateAsync({ draft, id: templateId, expectedVersion });
      onOpenChange(false);
      // Une création dont on ne récupère pas l'identifiant ne peut pas
      // enchaîner : on ferme sans prétendre le contraire.
      if (savedId) onSaved(savedId, draft.name.trim());
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Texte simple. Les variables entre accolades sont remplacées par les informations
            de la demande au moment de l'envoi.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom du modèle" htmlFor="tpl-name" required error={shown.name}>
              <Input
                id="tpl-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Accusé de réception"
              />
            </Field>
            <Field label="Description" htmlFor="tpl-desc" hint="Quand utiliser ce modèle.">
              <Input
                id="tpl-desc"
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Envoyé dès le dépôt de la demande"
              />
            </Field>
          </div>

          <Field label="Objet" htmlFor="tpl-subject" required error={shown.subject}>
            <Input
              id="tpl-subject"
              ref={subjectRef}
              value={draft.subject}
              onChange={(e) => set("subject", e.target.value)}
              onFocus={() => { lastField.current = "subject"; }}
              placeholder="Votre demande {{demande.reference}}"
            />
          </Field>

          <Field label="Corps du message" htmlFor="tpl-body" required error={shown.body}>
            <Textarea
              id="tpl-body"
              ref={bodyRef}
              className="min-h-[160px]"
              value={draft.body}
              onChange={(e) => set("body", e.target.value)}
              onFocus={() => { lastField.current = "body"; }}
              placeholder={"Bonjour {{usager.civilite}} {{usager.nom}},\n\nNous avons bien reçu votre demande…"}
            />
          </Field>

          {/* Variables disponibles — cliquables, insérées au curseur. */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Variables disponibles
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Cliquez pour insérer dans le dernier champ où vous avez écrit.
            </p>
            <div className="mt-3 flex flex-col gap-2.5">
              {GROUP_ORDER.map((group) => {
                const vars = TEMPLATE_VARIABLES.filter((v) => v.group === group);
                if (vars.length === 0) return null;
                return (
                  <div key={group} className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {VARIABLE_GROUP_LABELS[group]}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {vars.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          title={v.hint ? `${v.hint} — exemple : ${v.sample}` : `Exemple : ${v.sample}`}
                          onClick={() => addVariable(v.key)}
                          className={cn(
                            "rounded-md border border-border bg-card px-2 py-1 text-[11px]",
                            "transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
                          )}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Aperçu — valeurs d'exemple, jamais une vraie demande. */}
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Aperçu
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Rendu avec des valeurs d'exemple.
            </p>
            <p className="mt-2.5 text-sm font-semibold">
              {preview.subject || <span className="text-muted-foreground">(objet vide)</span>}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
              {preview.body || <span className="text-muted-foreground">(corps vide)</span>}
            </p>
          </div>

          {serverError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {serverError}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
