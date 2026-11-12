import * as React from "react";
import { ExternalLink, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  defaultReplyChannel, REPLY_BODY_MAX, REPLY_SUBJECT_MAX,
  type ReplyChannel, type ReplyOutcome,
} from "@fn/_shared/clara/reply";
import { MOTIF_LABELS, type ClosureMotif, type ReplyValidationState } from "../statuts";
import { useSubmitClaraReply } from "./useClaraReply";

// Courrier de réponse validé dans Clara (2026-11-12).
//
// La démarche fait valider ses courriers de réponse dans Clara : l'agent ne
// résout pas, il RÉDIGE. Le courrier part dans Clara comme courrier sortant lié
// à la demande ; la demande reste en instruction, sous-état « Réponse en
// validation », et prendra l'issue choisie ICI quand Clara signalera l'envoi.
//
// ⚠️ L'identifiant de soumission est tiré à l'OUVERTURE et conservé entre deux
// essais : un nouvel essai après une panne retrouve le même courrier chez
// Clara au lieu d'en créer un second.

const NEGATIVE_MOTIFS: ClosureMotif[] = ["irrecevable", "reorientation"];

export function ClaraReplyDialog({
  open,
  onClose,
  request,
  piecesBlocking,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  request: { id: string; reference: string; subject: string; requesterEmail: string | null };
  /** Pièces obligatoires non conformes : une issue positive est refusée (miroir de t17). */
  piecesBlocking: string | null;
  onSubmitted: (reference: string | null) => void;
}) {
  const submit = useSubmitClaraReply();
  const [submissionId, setSubmissionId] = React.useState("");
  const [outcome, setOutcome] = React.useState<ReplyOutcome>("resolue_positive");
  const [motif, setMotif] = React.useState<ClosureMotif | "">("");
  const [closureText, setClosureText] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [channel, setChannel] = React.useState<ReplyChannel>("paper");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSubmissionId(crypto.randomUUID());
    setOutcome("resolue_positive");
    setMotif("");
    setClosureText("");
    setSubject(`Réponse à votre demande ${request.reference}`);
    setBody("");
    setChannel(defaultReplyChannel(request.requesterEmail));
    setError(null);
  }, [open, request.reference, request.requesterEmail]);

  const positiveBlocked = outcome === "resolue_positive" && piecesBlocking !== null;
  const ready = subject.trim() !== "" && body.trim() !== "" && !positiveBlocked;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      const result = await submit.mutateAsync({
        requestId: request.id,
        submissionId,
        outcome,
        motif: outcome === "resolue_negative" && motif !== "" ? motif : null,
        closureText: closureText.trim() || null,
        subject: subject.trim(),
        body: body.trim(),
        channel,
      });
      onSubmitted(result.courier_reference);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dépôt impossible.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !submit.isPending) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Préparer le courrier de réponse</DialogTitle>
          <DialogDescription>
            Cette démarche fait valider ses courriers de réponse dans Clara. Le courrier n'est pas
            envoyé d'ici : il est déposé dans Clara comme courrier sortant, lié à la demande, qui
            restera « Réponse en validation » jusqu'à son envoi.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Issue de la demande" htmlFor="cr-outcome" required
              hint="Appliquée quand Clara signalera l'envoi du courrier.">
              <Select id="cr-outcome" value={outcome}
                onChange={(e) => setOutcome(e.target.value as ReplyOutcome)}>
                <option value="resolue_positive">Résolue positivement</option>
                <option value="resolue_negative">Résolue négativement</option>
              </Select>
            </Field>
            <Field label="Canal d'envoi proposé" htmlFor="cr-channel"
              hint="Clara peut le changer avant l'envoi.">
              <Select id="cr-channel" value={channel}
                onChange={(e) => setChannel(e.target.value as ReplyChannel)}>
                <option value="email">Courriel</option>
                <option value="paper">Courrier papier</option>
              </Select>
            </Field>
          </div>
          {outcome === "resolue_negative" ? (
            <Field label="Motif (facultatif)" htmlFor="cr-motif">
              <Select id="cr-motif" value={motif}
                onChange={(e) => setMotif(e.target.value as ClosureMotif | "")}>
                <option value="">— Aucun —</option>
                {NEGATIVE_MOTIFS.map((m) => <option key={m} value={m}>{MOTIF_LABELS[m]}</option>)}
              </Select>
            </Field>
          ) : null}
          {positiveBlocked ? (
            <p role="alert" className="text-sm text-destructive">{piecesBlocking}</p>
          ) : null}
          <Field label="Objet du courrier" htmlFor="cr-subject" required>
            <Input id="cr-subject" value={subject} maxLength={REPLY_SUBJECT_MAX}
              onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Texte du courrier" htmlFor="cr-body" required
            hint="Il sera visé, signé et envoyé dans Clara ; Iris n'en garde pas de copie.">
            <Textarea id="cr-body" rows={10} value={body} maxLength={REPLY_BODY_MAX}
              onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Field label="Commentaire de clôture pour l'usager (facultatif)" htmlFor="cr-closure"
            hint="Repris dans l'espace usager à la clôture. Jamais une note interne.">
            <Textarea id="cr-closure" value={closureText} onChange={(e) => setClosureText(e.target.value)} />
          </Field>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submit.isPending}>Annuler</Button>
            <Button type="submit" disabled={!ready || submit.isPending}>
              <Send /> {submit.isPending ? "Dépôt dans Clara…" : "Déposer dans Clara"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Bandeau de la fiche pendant la validation : où en est le courrier, et le lien vers Clara. */
export function ClaraReplyBanner({
  state,
  courierReference,
  courierUrl,
  outcome,
}: {
  state: ReplyValidationState;
  courierReference: string | null;
  courierUrl: string | null;
  outcome: string | null;
}) {
  const issue = outcome === "resolue_negative" ? "négativement" : "positivement";
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">
      <span className="font-semibold">
        {state === "depot_en_cours" ? "Dépôt du courrier de réponse dans Clara en cours." : "Réponse en validation dans Clara."}
      </span>
      {state === "en_validation" ? (
        <span className="text-muted-foreground">
          La demande sera résolue {issue} quand Clara signalera l'envoi du courrier.
        </span>
      ) : null}
      {courierUrl ? (
        <a href={courierUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          Courrier {courierReference ?? ""} dans Clara <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : courierReference ? (
        <span className="font-mono">Courrier {courierReference}</span>
      ) : null}
    </div>
  );
}
