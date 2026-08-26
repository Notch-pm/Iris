// Section « Modèles d'e-mail » des Paramètres — la liste et ses gestes.
//
// Motif de `PermissionsPage` : Card + table écrite à la main, formulaire en
// Dialog, confirmation destructive en AlertDialog (le dialogue reste ouvert
// tant que la suppression n'a pas réussi, pour que l'erreur soit lue).

import * as React from "react";
import { Building2, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { emptyDraft, type TemplateDraft } from "./templates";
import { EmailTemplateDialog } from "./EmailTemplateDialog";
import { TemplateOrganisationsDialog } from "./TemplateOrganisationsDialog";
import { useDeleteEmailTemplate, useEmailTemplates, type EmailTemplate } from "./useEmailTemplates";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function draftFrom(row: EmailTemplate): TemplateDraft {
  return {
    name: row.name,
    description: row.description ?? "",
    subject: row.subject,
    body: row.body,
  };
}

interface DialogState {
  /** Remonté en `key` : chaque ouverture repart d'un formulaire neuf. */
  key: number;
  title: string;
  draft: TemplateDraft;
  templateId?: string;
  expectedVersion?: number;
}

export function EmailTemplatesPanel({ orgId }: { orgId: string }) {
  const templates = useEmailTemplates(orgId);
  const removeTemplate = useDeleteEmailTemplate(orgId);

  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  // Seconde modale : l'activation par organisation. Elle s'ouvre soit dans la
  // foulée d'un enregistrement, soit depuis l'action dédiée de la ligne.
  const [scope, setScope] = React.useState<
    { id: string; name: string; justCreated: boolean } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = React.useState<EmailTemplate | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const rows = templates.data ?? [];

  function openCreate() {
    setDialog({ key: Date.now(), title: "Nouveau modèle d'e-mail", draft: emptyDraft() });
  }

  /** Le contenu est enregistré : on enchaîne sur « où ce modèle sert-il ? ».
   *  Le nom vient du dialogue, pas de `dialog.draft` — celui-ci porte le
   *  brouillon d'OUVERTURE, pas ce que l'utilisateur vient de taper. */
  function afterSave(savedId: string, name: string) {
    const wasCreation = dialog?.templateId === undefined;
    setDialog(null);
    setScope({ id: savedId, name: name || "Modèle", justCreated: wasCreation });
  }

  function openEdit(row: EmailTemplate) {
    setDialog({
      key: Date.now(),
      title: `Modifier « ${row.name} »`,
      draft: draftFrom(row),
      templateId: row.id,
      expectedVersion: row.version,
    });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await removeTemplate.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);   // ferme SEULEMENT après succès
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[640px] text-sm text-muted-foreground">
          Textes réutilisables pour répondre à un usager. Les variables entre accolades sont
          remplacées par les informations de la demande. Seuls les administrateurs peuvent
          les modifier.
        </p>
        <Button type="button" onClick={openCreate}>
          <Plus />
          Nouveau modèle
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Nom</th>
                  <th className="px-4 py-2">Objet</th>
                  <th className="px-4 py-2">Modifié le</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      Chargement…
                    </td>
                  </tr>
                ) : templates.isError ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-destructive" role="alert">
                      Modèles indisponibles.
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                      <Mail className="mx-auto mb-2 size-6 opacity-40" aria-hidden="true" />
                      Aucun modèle pour l'instant.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <span className="font-medium">{row.name}</span>
                        {row.description ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {row.description}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[320px] truncate px-4 py-3 text-muted-foreground">
                        {row.subject}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatDate(row.updated_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Modifier le modèle"
                            aria-label={`Modifier ${row.name}`}
                            onClick={() => openEdit(row)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Organisations où ce modèle est actif"
                            aria-label={`Organisations de ${row.name}`}
                            onClick={() =>
                              setScope({ id: row.id, name: row.name, justCreated: false })
                            }
                          >
                            <Building2 />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Supprimer"
                            aria-label={`Supprimer ${row.name}`}
                            onClick={() => { setDeleteError(null); setDeleteTarget(row); }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {dialog ? (
        <EmailTemplateDialog
          key={dialog.key}
          open
          onOpenChange={(o) => { if (!o) setDialog(null); }}
          orgId={orgId}
          title={dialog.title}
          initialDraft={dialog.draft}
          templateId={dialog.templateId}
          expectedVersion={dialog.expectedVersion}
          onSaved={afterSave}
        />
      ) : null}

      {scope ? (
        <TemplateOrganisationsDialog
          open
          onOpenChange={(o) => { if (!o) setScope(null); }}
          orgId={orgId}
          templateId={scope.id}
          templateName={scope.name}
          justCreated={scope.justCreated}
        />
      ) : null}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          {deleteTarget ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer « {deleteTarget.name} » ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cette action est définitive. Les e-mails déjà envoyés à partir de ce modèle
                  ne sont pas affectés.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError ? (
                <p role="alert" className="text-sm text-destructive">{deleteError}</p>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={removeTemplate.isPending}
                  onClick={() => void confirmDelete()}
                >
                  {removeTemplate.isPending ? "Suppression…" : "Supprimer"}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
