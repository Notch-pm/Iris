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
import { Select } from "@/components/ui/select";
import { Avatar, Pill } from "@/components/ui/surface";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";
import { renderTemplate, TEMPLATE_VARIABLES } from "@/features/templates/templates";
import { useActiveEmailTemplates } from "@/features/templates/useEmailTemplates";
import type { Tables } from "@/types/database.types";
import type { RequestAttachment, RequestEmail, TenantMember } from "../useRequests";
import { acceptAttribute } from "@fn/_shared/files/magic";
import { kindLabel, sendableDocuments } from "./documents";
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

/**
 * Brouillon déposé dans le composeur par un autre bloc de la fiche. Chaque
 * champ est FACULTATIF : « Signaler à l'usager » remplit l'objet et le corps,
 * « Joindre à un échange » n'apporte qu'un document et ne doit surtout pas
 * effacer ce que l'agent est en train d'écrire.
 */
export interface ComposerDraft {
  subject?: string;
  body?: string;
  /** Documents du dossier à joindre (identifiants `request_attachments`). */
  documentIds?: string[];
}

export interface SendEmailPayload {
  subject: string;
  body: string;
  files: File[];
  /** Documents DÉJÀ au dossier, joints par leur identifiant : le navigateur ne
   *  redit ni leur chemin ni leur nature, que le serveur relit en base. */
  documentIds: string[];
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
  /**
   * Texte pré-rempli venu d'ailleurs (aujourd'hui : le signalement de
   * non-conformité de l'onglet Documents). Chaque nouvel OBJET est appliqué une
   * fois, puis rendu au parent via `onDraftApplied` — sans quoi un rendu de
   * plus écraserait ce que l'agent vient de corriger à la main.
   */
  draft?: ComposerDraft | null;
  onDraftApplied?: () => void;
  onSend: (payload: SendEmailPayload) => Promise<void>;
  onDownload: (attachment: RequestAttachment) => void;
}

export function EchangesPane({
  request, identity, emails, attachments, members, events, tenantName,
  canInstruct, archived, sending, draft, onDraftApplied, onSend, onDownload,
}: Props) {
  const templates = useActiveEmailTemplates(request.organization_id, request.socle_scope_org_id);
  const { session } = useAuth();
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  /** Le dernier champ touché : c'est là qu'une variable s'insère. */
  const [focused, setFocused] = React.useState<"subject" | "body">("body");

  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [templateId, setTemplateId] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [docIds, setDocIds] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  // Le brouillon remplace la saisie en cours : il arrive d'un geste explicite
  // (« Signaler à l'usager »), jamais d'un rendu de fond.
  React.useEffect(() => {
    if (!draft) return;
    if (draft.subject !== undefined) setSubject(draft.subject);
    if (draft.body !== undefined) setBody(draft.body);
    if (draft.subject !== undefined || draft.body !== undefined) setTemplateId("");
    if (draft.documentIds) {
      // Un document déjà joint ne se joint pas deux fois.
      setDocIds((current) => [...new Set([...current, ...draft.documentIds!])]);
    }
    setSubmitted(false);
    setError(null);
    onDraftApplied?.();
  }, [draft, onDraftApplied]);

  const values = React.useMemo(
    () => requestTemplateValues({ request, identity, events, members, tenantName }),
    [request, identity, events, members, tenantName],
  );

  const errors = validateEmailDraft({ subject, body }, files);

  // Documents DU DOSSIER joints à ce message : jamais un interne (la liste ne
  // les propose pas, la RPC les refuse, un trigger les interdit).
  const sendable = React.useMemo(() => sendableDocuments(attachments), [attachments]);
  const joinedDocs = React.useMemo(
    () => sendable.filter((a) => docIds.includes(a.id)),
    [sendable, docIds],
  );
  const availableDocs = sendable.filter((a) => !docIds.includes(a.id));
  const total = totalBytes(files)
    + joinedDocs.reduce((sum, doc) => sum + (doc.file_size ?? 0), 0);
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
    // Chronologique : le fil se lit du premier envoi au composeur, en bas.
    () => [...emails].sort((a, b) => a.created_at.localeCompare(b.created_at)),
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
    if (tooHeavy) {
      setError(`Les pièces jointes dépassent ${formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)}.`);
      return;
    }
    const tpl = templates.data?.find((t) => t.id === templateId);
    try {
      await onSend({
        subject: subject.trim(),
        body,
        files,
        documentIds: docIds,
        templateId: tpl?.id ?? null,
        templateName: tpl?.name ?? null,
      });
      setSubject("");
      setBody("");
      setFiles([]);
      setDocIds([]);
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
  const me = memberName(members, session?.user.id ?? null);
  const lastSent = ordered.length > 0 ? ordered[ordered.length - 1] : null;
  const usagerName = identity.anonymous ? "l'usager" : identity.name;

  const closedReason = !recipient
    ? identity.anonymous
      ? "Ce dépôt est anonyme : aucune adresse ne permet d'écrire à l'usager."
      : completable
        ? "La fiche de cet usager ne porte aucune adresse de courriel. Complétez-la depuis le bloc « Usager » du rail, bouton « Modifier » : la correction est enregistrée dans le Socle et l'envoi devient possible."
        : "L'identité retenue au dépôt ne comporte pas d'adresse de courriel, et cette demande n'est rattachée à aucune fiche du référentiel : il n'y a pas de fiche à compléter."
    : archived
      ? "Cette demande est archivée : aucun nouvel échange ne peut partir."
      : "Écrire à l'usager exige le droit d'instruction sur cette demande.";

  return (
    <div className="flex flex-col">
      {/* ── En-tête du fil (maquette « Échange usager », 2026-09-19) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5">
        <span className="flex items-center gap-[7px] text-[13px] font-semibold text-muted-foreground">
          <Mail className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Échanges par courriel avec{" "}
            <span className="text-foreground">{usagerName}</span>
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {lastSent
            ? `Dernier envoi le ${formatTimeline(lastSent.sent_at ?? lastSent.created_at)}`
            : "Aucun échange enregistré"}
        </span>
      </div>

      {/* ── Le fil : chaque envoi, puis le composeur comme DERNIER message ──
          `pl-1` : la place du cercle de 3 px autour de l'avatar du composeur,
          que le bord du panneau défilant rognerait sinon. */}
      <div className="flex flex-col pl-1">
        {ordered.map((mail) => {
          const who = memberName(members, mail.sent_by);
          return (
            <ThreadItem
              key={mail.id}
              initials={initials(who)}
              meta={
                <>
                  <strong className="text-sm text-foreground">{who}</strong>
                  <span>agent · envoyé le {formatTimeline(mail.sent_at ?? mail.created_at)}</span>
                  <span className="truncate">à {mail.to_email}</span>
                  {mail.status === "echec" ? (
                    <Pill tone="error">Non envoyé</Pill>
                  ) : mail.status === "en_cours" ? (
                    <Pill tone="pending">Envoi en cours</Pill>
                  ) : null}
                </>
              }
            >
              <ExchangeMessage mail={mail} pieces={piecesOf.get(mail.id) ?? []} onDownload={onDownload} />
            </ThreadItem>
          );
        })}

        <ThreadItem
          last
          ring={!closed}
          initials={initials(me)}
          meta={
            <>
              <strong className="text-sm text-foreground">Vous</strong>
              {recipient ? <span className="whitespace-nowrap">· {recipient}</span> : null}
            </>
          }
        >
          {closed ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-3.5 text-[13px] leading-relaxed text-muted-foreground">
              {closedReason}
            </p>
          ) : (
            <form
              className="overflow-hidden rounded-xl border-[1.5px] border-primary/45 bg-card shadow-airbnb-md"
              onSubmit={(e) => void submit(e)}
            >
              {/* Barre haute : variables (jeton + valeur résolue), modèle, pièce jointe. */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/35 px-3 py-2.5">
                <VariableChips values={values} disabled={sending} onInsert={insertValue} />
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <Select
                    aria-label="Modèle d'e-mail"
                    title={
                      templates.isLoading
                        ? "Chargement des modèles…"
                        : (templates.data ?? []).length === 0
                          ? "Aucun modèle activé pour cette organisation."
                          : "Choisir un modèle remplace l'objet et le message."
                    }
                    className="h-8 w-auto max-w-[220px] text-xs font-semibold"
                    value={templateId}
                    disabled={sending || (templates.data ?? []).length === 0}
                    onChange={(e) => applyTemplate(e.target.value)}
                  >
                    <option value="">
                      {(templates.data ?? []).length === 0 ? "Aucun modèle" : "Modèle…"}
                    </option>
                    {(templates.data ?? []).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept={acceptAttribute()}
                    className="hidden"
                    disabled={sending}
                    onChange={(e) => addFiles(e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={sending}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Paperclip />
                    Pièce jointe
                  </Button>
                  {sendable.length > 0 ? (
                    <Select
                      aria-label="Joindre un document du dossier"
                      className="h-8 w-auto max-w-[220px] text-xs font-semibold"
                      value=""
                      disabled={sending || availableDocs.length === 0}
                      onChange={(e) => {
                        if (e.target.value) setDocIds((current) => [...current, e.target.value]);
                      }}
                    >
                      <option value="">
                        {availableDocs.length === 0 ? "Documents tous joints" : "Document du dossier…"}
                      </option>
                      {availableDocs.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.file_name} — {kindLabel(doc.kind)}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </div>
              </div>

              {/* Corps : objet puis message, sans cadre — le cadre, c'est le composeur. */}
              <div className="flex flex-col">
                <input
                  ref={subjectRef}
                  className="w-full border-b border-border bg-transparent px-4 py-2.5 text-sm font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none"
                  placeholder="Objet du message"
                  value={subject}
                  disabled={sending}
                  onFocus={() => setFocused("subject")}
                  onChange={(e) => setSubject(e.target.value)}
                  aria-label="Objet du message"
                />
                {submitted && errors.subject ? (
                  <span role="alert" className="px-4 pt-1.5 text-[11.5px] text-destructive">{errors.subject}</span>
                ) : null}
                <textarea
                  ref={bodyRef}
                  className="min-h-[160px] w-full resize-y bg-transparent px-4 py-3.5 text-sm leading-[1.65] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  placeholder="Message à l'usager"
                  value={body}
                  disabled={sending}
                  onFocus={() => setFocused("body")}
                  onChange={(e) => setBody(e.target.value)}
                  aria-label="Message à l'usager"
                />
                {submitted && errors.body ? (
                  <span role="alert" className="px-4 pb-2 text-[11.5px] text-destructive">{errors.body}</span>
                ) : null}

                {files.length > 0 || joinedDocs.length > 0 ? (
                  <div className="flex flex-col gap-1.5 px-4 pb-3">
                    <ul className="flex flex-wrap gap-1.5">
                      {files.map((file, index) => (
                        <AttachmentChip
                          key={`${file.name}-${index}`}
                          name={file.name}
                          size={file.size}
                          disabled={sending}
                          onRemove={() => setFiles((c) => c.filter((_, i) => i !== index))}
                        />
                      ))}
                      {joinedDocs.map((doc) => (
                        <AttachmentChip
                          key={doc.id}
                          name={doc.file_name}
                          size={doc.file_size}
                          fromDossier
                          disabled={sending}
                          onRemove={() => setDocIds((current) => current.filter((id) => id !== doc.id))}
                        />
                      ))}
                    </ul>
                    <span className={tooHeavy ? "text-[11.5px] font-semibold text-destructive" : "text-[11.5px] text-muted-foreground"}>
                      {formatBytes(total)} de pièces jointes (maximum {formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)})
                    </span>
                    {submitted && errors.attachments ? (
                      <span role="alert" className="text-[11.5px] text-destructive">{errors.attachments}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {error ? (
                <p role="alert" className="mx-4 mb-3 rounded-xl bg-destructive/10 p-2.5 text-[13px] text-destructive">
                  {error}
                </p>
              ) : null}

              {/* Pied : ce que l'usager recevra, et l'envoi. */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-muted/40 py-2.5 pl-4 pr-3">
                <span className="flex min-w-[200px] flex-1 items-center gap-[7px] text-xs leading-relaxed text-muted-foreground">
                  <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Variables fusionnées avec la fiche de {usagerName} — l'usager reçoit le texte
                    affiché, et ne pourra pas y répondre.
                  </span>
                </span>
                <Button type="submit" size="md" className="shrink-0" disabled={sending}>
                  {sending ? "Envoi…" : "Envoyer l'échange"}
                  {sending ? <Loader2 className="animate-spin" /> : <Send />}
                </Button>
              </div>
            </form>
          )}
        </ThreadItem>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Un tour du fil : gouttière (avatar + rail continu jusqu'au tour suivant),
 * ligne de méta, contenu. Le composeur est un tour comme les autres — c'est
 * tout l'objet de la maquette : plus de rupture entre le fil et l'envoi.
 */
function ThreadItem({ initials: letters, meta, children, last = false, ring = false }: {
  initials: string;
  meta: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
  ring?: boolean;
}) {
  return (
    <div className="flex items-stretch gap-3.5">
      {/* Gouttière à la largeur de l'avatar (40 px) : plus étroite, le rond
          débordait à gauche et le panneau défilant le rognait. */}
      <div className="flex w-10 shrink-0 flex-col items-center">
        <Avatar
          initials={letters}
          size="lg"
          className={cn("bg-sidebar text-primary-foreground", ring && "ring-[3px] ring-primary/20")}
        />
        {!last ? <div className="mt-2 w-0.5 flex-1 bg-border" aria-hidden="true" /> : null}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-5")}>
        <div className="flex flex-wrap items-baseline gap-2 pb-1.5 text-xs text-muted-foreground">{meta}</div>
        {children}
      </div>
    </div>
  );
}

function ExchangeMessage({ mail, pieces, onDownload }: {
  mail: RequestEmail;
  pieces: RequestAttachment[];
  onDownload: (attachment: RequestAttachment) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3.5">
      <span className="text-sm font-bold">{mail.subject}</span>
      <p className="whitespace-pre-wrap break-words text-sm leading-[1.6]">{mail.body}</p>

      {mail.status === "echec" && mail.error ? (
        <p role="alert" className="text-[11.5px] text-destructive">{mail.error}</p>
      ) : null}

      {pieces.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {pieces.map((piece) => (
            <li key={piece.id}>
              <button
                type="button"
                onClick={() => onDownload(piece)}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11.5px] font-semibold transition-colors hover:bg-secondary"
              >
                <Paperclip className="size-3.5" aria-hidden="true" />
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
        <span className="text-[11px] text-muted-foreground">Modèle « {mail.template_name} »</span>
      ) : null}
    </div>
  );
}

/**
 * Les variables qui ONT une valeur pour cette demande, chacune avec sa valeur
 * résolue (motif de la maquette : le jeton ET ce qu'il vaut ici). Les autres
 * ne sont pas proposées : offrir d'insérer du vide n'aiderait personne.
 */
function VariableChips({ values, disabled, onInsert }: {
  values: Record<string, string>;
  disabled: boolean;
  onInsert: (key: string) => void;
}) {
  const available = TEMPLATE_VARIABLES.filter((v) => values[v.key]);
  if (available.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">Insérer une variable</span>
      {available.map((v) => (
        <button
          key={v.key}
          type="button"
          disabled={disabled}
          onClick={() => onInsert(v.key)}
          title={`{{${v.key}}}`}
          className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border bg-card pl-2.5 pr-1 text-[11px] font-semibold transition-colors hover:border-primary hover:bg-primary/[0.08] active:scale-[0.98] disabled:opacity-50"
        >
          {v.label}
          <span className="max-w-[200px] truncate rounded-full bg-muted px-[7px] py-[3px] font-normal leading-[14px] text-muted-foreground">
            {values[v.key]}
          </span>
        </button>
      ))}
    </div>
  );
}

function AttachmentChip({ name, size, fromDossier = false, disabled, onRemove }: {
  name: string;
  size: number | null;
  fromDossier?: boolean;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px]",
        fromDossier ? "border-primary/30 bg-primary/[0.06]" : "border-border bg-card",
      )}
    >
      <Paperclip className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="font-semibold">{name}</span>
      <span className="text-muted-foreground">{formatBytes(size)}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Retirer ${name}`}
        className="text-muted-foreground transition-colors hover:text-destructive"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </li>
  );
}
