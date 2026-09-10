// Écran 2 « Fiche demande » (maquette Claude Design « Iris mobile — v2 »,
// lignes 162-271) — route `/demandes/:id` sur téléphone. Reprend les hooks et
// les dérivations pures de `RequestDetailPage.tsx` (bureau), condensés en une
// seule colonne défilante : en-tête (statut, urgence, avancement horizontal),
// trois actions rapides, interventions, usager, lieu d'intervention, résumé,
// pièces, notes internes, activité — et un pied « Instruire » qui ouvre le
// tiroir des quatre gestes d'instruction. Le RLS et les gardes SQL restent
// l'autorité : cette page reflète, elle ne protège rien de plus que le bureau.
//
// ⚠️ Écart à la maquette (décidé) : l'écran 4 de la maquette ne montre que
// TROIS statuts cibles à titre d'exemple. Le workflow a SEPT statuts et la
// garde `requests_guard_transition` peut en autoriser plusieurs à la fois
// (ex. depuis « En instruction ») : `MobileStatusSheet` liste TOUTES les
// transitions que `allowedTransitionsFor` rend, jamais un sous-ensemble figé.

import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Camera, Check, HardHat, MessageSquare, MoreHorizontal, Navigation, Phone, Plus, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { Avatar, Pill } from "@/components/ui/surface";
import {
  MobileFooter, MobileHeader, MobileNotice, MobileQuickAction,
} from "@/components/layout/mobile/MobilePage";
import { StatusBadge } from "../StatusBadge";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { useDevice } from "@/features/device/DeviceProvider";
import { useSocleContact } from "@/features/contacts/useContacts";
import { useCanBrowseUsagers } from "@/features/contacts/useUsagers";
import { rightsFor, isAdminOn } from "@/features/rights/rights";
import { cn } from "@/lib/utils";
import { googleMapsDirectionsUrl } from "@/lib/carto";
import type { EdgeError } from "@/lib/edge";
import { useTransitionRunner, type TransitionInput } from "../TransitionActions";
import {
  allowedTransitionsFor, canProcessWith, canWriteWith, PRIORITY_LABELS, STATUS_LABELS,
  type RequestRights, type RequestStatus, type TransitionSpec,
} from "../statuts";
import {
  createAttachmentUrl, useAddMessage, useEligibleAssignees, useRequest, useRequestAttachments,
  useRequestEmails, useRequestEvents, useRequestMessages, useTenantMembers,
  type RequestAttachment, type TenantMember,
} from "../useRequests";
import { useSendClosureEmail, useSendRequestEmail } from "../instruction/useSendRequestEmail";
import { useAttachRequestPiece } from "../instruction/useEditRequestForm";
import {
  activityItems, attachmentExt, buildStages, dueView, formAnswers, formatBytes, formatTimeline,
  headerSubtitle, memberName, requesterView,
} from "../instruction/instruction";
import { interventionLocation } from "../instruction/lieu";
import { inlineViewable, interventionDocuments, usagerPieces } from "../instruction/documents";
import { blockingMessage, motifLabel, pieceRequirements } from "../instruction/conformite";
import {
  canComplete, formatDay, interventionStatusLabel, interventionTone, isLate, isoDay, solicitGate,
  sortInterventions, type CompletionDraft, type InterventionRow, type SollicitationDraft,
} from "../interventions/interventions";
import {
  useCompleteIntervention, useEligibleIntervenants, useRequestIntervention, useRequestInterventions,
} from "../interventions/useInterventions";
import { SolliciterDialog } from "../interventions/SolliciterDialog";
import { DeclarerInterventionSheet } from "../interventions/mobile/DeclarerInterventionSheet";
import { stageDotLit, stageDots } from "./mobileRequests";
import { MobileInstruireDrawer } from "./MobileInstruireDrawer";
import { MobileStatusSheet } from "./MobileStatusSheet";
import { MobileEcrireSheet } from "./MobileEcrireSheet";

export function MobileRequestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { current, rights } = useTenant();
  const { session } = useAuth();
  const { setOverride } = useDevice();
  const orgId = current?.organizationId ?? "";

  const request = useRequest(id);
  const events = useRequestEvents(id);
  const attachments = useRequestAttachments(id);
  const messages = useRequestMessages(id);
  const emails = useRequestEmails(id);
  const members = useTenantMembers(orgId);
  const eligibleAssignees = useEligibleAssignees(id);
  const canBrowseUsagers = useCanBrowseUsagers();
  const r = request.data ?? null;
  const socleContact = useSocleContact(orgId, canBrowseUsagers ? r?.socle_contact_id ?? null : null);

  const sendEmail = useSendRequestEmail();
  const sendClosure = useSendClosureEmail();
  const attachPiece = useAttachRequestPiece();
  const addMessage = useAddMessage();
  const interventions = useRequestInterventions(id);
  const eligibleIntervenants = useEligibleIntervenants(id);
  const requestIntervention = useRequestIntervention();
  const completeIntervention = useCompleteIntervention();

  const [instruireOpen, setInstruireOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [ecrireOpen, setEcrireOpen] = React.useState(false);
  const [solliciterOpen, setSolliciterOpen] = React.useState(false);
  const [solliciterError, setSolliciterError] = React.useState<string | null>(null);
  const [completing, setCompleting] = React.useState<InterventionRow | null>(null);
  const [completeError, setCompleteError] = React.useState<string | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [showAllActivity, setShowAllActivity] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ text: string; visible: boolean }>({ text: "", visible: false });
  const toastTimer = React.useRef<number | undefined>(undefined);
  const pendingNoteRef = React.useRef<string | null>(null);
  const photoInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const flash = React.useCallback((text: string) => {
    setToast({ text, visible: true });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2800);
  }, []);

  /** Miroir de `onTransitionDone` (bureau) : l'avis de clôture suit la
   *  transition, et une note tapée dans la feuille Statut part APRÈS elle. */
  const onTransitionDone = React.useCallback(
    (spec: TransitionSpec) => {
      setStatusOpen(false);
      const note = pendingNoteRef.current;
      pendingNoteRef.current = null;
      if (note && r) {
        void addMessage.mutateAsync({
          requestId: r.id, organizationId: r.organization_id, authorId: session?.user.id ?? "", body: note,
        });
      }
      const done = `Statut : ${STATUS_LABELS[spec.to]}`;
      if (spec.to !== "resolue_positive" && spec.to !== "resolue_negative") {
        flash(done);
        return;
      }
      flash(`${done} — envoi de l'avis à l'usager…`);
      sendClosure
        .mutateAsync({ requestId: id ?? "" })
        .then(() => flash(`${done} — l'usager a été prévenu par courriel.`))
        .catch((err: unknown) => {
          const code = (err as EdgeError | null)?.code;
          if (code === "no_recipient") {
            flash(`${done} — aucun courriel : la demande ne porte pas d'adresse.`);
            return;
          }
          flash(done);
          setError(
            `La demande est bien ${STATUS_LABELS[spec.to].toLowerCase()}, mais l'avis n'a pas pu partir : `
              + (err instanceof Error ? err.message : "envoi impossible."),
          );
        });
    },
    [flash, id, r, sendClosure, addMessage, session],
  );
  const runner = useTransitionRunner({
    requestId: id ?? "",
    assignedTo: r?.assigned_to ?? null,
    onDone: onTransitionDone,
  });

  function goBack() {
    if (window.history.state && typeof window.history.state.idx === "number" && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate("/demandes");
    }
  }

  if (!current) return null;

  if (request.isLoading) {
    return (
      <div className="flex min-h-full flex-col">
        <MobileHeader leading="back" onLeading={goBack} title="Demande" />
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">Chargement…</p>
        </div>
      </div>
    );
  }
  if (!r) {
    return (
      <div className="flex min-h-full flex-col">
        <MobileHeader leading="back" onLeading={goBack} title="Demande" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">Demande introuvable ou hors de votre périmètre.</p>
          <Link to="/demandes" className="text-sm font-semibold text-primary hover:underline">← Retour aux demandes</Link>
        </div>
      </div>
    );
  }

  // ---- Droits reflétés (miroir de RequestDetailPage, lignes ~297-427) -------
  const rr: RequestRights = {
    rights: rightsFor(rights, r.socle_scope_org_id, r.socle_procedure_id),
    isAdmin: isAdminOn(rights, r.socle_scope_org_id),
  };
  const writer = canWriteWith(rr);
  const canInstruct = canProcessWith(rr);
  const status = r.status as RequestStatus;
  const transitions = writer ? allowedTransitionsFor(status, rr) : [];
  const archived = status === "archivee";
  const memberList = members.data ?? [];
  const nameOf = (userId: string | null) => memberName(memberList, userId);
  const eligibleMembers: TenantMember[] = (eligibleAssignees.data ?? []).map((e) => {
    const known = memberList.find((m) => m.userId === e.user_id);
    return known ?? { userId: e.user_id, role: "agent", displayName: e.display_name || e.email, email: e.email };
  });
  const intervenantOnly = !rr.rights.has("consultation") && !rights.is_platform_admin;

  // ---- Dérivés purs -----------------------------------------------------------
  const view = requesterView(r.requester_snapshot, r.identity_status, socleContact.data ?? null);
  const identity = view.identity;
  const lieu = interventionLocation(r.procedure_snapshot, r.form_data);
  const lieuKeys = new Set(lieu?.keys ?? []);
  const answers = formAnswers(r.procedure_snapshot, r.form_data).filter((a) => !lieuKeys.has(a.key));
  const now = new Date();
  const due = dueView(r.due_at, now);
  const subtitle = headerSubtitle({
    requesterName: socleContact.isLoading ? null : identity.name,
    channel: r.channel, source: r.source,
    receivedAt: r.received_at, dueAt: r.due_at,
  });
  const stages = buildStages({
    status, closureMotif: r.closure_motif, createdAt: r.created_at, events: events.data ?? [],
  });
  const dots = stageDots(stages);
  const attachmentList = attachments.data ?? [];
  const usagerAttachments = usagerPieces(attachmentList);
  const interventionProofs = interventionDocuments(attachmentList);
  const requirements = pieceRequirements(r.procedure_snapshot, r.form_data, usagerAttachments);
  const piecesBlocking = blockingMessage(requirements);
  const pieces = usagerAttachments.filter((a) => !a.email_id && !a.superseded_by);
  const activity = activityItems({ events: events.data ?? [], notes: messages.data ?? [], nameOf, motifLabel });
  const activityShown = showAllActivity ? activity : activity.slice(0, 8);
  const interventionList = interventions.data ?? [];
  const sortedInterventions = sortInterventions(interventionList);
  const gate = solicitGate(status, canInstruct && !archived);
  const completableIntervention = interventionList.find((i) => canComplete(i, session?.user.id ?? null)) ?? null;
  const recipient = identity.anonymous ? null : identity.email;

  const ecrireDisabledReason = !canInstruct
    ? "Exige le droit d'instruction sur cette demande"
    : archived ? "Demande archivée"
    : !recipient ? "Aucune adresse de courriel dans l'identité déposée"
    : null;
  const statusDisabledReason = transitions.length === 0 ? "Aucun changement de statut n'est possible" : null;
  const photoDisabledReason = !canInstruct ? "Exige le droit d'instruction sur cette demande" : null;

  async function openAttachment(a: RequestAttachment, download: boolean) {
    setError(null);
    const url = await createAttachmentUrl(a.storage_path, download ? a.file_name : undefined);
    if (!url) {
      setError("La pièce n'a pas pu être ouverte — URL signée refusée.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  async function handlePieceFiles(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError(null);
    try {
      const result = await attachPiece.mutateAsync({
        requestId: r!.id, organizationId: r!.organization_id, file, formFieldKey: null,
      });
      flash(result.remplacees > 0
        ? `Pièce ajoutée — ${result.remplacees} pièce${result.remplacees > 1 ? "s" : ""} remplacée${result.remplacees > 1 ? "s" : ""}.`
        : "Pièce ajoutée.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dépôt refusé.");
    }
  }

  function submitStatus(spec: TransitionSpec, input: TransitionInput, note: string) {
    pendingNoteRef.current = note.trim() === "" ? null : note.trim();
    void runner.run(spec, input);
  }

  async function submitSollicitation(draft: SollicitationDraft) {
    setSolliciterError(null);
    try {
      await requestIntervention.mutateAsync({
        requestId: r!.id, intervenantId: draft.intervenantId, requestedFor: draft.requestedFor, comment: draft.comment,
      });
      setSolliciterOpen(false);
      const who = eligibleIntervenants.data?.find((i) => i.user_id === draft.intervenantId);
      flash(`${who?.display_name || "L'intervenant"} sollicité pour le ${formatDay(draft.requestedFor)}.`);
    } catch (err) {
      setSolliciterError(err instanceof Error ? err.message : "Sollicitation refusée.");
    }
  }

  async function submitCompletion(draft: CompletionDraft) {
    if (!completing) return;
    setCompleteError(null);
    try {
      const result = await completeIntervention.mutateAsync({
        interventionId: completing.id, requestId: r!.id, organizationId: r!.organization_id,
        completedOn: draft.completedOn, comment: draft.comment, files: draft.files,
      });
      setCompleting(null);
      flash(result.attachments > 0
        ? `Intervention déclarée réalisée le ${formatDay(draft.completedOn)} — ${result.attachments} justificatif${result.attachments > 1 ? "s" : ""}.`
        : `Intervention déclarée réalisée le ${formatDay(draft.completedOn)}.`);
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "Enregistrement refusé.");
    }
  }

  function copyReference() {
    setMenuOpen(false);
    void navigator.clipboard?.writeText(r!.reference).then(() => flash("Référence copiée"));
  }

  return (
    <div className="flex min-h-full flex-col">
      <MobileHeader
        leading="back"
        onLeading={goBack}
        title={<span className="font-mono text-[13px] font-normal text-muted-foreground">{r.reference}</span>}
        trailing={
          <Dropdown
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={(p) => (
              <button type="button" {...p} aria-label="Autres actions" className="flex size-11 items-center justify-center rounded-xl text-foreground hover:bg-secondary">
                <MoreHorizontal className="size-[22px]" aria-hidden="true" />
              </button>
            )}
          >
            <DropdownItem onClick={copyReference}>Copier la référence</DropdownItem>
            <DropdownItem onClick={() => { setMenuOpen(false); setOverride("desktop"); }}>
              Ouvrir la version bureau
            </DropdownItem>
          </Dropdown>
        }
      />

      <div className="flex flex-1 flex-col gap-3.5 px-4 py-3.5">
        {error ? <MobileNotice tone="error">{error}</MobileNotice> : null}

        <div className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm">
          <h1 className="text-2xl font-extrabold leading-tight tracking-tight">{r.subject}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} size="md" />
            <Pill tone="neutral">Urgence {PRIORITY_LABELS[r.priority]?.toLowerCase() ?? r.priority}</Pill>
            {due ? (
              <span className={cn(
                "inline-flex items-center rounded-full px-[11px] py-[5px] text-[11.5px] font-semibold",
                due.tone === "late" ? "bg-destructive/10 text-destructive"
                  : due.tone === "soon" ? "bg-secondary/40 text-secondary-foreground"
                  : "bg-muted text-muted-foreground",
              )}>
                {due.label}
              </span>
            ) : null}
          </div>
          <p className="text-[13px] text-muted-foreground">{subtitle}</p>

          <div className="flex items-start gap-0 pt-1">
            {dots.map((s, i) => {
              const lit = stageDotLit(s.state);
              return (
                <div key={s.key} className="flex flex-1 flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className={cn("size-2.5 shrink-0 rounded-full", lit ? "bg-primary" : "bg-border")} aria-hidden="true" />
                    {i < dots.length - 1 ? (
                      <span className={cn("h-0.5 flex-1", s.state === "done" ? "bg-primary" : "bg-border")} aria-hidden="true" />
                    ) : null}
                  </div>
                  <span className="flex flex-col text-[11px] leading-tight">
                    <span className={s.state === "current" ? "font-extrabold text-foreground" : "font-semibold text-muted-foreground"}>
                      {s.label}
                    </span>
                    {/* Les étapes à venir n'ont qu'un libellé (maquette) : leur
                        explication tient dans la feuille « Changer le statut ». */}
                    {lit ? <span className="text-muted-foreground">{s.hint}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <MobileQuickAction
            icon={<MessageSquare aria-hidden="true" />}
            label="Écrire"
            disabled={Boolean(ecrireDisabledReason)}
            disabledReason={ecrireDisabledReason}
            onClick={() => setEcrireOpen(true)}
          />
          <MobileQuickAction
            icon={<RefreshCw aria-hidden="true" />}
            label="Statut"
            disabled={Boolean(statusDisabledReason)}
            disabledReason={statusDisabledReason}
            onClick={() => setStatusOpen(true)}
          />
          <MobileQuickAction
            icon={<Camera aria-hidden="true" />}
            label="Photo"
            disabled={Boolean(photoDisabledReason)}
            disabledReason={photoDisabledReason}
            onClick={() => photoInputRef.current?.click()}
          />
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { void handlePieceFiles(e.target.files); e.target.value = ""; }}
        />

        {/* Interventions */}
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm">
          <div className="flex items-center gap-2">
            <HardHat className="size-[18px] text-muted-foreground" aria-hidden="true" />
            <span className="flex-1 text-base font-bold">Interventions</span>
            {sortedInterventions.length > 0 ? (
              <span className="text-xs font-bold text-muted-foreground">{sortedInterventions.length}</span>
            ) : null}
          </div>
          {sortedInterventions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{gate.reason ?? "Aucun intervenant sollicité."}</p>
          ) : (
            sortedInterventions.map((i) => {
              const tone = interventionTone(i, isoDay(now));
              const late = isLate(i, isoDay(now));
              const proofs = interventionProofs.filter((a) => a.intervention_id === i.id);
              return (
                <div key={i.id} className={cn("flex flex-col gap-2 rounded-xl px-3 py-2.5", tone === "ok" ? "bg-primary/[0.06]" : "bg-muted/30")}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm font-bold">{nameOf(i.intervenant_id)}</span>
                    <Pill tone={tone}>{late ? "En retard" : interventionStatusLabel(i.status)}</Pill>
                  </div>
                  <p className="text-[13px] leading-relaxed">{i.request_comment}</p>
                  <p className="text-xs text-muted-foreground">demandée pour le {formatDay(i.requested_for)}</p>
                  {i.status === "realisee" ? (
                    <div className="flex flex-col gap-1.5 rounded-lg bg-primary/[0.08] px-2.5 py-2 text-[12.5px]">
                      <p className="font-semibold text-primary">Réalisée le {formatDay(i.completed_on)}</p>
                      {i.completion_comment ? <p>{i.completion_comment}</p> : null}
                      {proofs.length > 0 ? (
                        <ul className="flex flex-wrap gap-1.5">
                          {proofs.map((doc) => (
                            <li key={doc.id} className="flex items-center gap-1.5 rounded-md bg-card px-2 py-1">
                              <span className="text-[11px] font-semibold">{doc.file_name}</span>
                              <button
                                type="button"
                                className="text-[11px] font-bold text-primary"
                                onClick={() => void openAttachment(doc, !inlineViewable(doc.mime_type))}
                              >
                                {inlineViewable(doc.mime_type) ? "Voir" : "Télécharger"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {canComplete(i, session?.user.id ?? null) ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setCompleting(i)}>
                      Déclarer réalisée
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
          {gate.ok ? (
            <button
              type="button"
              onClick={() => setSolliciterOpen(true)}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm font-bold text-primary"
            >
              <Plus className="size-[18px]" aria-hidden="true" /> Solliciter un intervenant
            </button>
          ) : null}
        </div>

        {/* Usager */}
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm">
          {identity.anonymous ? (
            <p className="text-sm text-muted-foreground">Dépôt anonyme — aucune identité connue.</p>
          ) : (
            <div className="flex items-center gap-3">
              <Avatar initials={identity.initials} size="lg" muted={!identity.known} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-bold">{identity.name}</span>
                <span className="truncate text-[13px] text-muted-foreground">
                  {[identity.phone, identity.address].filter(Boolean).join(" · ") || "Aucune coordonnée connue"}
                </span>
              </div>
              {identity.phone ? (
                <a
                  href={`tel:${identity.phone.replace(/\s+/g, "")}`}
                  aria-label="Appeler l'usager"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-primary"
                >
                  <Phone className="size-5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          )}
        </div>

        {/* Lieu d'intervention */}
        {lieu && !lieu.empty ? (
          <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-bold">{lieu.title}</span>
              {googleMapsDirectionsUrl(lieu.query) ? (
                <Button asChild variant="outline" size="sm">
                  <a href={googleMapsDirectionsUrl(lieu.query)!} target="_blank" rel="noreferrer">
                    <Navigation aria-hidden="true" /> Guider
                  </a>
                </Button>
              ) : null}
            </div>
            <address className="flex flex-col gap-0.5 not-italic text-sm">
              {lieu.lines.map((line) => <span key={line}>{line}</span>)}
              {lieu.details.map((d) => (
                <span key={d.label} className="text-xs text-muted-foreground">{d.label} : {d.value}</span>
              ))}
            </address>
          </div>
        ) : null}

        {/* Résumé */}
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm">
          <span className="text-base font-bold">Résumé</span>
          {answers.length === 0 && !r.body ? (
            <p className="text-sm text-muted-foreground">Aucune réponse de formulaire ni description.</p>
          ) : (
            <dl className="flex flex-col gap-2">
              {answers.map((a) => (
                <div key={a.key} className="flex flex-col gap-0.5">
                  <dt className="text-[11px] font-semibold text-muted-foreground">{a.label}</dt>
                  <dd className="whitespace-pre-wrap text-[13.5px] font-semibold">{a.value}</dd>
                </div>
              ))}
              {r.body ? (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[11px] font-semibold text-muted-foreground">Description</dt>
                  <dd className="whitespace-pre-wrap text-[13.5px] font-semibold">{r.body}</dd>
                </div>
              ) : null}
            </dl>
          )}
          {r.closure_motif || r.closure_text ? (
            <div className="flex flex-col gap-1 border-t border-border pt-2.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Clôture</span>
              {r.closure_text ? <p className="whitespace-pre-wrap text-[13px]">« {r.closure_text} »</p> : null}
            </div>
          ) : null}
        </div>

        {/* Pièces */}
        <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm">
          <span className="text-base font-bold">Pièces</span>
          {pieces.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune pièce déposée.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {pieces.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-2.5 py-2">
                  <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-[9.5px] font-extrabold">
                    {attachmentExt(a.file_name, a.mime_type)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12.5px] font-semibold">{a.file_name}</span>
                    <span className="text-[11px] text-muted-foreground">{formatBytes(a.file_size)}</span>
                  </span>
                  <button
                    type="button"
                    className="text-xs font-bold text-primary"
                    onClick={() => void openAttachment(a, !inlineViewable(a.mime_type))}
                  >
                    {inlineViewable(a.mime_type) ? "Voir" : "Télécharger"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Notes internes */}
        {!intervenantOnly ? (
          <NotesBlock
            messages={messages.data ?? []}
            memberList={memberList}
            writer={writer}
            archived={archived}
            pending={addMessage.isPending}
            onAdd={async (body) => {
              setError(null);
              try {
                await addMessage.mutateAsync({
                  requestId: r.id, organizationId: r.organization_id, authorId: session?.user.id ?? "", body,
                });
                flash("Note interne enregistrée");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Enregistrement refusé.");
              }
            }}
          />
        ) : null}

        {/* Activité */}
        <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm">
          <span className="text-base font-bold">Activité</span>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune activité enregistrée.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {activityShown.map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5 border-t border-border/70 pt-2 first:border-t-0 first:pt-0">
                  <span className="text-[13px] font-bold">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.detail}</span>
                  <span className="text-[11px] text-muted-foreground/80">{formatTimeline(item.at)}</span>
                </li>
              ))}
            </ul>
          )}
          {!showAllActivity && activity.length > 8 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllActivity(true)}>
              Tout afficher
            </Button>
          ) : null}
        </div>
      </div>

      {writer ? (
        <MobileFooter safeArea={false}>
          <Button size="lg" className="h-12 w-full rounded-[14px] text-base" onClick={() => setInstruireOpen(true)}>
            <Check aria-hidden="true" /> Instruire
          </Button>
        </MobileFooter>
      ) : null}

      <MobileInstruireDrawer
        open={instruireOpen}
        onOpenChange={setInstruireOpen}
        procedureLabel={r.socle_procedure_label}
        reference={r.reference}
        onStatus={() => setStatusOpen(true)}
        statusDisabledReason={statusDisabledReason}
        completableIntervention={completableIntervention}
        onDeclareIntervention={(i) => setCompleting(i)}
        onPhoto={() => photoInputRef.current?.click()}
        photoDisabledReason={photoDisabledReason}
        onEcrire={() => setEcrireOpen(true)}
        ecrireDisabledReason={ecrireDisabledReason}
      />

      <MobileStatusSheet
        open={statusOpen}
        onOpenChange={setStatusOpen}
        status={status}
        transitions={transitions}
        members={eligibleMembers}
        runner={runner}
        organizationName={current.organizationName}
        piecesBlocking={piecesBlocking}
        onSubmit={submitStatus}
      />

      <MobileEcrireSheet
        open={ecrireOpen}
        onOpenChange={setEcrireOpen}
        request={r}
        identity={identity}
        emails={emails.data ?? []}
        members={memberList}
        events={events.data ?? []}
        tenantName={current.organizationName}
        canInstruct={canInstruct}
        archived={archived}
        sending={sendEmail.isPending}
        onSend={(payload) => sendEmail.mutateAsync({
          requestId: r.id, organizationId: r.organization_id, subject: payload.subject, body: payload.body,
          files: payload.files, documentIds: payload.documentIds, templateId: payload.templateId,
          templateName: payload.templateName,
        }).then(() => { flash("Message envoyé à l'usager."); })}
      />

      <SolliciterDialog
        open={solliciterOpen}
        intervenants={eligibleIntervenants.data ?? []}
        loadingIntervenants={eligibleIntervenants.isLoading}
        pending={requestIntervention.isPending}
        error={solliciterError}
        onClose={() => { setSolliciterOpen(false); setSolliciterError(null); }}
        onSubmit={(draft) => void submitSollicitation(draft)}
      />
      <DeclarerInterventionSheet
        intervention={completing}
        requestLabel={`${r.reference} — ${r.subject}`}
        pending={completeIntervention.isPending}
        progress={completeIntervention.progress}
        error={completeError}
        onClose={() => { setCompleting(null); setCompleteError(null); }}
        onSubmit={(draft) => void submitCompletion(draft)}
      />

      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed bottom-20 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-4 py-[11px] shadow-airbnb-xl transition-all duration-200",
          toast.visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
      >
        <Check className="size-4 text-primary" aria-hidden="true" />
        <span className="text-[13px] font-semibold">{toast.text}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NotesBlock({ messages, memberList, writer, archived, pending, onAdd }: {
  messages: { id: string; author_id: string | null; body: string; created_at: string }[];
  memberList: TenantMember[];
  writer: boolean;
  archived: boolean;
  pending: boolean;
  onAdd: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState("");
  const ordered = [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function submit() {
    const body = draft.trim();
    if (body === "") return;
    await onAdd(body);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm">
      <span className="text-base font-bold">Notes internes</span>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune note pour l'instant.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 rounded-lg bg-secondary/15 px-2.5 py-2">
              <span className="flex items-baseline gap-2 text-[12px]">
                <span className="font-bold">{memberName(memberList, m.author_id)}</span>
                <span className="text-muted-foreground">{formatTimeline(m.created_at)}</span>
              </span>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {writer && !archived ? (
        <div className="flex flex-col gap-2 border-t border-border pt-2.5">
          <Textarea
            className="min-h-[64px]"
            placeholder="Ajouter une note interne…"
            aria-label="Nouvelle note interne"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="button" size="sm" className="self-end" disabled={pending || draft.trim() === ""} onClick={() => void submit()}>
            {pending ? "Enregistrement…" : "Ajouter"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
