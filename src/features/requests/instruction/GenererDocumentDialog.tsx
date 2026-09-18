// Génération d'un document depuis un modèle de la démarche.
//
// LES MODÈLES VIENNENT DU SOCLE : le paramétreur a choisi, démarche par
// démarche, ce qu'un agent peut produire — et la règle de visibilité du
// référentiel décide de ce qui s'affiche ici (`visibleTemplates`). Iris ne
// propose rien de son cru, et le fichier ne transite pas par le navigateur.
//
// L'APERÇU AVANT DE PRODUIRE est le cœur de cet écran : l'agent voit, jeton par
// jeton, ce que le modèle demande et ce que CETTE demande lui donnera. Un
// courrier part avec le nom d'un habitant ; découvrir un blanc après l'envoi
// coûte cher, le voir avant ne coûte rien.
//
// Trois choses y sont dites franchement, parce qu'elles se paient à l'usage :
//   · les jetons hors catalogue restent tels quels dans le document ;
//   · ce que le rendu PDF ne reprendra pas (le Word, lui, est identique) ;
//   · qu'un document interne ne sortira jamais.

import * as React from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  groupTemplates, isMergeable, unmergeableReason,
  type DocumentTemplate, type ProcedureDocuments,
} from "@fn/_shared/document/templates";
import {
  FORMATS, kindLabel, pdfWarningLine, previewValue, type DocumentFormat,
} from "./documents";
import type { DocumentPreview } from "./useGenerateDocument";

interface Props {
  open: boolean;
  /** Les modèles VISIBLES pour cette demande (règle Socle déjà appliquée). */
  templates: DocumentTemplate[];
  documents: ProcedureDocuments;
  loadingTemplates: boolean;
  templatesError: string | null;
  /** Le groupe du bouton cliqué : « Pièces d'instruction » ou « Courriers ». */
  defaultGroup: "document" | "courrier";
  preview: DocumentPreview | null;
  previewing: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onPickTemplate: (templateId: string) => void;
  onSubmit: (templateId: string, format: DocumentFormat) => void;
}

export function GenererDocumentDialog({
  open, templates, documents, loadingTemplates, templatesError, defaultGroup,
  preview, previewing, pending, error, onClose, onPickTemplate, onSubmit,
}: Props) {
  const [templateId, setTemplateId] = React.useState("");
  const [format, setFormat] = React.useState<DocumentFormat>("pdf");

  const groups = React.useMemo(() => groupTemplates(templates), [templates]);
  const preferred = defaultGroup === "courrier" ? groups.courriers : groups.documents;

  React.useEffect(() => {
    if (!open) return;
    setFormat("pdf");
    // Un seul modèle dans le groupe visé : on le choisit, l'aperçu part seul.
    const first = preferred.length === 1 ? preferred[0].id : "";
    setTemplateId(first);
    if (first) onPickTemplate(first);
    // Le groupe et la liste suffisent : rouvrir le dialogue relance le choix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultGroup, templates.length]);

  const selected = templates.find((t) => t.id === templateId) ?? null;
  const mergeable = selected ? isMergeable(selected.file_name) : true;
  const warning = format === "pdf" ? pdfWarningLine(preview?.pdf_warnings ?? []) : "";
  const unknown = preview?.scan.unknown ?? [];

  function choose(id: string) {
    setTemplateId(id);
    if (id) onPickTemplate(id);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Générer un document</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); if (templateId && mergeable) onSubmit(templateId, format); }}
        >
          <Field
            label="Modèle"
            htmlFor="doc-template"
            required
            hint={
              documents.restrict_visibility
                ? "Les modèles proposés sont ceux que la démarche autorise à ce stade du dossier."
                : "Modèles paramétrés sur la démarche, dans le Référentiel."
            }
            error={templatesError ?? undefined}
          >
            <Select
              id="doc-template"
              value={templateId}
              disabled={pending || loadingTemplates || templates.length === 0}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="">
                {loadingTemplates
                  ? "Chargement des modèles…"
                  : templates.length === 0
                    ? "Aucun modèle proposé pour cette demande"
                    : "Choisir un modèle…"}
              </option>
              {groups.documents.length > 0 ? (
                <optgroup label="Documents">
                  {groups.documents.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} — {kindLabel(t.type === "interne" ? "instruction_interne" : "instruction_externe")}</option>
                  ))}
                </optgroup>
              ) : null}
              {groups.courriers.length > 0 ? (
                <optgroup label="Courriers">
                  {groups.courriers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>

          {templates.length === 0 && !loadingTemplates && !templatesError ? (
            <p className="text-[12.5px] text-muted-foreground">
              {documents.items.length > 0
                ? "Les modèles de cette démarche sont réservés à un autre stade du dossier (par exemple une clôture positive ou négative)."
                : "Aucun modèle n'a été paramétré sur cette démarche dans le Référentiel."}
            </p>
          ) : null}

          {selected ? (
            <p className="text-[12.5px] text-muted-foreground">
              <span className="font-semibold text-foreground">{selected.name}</span>
              {" · "}{selected.file_name}
              {selected.description ? ` · ${selected.description}` : ""}
              {selected.type === "interne" ? " · ne sera jamais transmis à l'usager" : ""}
            </p>
          ) : null}

          {selected && !mergeable ? (
            <p role="alert" className="rounded-[10px] border border-secondary/60 bg-secondary/25 px-3 py-2 text-[12px] text-secondary-foreground">
              {unmergeableReason(selected.file_name)}
            </p>
          ) : null}

          {previewing ? (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Lecture du modèle…
            </p>
          ) : null}

          {preview ? (
            <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-muted/30 p-3.5">
              <p className="text-[12.5px] font-bold">
                {preview.scan.variables.length === 0
                  ? "Ce modèle ne contient aucune variable du catalogue."
                  : `Ce modèle utilise ${preview.scan.variables.length} variable${preview.scan.variables.length > 1 ? "s" : ""} — voici ce que cette demande y mettra :`}
              </p>

              {preview.scan.variables.length > 0 ? (
                <div className="max-h-[210px] overflow-y-auto rounded-[10px] border border-border bg-background">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {preview.scan.variables.map((key) => (
                        <tr key={key} className="border-b border-border/60 last:border-0">
                          <td className="w-[46%] px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                            {`{{${key}}}`}
                          </td>
                          <td className={cn(
                            "px-2.5 py-1.5",
                            preview.values[key]?.trim() ? "font-medium" : "text-muted-foreground",
                          )}>
                            {previewValue(preview.values[key] ?? "")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {preview.scan.loops.length > 0 ? (
                <p className="text-[11.5px] text-muted-foreground">
                  Liste répétée : <span className="font-mono">{preview.scan.loops.join(", ")}</span>
                  {" — "}
                  {preview.pieces.length === 0
                    ? "aucune pièce au dossier, le bloc disparaîtra."
                    : `${preview.pieces.length} ligne${preview.pieces.length > 1 ? "s" : ""}.`}
                </p>
              ) : null}

              {preview.scan.images.length > 0 ? (
                <p className="text-[11.5px] text-muted-foreground">
                  Variables d'image (<span className="font-mono">{preview.scan.images.join(", ")}</span>) :
                  elles resteront vides. Le logo d'un courrier se place dans l'en-tête du modèle Word.
                </p>
              ) : null}

              {unknown.length > 0 ? (
                <p className="text-[11.5px] text-secondary-foreground">
                  Jetons hors catalogue — ils resteront écrits tels quels :{" "}
                  <span className="font-mono">{unknown.map((u) => `{{${u}}}`).join(", ")}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          <Field
            label="Format"
            htmlFor="doc-format"
            required
            hint={FORMATS.find((f) => f.value === format)?.sub}
          >
            <Select
              id="doc-format"
              value={format}
              disabled={pending}
              onChange={(e) => setFormat(e.target.value as DocumentFormat)}
            >
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </Select>
          </Field>

          {warning ? (
            <p className="rounded-[10px] border border-secondary/60 bg-secondary/25 px-3 py-2 text-[11.5px] text-secondary-foreground">
              {warning}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 p-2.5 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={!templateId || !mergeable || pending || previewing}>
              {pending ? <Loader2 className="animate-spin" /> : <FileText />}
              {pending ? "Génération…" : "Générer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
