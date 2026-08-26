// Onglet « Échanges » : les e-mails envoyés à l'usager, et le composeur.
//
// LE COMPOSEUR RÉSOUT LES VARIABLES À L'INSERTION, pas à l'envoi. Choisir un
// modèle remplit l'objet et le corps DÉJÀ personnalisés ; cliquer une variable
// insère sa VALEUR au curseur, pas le jeton `{{…}}`. C'est la différence avec
// l'éditeur de modèles des Paramètres, et elle est voulue : ici l'agent rédige
// le message final, le voit tel qu'il partira, et c'est ce texte-là qui part.
// Un trou — variable sans valeur pour cette demande — se voit donc tout de
// suite et se comble à la main, au lieu de partir sans qu'on le sache.
//
// L'usager ne peut pas répondre : la mention est portée par le pied du gabarit
// d'e-mail (« … — message automatique, merci de ne pas y répondre. »), et
// rappelée ici à l'agent avant qu'il envoie.

import * as React from "react";
import { Loader2, Mail, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, Pill, Surface, SurfaceHead } from "@/components/ui/surface";
import { renderTemplate, TEMPLATE_VARIABLES } from "@/features/templates/templates";
import { useActiveEmailTemplates } from "@/features/templates/useEmailTemplates";
import type { Tables } from "@/types/database.types";
import type { RequestAttachment, RequestEmail, TenantMember } from "../useRequests";
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  hasDraftErrors,
  insertAtCaret,
  requestTemplateValues,
  totalBytes,
  validateEmailDraft,
} from "./courriel";
import {
  attachmentExt,
  formatBytes,
  formatTimeline,
  initials,
  memberName,
  type RequesterIdentity,
  type StageEvent,
} from "./instruction";

export interface SendEmailPayload {
  subject: string;
  body: string;
  files: File[];
  templateId: string | null;
  templateName: string | null;
}

interface Props {
  request: Tables<"requests">;
  identity: RequesterIdentity;
  emails: RequestEmail[];
  attachments: RequestAttachment[];
  members: TenantMember[];
  events: StageEvent[];
  tenantName: string;
  canInstruct: boolean;
  archived: boolean;
  sending: boolean;
  onSend: (payload: SendEmailPayload) => Promise<void>;
  onDownload: (attachment: RequestAttachment) => void;
}

export function EchangesPane({
  request, identity, emails, attachments, members, events, tenantName,
  canInstruct, archived, sending, onSend, onDownload,
}: Props) {
  const templates = useActiveEmailTemplates(request.organization_id, request.socle_scope_org_id);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  /** Le dernier champ touché : c'est là qu'une variable s'insère. */
  const [focused, setFocused] = React.useState<"subject" | "body">("body");

  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [templateId, setTemplateId] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const values = React.useMemo(
    () => requestTemplateValues({ request, identity, events, members, tenantName }),
    [request, identity, events, members, tenantName],
  );

  const errors = validateEmailDraft({ subject, body }, files);
  const total = totalBytes(files);
  const tooHeavy = total > MAX_EMAIL_ATTACHMENT_BYTES;

  // Les pièces d'un échange donné — les autres restent dans l'onglet Documents.
  const piecesOf = React.useMemo(() => {
    const map = new Map<string, RequestAttachment[]>();
    for (const a of attachments) {
      if (!a.email_id) continue;
      map.set(a.email_id, [...(map.get(a.email_id) ?? []), a]);
    }
    return map;
  }, [attachments]);

  const ordered = React.useMemo(
    () => [...emails].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [emails],
  );

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.data?.find((t) => t.id === id);
    if (!tpl) return;
    setSubject(renderTemplate(tpl.subject, values));
    setBody(renderTemplate(tpl.body, values));
  }

  /** La valeur d'une variable, au curseur du champ actif. */
  function insertValue(key: string) {
    const value = values[key];
    if (!value) return;
    if (focused === "subject") {
      const el = subjectRef.current;
      if (!el) return;
      const out = insertAtCaret(el.value, el.selectionStart ?? el.value.length, value);
      setSubject(out.text);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(out.caret, out.caret); });
      return;
    }
    const el = bodyRef.current;
    if (!el) return;
    const out = insertAtCaret(el.value, el.selectionStart ?? el.value.length, value);
    setBody(out.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(out.caret, out.caret); });
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((current) => [...current, ...Array.from(list)]);
    if (fileRef.current) fileRef.current.value = "";   // re-choisir le même fichier
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (hasDraftErrors(errors)) return;
    const tpl = templates.data?.find((t) => t.id === templateId);
    try {
      await onSend({
        subject: subject.trim(),
        body,
        files,
        templateId: tpl?.id ?? null,
        templateName: tpl?.name ?? null,
      });
      setSubject("");
      setBody("");
      setFiles([]);
      setTemplateId("");
      setSubmitted(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible.");
    }
  }

  const recipient = identity.anonymous ? null : identity.email;
  const closed = archived || !canInstruct || !recipient;
  // `identity` est l'identité RELUE dans le Socle quand elle a pu l'être : une
  // adresse ajoutée à la fiche après le dépôt ouvre donc l'envoi. Ce qui reste
  // sans issue, c'est l'identité déclarée SANS rapprochement — il n'y a alors
  // aucune fiche de référentiel à compléter.
  const completable = Boolean(request.socle_contact_id);

  return (
    <div className="flex flex-col gap-3.5">
      <Surface>
        <SurfaceHead
          title="Échanges avec l'usager"
          sub={
            recipient
              ? `Courriel ${recipient}`
              : identity.anonymous
                ? "Dépôt anonyme — aucun canal de contact"
                : completable
                  ? "Aucune adresse de courriel dans la fiche de l'usager"
                  : "Aucune adresse de courriel dans l'identité déposée"
          }
          action={
            ordered.length > 0
              ? <Pill tone="neutral" className="h-6">{ordered.length} envoyé{ordered.length > 1 ? "s" : ""}</Pill>
              : null
          }
        />

        {ordered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-3.5 text-[13px] leading-relaxed text-muted-foreground">
            Aucun échange enregistré.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {ordered.map((mail) => (
              <ExchangeCard
                key={mail.id}
                mail={mail}
                pieces={piecesOf.get(mail.id) ?? []}
                who={memberName(members, mail.sent_by)}
                onDownload={onDownload}
              />
            ))}
          </ul>
        )}
      </Surface>

      {closed ? (
        <Surface>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {!recipient
              ? identity.anonymous
                ? "Ce dépôt est anonyme : aucune adresse ne permet d'écrire à l'usager."
                : completable
                  ? "La fiche de cet usager ne porte aucune adresse de courriel. Complétez-la depuis le bloc « Usager » du rail, bouton « Modifier » : la correction est enregistrée dans le Socle et l'envoi devient possible."
                  : "L'identité retenue au dépôt ne comporte pas d'adresse de courriel, et cette demande n'est rattachée à aucune fiche du référentiel : il n'y a pas de fiche à compléter."
              : archived
                ? "Cette demande est archivée : aucun nouvel échange ne peut partir."
                : "Écrire à l'usager exige le droit d'instruction sur cette demande."}
          </p>
        </Surface>
      ) : (
        <Surface>
          <SurfaceHead
            title="Écrire à l'usager"
            sub={`Le message partira à ${recipient}`}
          />
          <form className="flex flex-col gap-2.5" onSubmit={(e) => void submit(e)}>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="echange-modele">
                Modèle
              </label>
              <Select
                id="echange-modele"
                className="h-9 w-auto min-w-[220px] text-[13px]"
                value={templateId}
                disabled={sending}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                <option value="">Aucun modèle — rédiger à la main</option>
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
              {templates.isLoading ? (
                <span className="text-[11px] text-muted-foreground">Chargement…</span>
              ) : (templates.data ?? []).length === 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  Aucun modèle activé pour cette organisation.
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Choisir un modèle remplace l'objet et le message.
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Input
                ref={subjectRef}
                className="h-10 text-sm"
                placeholder="Objet du message"
                value={subject}
                disabled={sending}
                onFocus={() => setFocused("subject")}
                onChange={(e) => setSubject(e.target.value)}
                aria-label="Objet du message"
              />
              {submitted && errors.subject ? (
                <span role="alert" className="text-[11.5px] text-destructive">{errors.subject}</span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <Textarea
                ref={bodyRef}
                className="min-h-[140px] text-sm"
                placeholder="Message à l'usager"
                value={body}
                disabled={sending}
                onFocus={() => setFocused("body")}
                onChange={(e) => setBody(e.target.value)}
                aria-label="Message à l'usager"
              />
              {submitted && errors.body ? (
                <span role="alert" className="text-[11.5px] text-destructive">{errors.body}</span>
              ) : null}
            </div>

            <VariableChips values={values} disabled={sending} onInsert={insertValue} />

            <AttachmentPicker
              files={files}
              total={total}
              tooHeavy={tooHeavy}
              disabled={sending}
              inputRef={fileRef}
              onAdd={addFiles}
              onRemove={(index) => setFiles((c) => c.filter((_, i) => i !== index))}
            />
            {submitted && errors.attachments ? (
              <span role="alert" className="text-[11.5px] text-destructive">{errors.attachments}</span>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-xl bg-destructive/10 p-2.5 text-[13px] text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-3">
              <span className="min-w-[180px] flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
                L'usager ne pourra pas répondre à ce message : le pied de l'e-mail le lui indique.
                L'échange est joint à la demande.
              </span>
              <Button type="submit" size="sm" disabled={sending}>
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
                {sending ? "Envoi…" : "Envoyer"}
              </Button>
            </div>
          </form>
        </Surface>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExchangeCard({ mail, pieces, who, onDownload }: {
  mail: RequestEmail;
  pieces: RequestAttachment[];
  who: string;
  onDownload: (attachment: RequestAttachment) => void;
}) {
  const failed = mail.status === "echec";
  return (
    <li className="flex gap-[11px] rounded-xl border border-border bg-background p-[13px]">
      <Avatar initials={initials(who)} muted />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex flex-wrap items-baseline gap-2">
            <strong className="text-[13px]">{who}</strong>
            <span className="text-[11.5px] text-muted-foreground">
              à {mail.to_email} · {formatTimeline(mail.sent_at ?? mail.created_at)}
            </span>
          </span>
          {failed ? (
            <Pill tone="error">Non envoyé</Pill>
          ) : mail.status === "en_cours" ? (
            <Pill tone="pending">Envoi en cours</Pill>
          ) : null}
        </div>

        <span className="text-[13.5px] font-bold">{mail.subject}</span>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{mail.body}</p>

        {failed && mail.error ? (
          <p role="alert" className="text-[11.5px] text-destructive">{mail.error}</p>
        ) : null}

        {pieces.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {pieces.map((piece) => (
              <li key={piece.id}>
                <button
                  type="button"
                  onClick={() => onDownload(piece)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-1 text-[11.5px] font-semibold hover:bg-secondary"
                >
                  <Paperclip className="size-3" aria-hidden="true" />
                  {piece.file_name}
                  <span className="font-normal text-muted-foreground">
                    {attachmentExt(piece.file_name, piece.mime_type)}
                    {formatBytes(piece.file_size) ? ` · ${formatBytes(piece.file_size)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {mail.template_name ? (
          <span className="text-[11px] text-muted-foreground">
            <Mail className="mr-1 inline size-3" aria-hidden="true" />
            Modèle « {mail.template_name} »
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** Les variables qui ONT une valeur pour cette demande. Les autres ne sont pas
 *  proposées : offrir d'insérer du vide n'aiderait personne. */
function VariableChips({ values, disabled, onInsert }: {
  values: Record<string, string>;
  disabled: boolean;
  onInsert: (key: string) => void;
}) {
  const available = TEMPLATE_VARIABLES.filter((v) => values[v.key]);
  if (available.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold text-muted-foreground">Insérer :</span>
      {available.map((v) => (
        <button
          key={v.key}
          type="button"
          disabled={disabled}
          onClick={() => onInsert(v.key)}
          title={`Insérer « ${values[v.key]} »`}
          className="rounded-full border border-border bg-muted/60 px-2 py-[3px] text-[11px] font-semibold hover:bg-secondary disabled:opacity-50"
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function AttachmentPicker({ files, total, tooHeavy, disabled, inputRef, onAdd, onRemove }: {
  files: File[];
  total: number;
  tooHeavy: boolean;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onAdd: (list: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          disabled={disabled}
          onChange={(e) => onAdd(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip />
          Parcourir
        </Button>
        {files.length > 0 ? (
          <span className={tooHeavy ? "text-[11.5px] font-semibold text-destructive" : "text-[11.5px] text-muted-foreground"}>
            {files.length} pièce{files.length > 1 ? "s" : ""} · {formatBytes(total)} (maximum {formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)})
          </span>
        ) : null}
      </div>
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-1 text-[11.5px]"
            >
              <span className="font-semibold">{file.name}</span>
              <span className="text-muted-foreground">{formatBytes(file.size)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(index)}
                aria-label={`Retirer ${file.name}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
