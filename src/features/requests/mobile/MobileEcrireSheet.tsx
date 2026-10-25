// Écran 5 « Écrire à l'usager » (maquette Claude Design « Iris mobile — v2 »,
// lignes 358-400) — fil de l'échange en bulles de conversation (dépôt à
// gauche, envois du service à droite) et composeur en pied de feuille :
// modèles actifs, objet, pièce jointe, message, envoi. Reprend le contrat de
// données d'`EchangesPane.tsx` (bureau) — le serveur résout le destinataire
// et relit chemin/nom/type des pièces, le navigateur ne désigne rien qu'il
// n'ait déjà reçu par la porte unique.
//
// Simplification assumée face au bureau : pas de pastilles de variable à
// insérer au curseur (`insertAtCaret`) — sur un clavier tactile, un modèle
// suffit à remplir objet ET message ; l'agent tape le reste.

import * as React from "react";
import { Camera, Send, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/surface";
import { MobileChip, MobileNotice, MobileSheet } from "@/components/layout/mobile/MobilePage";
import { renderTemplate } from "@/features/templates/templates";
import { useActiveEmailTemplates } from "@/features/templates/useEmailTemplates";
import { acceptAttribute } from "@fn/_shared/files/magic";
import type { Tables } from "@/types/database.types";
import type { RequestAttachment, RequestEmail, TenantMember } from "../useRequests";
import { citizenChannelLabel, mergeThread, piecesByExchange, type RequestCitizenMessage } from "../instruction/citizenMessages";
import type { SendEmailPayload } from "../instruction/EchangesPane";
import {
  MAX_EMAIL_ATTACHMENT_BYTES, exchangeAuthor, hasDraftErrors, requestTemplateValues, totalBytes,
  validateEmailDraft,
} from "../instruction/courriel";
import {
  formatBytes, formatTimeline, type RequesterIdentity, type StageEvent,
} from "../instruction/instruction";
import { defaultEmailSubject } from "./mobileRequests";
import { useEmailDeliveryPreview } from "../instruction/useSendRequestEmail";
import { DELIVERY_PENDING_NOTICE } from "../instruction/remise";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: Tables<"requests">;
  identity: RequesterIdentity;
  emails: RequestEmail[];
  /** Réponses de l'usager en ligne (L4b). */
  citizenMessages?: RequestCitizenMessage[];
  /** Pour nommer les pièces jointes aux réponses de l'usager. */
  attachments?: RequestAttachment[];
  members: TenantMember[];
  events: StageEvent[];
  tenantName: string;
  canInstruct: boolean;
  archived: boolean;
  sending: boolean;
  onSend: (payload: SendEmailPayload) => Promise<void>;
}

export function MobileEcrireSheet({
  open, onOpenChange, request, identity, emails, citizenMessages = [], attachments = [], members, events, tenantName,
  canInstruct, archived, sending, onSend,
}: Props) {
  const templates = useActiveEmailTemplates(request.organization_id, request.socle_scope_org_id);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const [subject, setSubject] = React.useState(() => defaultEmailSubject(request.reference));
  const [body, setBody] = React.useState("");
  const [templateId, setTemplateId] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const recipient = identity.anonymous ? null : identity.email;
  const closed = archived || !canInstruct || !recipient;
  const completable = Boolean(request.socle_contact_id);
  // M2 (B12) : le serveur dit d'avance si le message sera publié dans l'espace.
  const deliveryPreview = useEmailDeliveryPreview(request.id, open && !closed);

  React.useEffect(() => {
    if (open) {
      setSubject(defaultEmailSubject(request.reference));
      setBody("");
      setTemplateId("");
      setFiles([]);
      setError(null);
      setSubmitted(false);
    }
  }, [open, request.reference]);

  // Hauteur auto (1 à 4 lignes environ) : un clavier tactile ne laisse pas
  // deviner combien de lignes tiennent — le champ grandit avec le texte.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [body]);

  const values = React.useMemo(
    () => requestTemplateValues({ request, identity, events, members, tenantName }),
    [request, identity, events, members, tenantName],
  );
  const errors = validateEmailDraft({ subject, body }, files);
  const total = totalBytes(files);
  const tooHeavy = total > MAX_EMAIL_ATTACHMENT_BYTES;

  const ordered = React.useMemo(() => mergeThread(emails, citizenMessages), [emails, citizenMessages]);
  const piecesOf = React.useMemo(() => piecesByExchange(attachments), [attachments]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.data?.find((t) => t.id === id);
    if (!tpl) return;
    setSubject(renderTemplate(tpl.subject, values));
    setBody(renderTemplate(tpl.body, values));
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((current) => [...current, ...Array.from(list)]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
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
        subject: subject.trim(), body, files, documentIds: [],
        templateId: tpl?.id ?? null, templateName: tpl?.name ?? null,
      });
      setBody("");
      setFiles([]);
      setTemplateId("");
      setSubject(defaultEmailSubject(request.reference));
      setSubmitted(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible.");
    }
  }

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => { if (!o && !sending) onOpenChange(false); }}
      title={identity.known ? identity.name : "Usager"}
      subtitle={[request.socle_procedure_label ?? request.subject, request.reference].filter(Boolean).join(" · ")}
      locked={sending}
      footer={
        closed ? null : (
          <>
            {templates.data && templates.data.length > 0 ? (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
                {templates.data.map((t) => (
                  <MobileChip key={t.id} active={t.id === templateId} onClick={() => applyTemplate(t.id)}>
                    {t.name}
                  </MobileChip>
                ))}
              </div>
            ) : null}
            <Input
              className="h-11"
              placeholder="Objet"
              aria-label="Objet du message"
              value={subject}
              disabled={sending}
              onChange={(e) => setSubject(e.target.value)}
            />
            {submitted && errors.subject ? <p role="alert" className="text-xs text-destructive">{errors.subject}</p> : null}
            <p className="text-xs text-muted-foreground">
              {deliveryPreview.isLoading
                ? DELIVERY_PENDING_NOTICE
                : deliveryPreview.data?.delivery === "espace"
                ? "Le message sera publié dans l'espace de l'usager : il recevra un courriel avec ses premiers mots et un lien, et pourra répondre en ligne."
                : "L'usager ne peut pas répondre par courriel ; s'il suit sa demande en ligne, il peut y répondre."}
            </p>
            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={acceptAttribute()}
                className="hidden"
                disabled={sending}
                onChange={(e) => addFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={sending}
                onClick={() => fileRef.current?.click()}
                aria-label="Joindre une photo, un document"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground disabled:opacity-50"
              >
                <Camera className="size-[22px]" aria-hidden="true" />
              </button>
              <Textarea
                ref={bodyRef}
                className="max-h-28 min-h-11 flex-1 resize-none overflow-y-auto py-2.5"
                placeholder="Votre message…"
                aria-label="Message à l'usager"
                rows={1}
                value={body}
                disabled={sending}
                onChange={(e) => setBody(e.target.value)}
              />
              <button
                type="button"
                disabled={sending || body.trim() === ""}
                onClick={() => void submit()}
                aria-label="Envoyer"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
              >
                <Send className="size-5" aria-hidden="true" />
              </button>
            </div>
            {submitted && errors.body ? <p role="alert" className="text-xs text-destructive">{errors.body}</p> : null}
            {files.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-1 text-[11.5px]">
                    <span className="font-semibold">{file.name}</span>
                    <span className="text-muted-foreground">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => setFiles((c) => c.filter((_, i) => i !== index))}
                      aria-label={`Retirer ${file.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {submitted && errors.attachments ? <p role="alert" className="text-xs text-destructive">{errors.attachments}</p> : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </>
        )
      }
    >
      {request.body ? (
        <div className="flex max-w-[85%] flex-col gap-1 self-start">
          <span className="text-center text-xs font-semibold text-muted-foreground">
            Dépôt · {formatTimeline(request.received_at)}
          </span>
          <div className="rounded-[14px] rounded-bl-[4px] border border-border bg-card px-3.5 py-3 text-sm leading-relaxed shadow-airbnb-sm">
            {request.body}
          </div>
        </div>
      ) : null}

      {ordered.length === 0 && !request.body ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Aucun échange enregistré.</p>
      ) : null}

      {ordered.map((entry) => {
        if (entry.kind === "citizen") {
          const message = entry.message;
          const pieces = piecesOf.get(message.id) ?? [];
          return (
            <div key={message.id} className="flex max-w-[85%] flex-col gap-1 self-start">
              <span className="text-xs font-semibold text-muted-foreground">
                Usager, {citizenChannelLabel(message.author_kind)} · {formatTimeline(message.created_at)}
              </span>
              <div className="rounded-[14px] rounded-bl-[4px] border border-border bg-card px-3.5 py-3 text-sm leading-relaxed shadow-airbnb-sm">
                <p className="whitespace-pre-wrap">{message.body}</p>
                {pieces.length > 0 ? (
                  <p className="pt-1.5 text-[11.5px] text-muted-foreground">
                    {pieces.length === 1 ? "Pièce jointe" : `${pieces.length} pièces jointes`} : {pieces.map((p) => p.file_name).join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        }
        // Les avis non partis (B12) sont une information de bureau : le fil mobile reste celui des échanges.
        if (entry.kind === "notice") return null;
        const mail = entry.mail;
        return (
          <div key={mail.id} className="flex max-w-[85%] flex-col gap-1 self-end rounded-[14px] rounded-br-[4px] bg-primary/10 px-3.5 py-3">
            <span className="text-sm font-bold">{mail.subject}</span>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{mail.body}</p>
            <span className="flex items-center gap-1.5 self-end text-[11px] font-semibold text-primary">
              {exchangeAuthor(members, mail.sent_by).name} · {formatTimeline(mail.sent_at ?? mail.created_at)}
              {mail.status === "echec" ? <Pill tone="error">Non envoyé</Pill> : null}
            </span>
          </div>
        );
      })}

      {closed ? (
        <MobileNotice tone="warn">
          {!recipient
            ? identity.anonymous
              ? "Ce dépôt est anonyme : aucune adresse ne permet d'écrire à l'usager."
              : completable
                ? "La fiche de cet usager ne porte aucune adresse de courriel."
                : "L'identité retenue au dépôt ne comporte pas d'adresse de courriel."
            : archived
              ? "Cette demande est archivée : aucun nouvel échange ne peut partir."
              : "Écrire à l'usager exige le droit d'instruction sur cette demande."}
        </MobileNotice>
      ) : null}
    </MobileSheet>
  );
}
