// Fiche d'instruction de la demande — design Claude Design « Suivi demande »
// (2026-08-22) : en-tête (fil d'Ariane, statut, échéance, action principale et
// menu des actions secondaires), onglets (résumé, documents, échanges, notes
// internes, activité) et rail (prise en charge, avancement, usager). Page
// pleine hauteur comme le parcours de création. Les fonctionnalités non
// livrées restent visibles mais grisées (`SOON`). Le RLS et la garde SQL
// restent l'autorité : l'UI reflète, et affiche tout refus tel quel.

import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Copy, MessageSquare, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";
import { useFullBleedLayout } from "@/components/layout/shellLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { useSocleOrganizationsCatalog } from "@/features/socle/useSocleCatalog";
import { useSocleContact } from "@/features/contacts/useContacts";
import { useCanBrowseUsagers } from "@/features/contacts/useUsagers";
import { UsagerEditDialog } from "@/features/contacts/UsagerEditDialog";
import { isAdminOn, rightsFor } from "@/features/rights/rights";
import { cn } from "@/lib/utils";
import type { EdgeError } from "@/lib/edge";
import { StatusBadge } from "./StatusBadge";
import { TransitionDialog, useTransitionRunner } from "./TransitionActions";
import {
  allowedTransitionsFor, canAdminWith, canProcessWith, canWriteWith, isFinal, STATUS_LABELS,
  type RequestRights, type RequestStatus, type TransitionSpec,
} from "./statuts";
import {
  createAttachmentUrl, useAddMessage, useAssignRequest, useDeleteMessage, useEligibleAssignees, useMentionableUsers,
  useRequest, useRequestAttachments, useRequestEmails, useRequestEvents, useRequestLinks,
  useRequestMessages, useRequestSummaries, useRequesterRequests, useTenantMembers, useUpdatePriority,
  type RequestAttachment, type TenantMember,
} from "./useRequests";
import { useSendClosureEmail, useSendRequestEmail } from "./instruction/useSendRequestEmail";
import { ActivityPane } from "./instruction/ActivityPane";
import { DocumentsPane } from "./instruction/DocumentsPane";
import { EchangesPane, type ComposerDraft, type SendEmailPayload } from "./instruction/EchangesPane";
import { QualificationDialog, type QualificationSubmit } from "./instruction/QualificationDialog";
import { AjouterPieceDialog } from "./instruction/AjouterPieceDialog";
import { FormulaireEditDialog } from "./instruction/FormulaireEditDialog";
import { useQualifyAttachment } from "./instruction/useQualifyAttachment";
import { useAttachRequestPiece, useUpdateRequestFormData } from "./instruction/useEditRequestForm";
import {
  blockingMessage, buildNonConformityEmail, motifLabel, pieceRequirements, readyToResume,
  type PieceRequirement, type QualifiableAttachment,
} from "./instruction/conformite";
import { NotesPane } from "./instruction/NotesPane";
import { ResumePane } from "./instruction/ResumePane";
import { AvancementCard, PriseEnChargeCard, UsagerCard } from "./instruction/InstructionRail";
import {
  activityItems, buildStages, dueView, formAnswers, formSchemaVersion,
  headerSubtitle, memberName, priorityOption, requesterView, splitTransitions,
} from "./instruction/instruction";
import { interventionLocation } from "./instruction/lieu";
import { formSchemaFrom } from "./instruction/instruction";
import { dataKey, flatFields } from "@fn/create-request-from-procedure/_shared/procedureForm";

type TabKey = "resume" | "docs" | "echanges" | "notes" | "activite";

const DUE_TONE = {
  late: "bg-destructive/10 text-destructive",
  soon: "bg-secondary/40 text-secondary-foreground",
  normal: "bg-muted text-muted-foreground",
} as const;

export function RequestDetailPage() {
  useFullBleedLayout();
  const { id } = useParams<{ id: string }>();
  const { current, rights } = useTenant();
  const { session } = useAuth();
  const orgId = current?.organizationId ?? "";

  const request = useRequest(id);
  const events = useRequestEvents(id);
  const attachments = useRequestAttachments(id);
  const messages = useRequestMessages(id);
  const emails = useRequestEmails(id);
  const links = useRequestLinks(id);
  const members = useTenantMembers(orgId);
  const eligibleAssignees = useEligibleAssignees(id);
  const mentionables = useMentionableUsers(id);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const sendEmail = useSendRequestEmail();
  const sendClosure = useSendClosureEmail();
  const qualify = useQualifyAttachment();
  const attachPiece = useAttachRequestPiece();
  const updateFormData = useUpdateRequestFormData();
  const r = request.data ?? null;
  const linkTargets = React.useMemo(
    () => (links.data ?? []).map((l) => l.target_request_id).filter((x): x is string => Boolean(x)),
    [links.data],
  );
  const linkedSummaries = useRequestSummaries(linkTargets);
  const otherRequests = useRequesterRequests(orgId, r?.socle_contact_id ?? null, id ?? "");
  // Identité de l'usager RELUE dans le Socle (source de vérité) : le
  // `requester_snapshot` fige ce qui a été retenu au dépôt, mais l'agent doit
  // voir — et pouvoir corriger — la fiche telle qu'elle est aujourd'hui.
  // Sans rétention (`gcTime: 0`), comme la page `/usagers/:contactId`.
  // Le droit reflété est celui que `socle-proxy` exige sur /v1/contacts/*
  // (création dans le tenant) ; sans lui, la fiche retombe sur le dépôt.
  const canBrowseUsagers = useCanBrowseUsagers();
  const socleContact = useSocleContact(orgId, canBrowseUsagers ? r?.socle_contact_id ?? null : null);

  const assignRequest = useAssignRequest();
  const updatePriority = useUpdatePriority();
  const addMessage = useAddMessage();
  const deleteMessage = useDeleteMessage();

  const [tab, setTab] = React.useState<TabKey>("resume");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [usagerEditOpen, setUsagerEditOpen] = React.useState(false);
  // Qualification d'une pièce : la pièce visée et le libellé de l'exigence.
  const [qualifying, setQualifying] =
    React.useState<{ attachment: QualifiableAttachment; label: string | null } | null>(null);
  const [qualifyError, setQualifyError] = React.useState<string | null>(null);
  // Brouillon déposé dans le composeur de l'onglet Échanges (signalement).
  const [composerDraft, setComposerDraft] = React.useState<ComposerDraft | null>(null);
  // Dépôt d'une pièce sur une exigence, et édition des réponses du formulaire.
  const [addingPiece, setAddingPiece] = React.useState<PieceRequirement | null>(null);
  const [addPieceError, setAddPieceError] = React.useState<string | null>(null);
  const [answersOpen, setAnswersOpen] = React.useState(false);
  const [answersError, setAnswersError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Le texte est conservé pendant le fondu de sortie (visible=false).
  const [toast, setToast] = React.useState<{ text: string; visible: boolean }>({ text: "", visible: false });
  const toastTimer = React.useRef<number | undefined>(undefined);
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  React.useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const flash = React.useCallback((text: string) => {
    setToast({ text, visible: true });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2800);
  }, []);

  /**
   * Une résolution PRÉVIENT l'usager (décision PO 2026-08-28) : l'avis part
   * juste après, composé par le serveur depuis l'état enregistré.
   *
   * ⚠️ L'envoi suit la transition, il ne la conditionne pas. La demande est
   * résolue quoi qu'il arrive ; un échec s'affiche comme tel, sans laisser
   * croire que la clôture a échoué. Le cas le plus courant — aucune adresse au
   * dossier — n'est pas une erreur : c'est un fait qu'on énonce.
   */
  const onTransitionDone = React.useCallback(
    (spec: TransitionSpec) => {
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
    [flash, id, sendClosure],
  );
  const runner = useTransitionRunner({
    requestId: id ?? "",
    assignedTo: r?.assigned_to ?? null,
    onDone: onTransitionDone,
  });

  if (!current) return null;
  if (request.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Chargement…</p>;
  }
  if (!r) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <p className="text-sm text-muted-foreground">Demande introuvable ou hors de votre périmètre.</p>
        <Link to="/demandes" className="text-sm text-primary hover:underline">← Retour aux demandes</Link>
      </div>
    );
  }

  // ---- Droits reflétés (l'autorité reste le RLS et la garde SQL) ---------------
  // Droits effectifs sur le COUPLE (organisation porteuse, démarche) de cette
  // demande — profils de droits (docs/droits.md), miroir de requests_guard_write.
  const rr: RequestRights = {
    rights: rightsFor(rights, r.socle_scope_org_id, r.socle_procedure_id),
    isAdmin: isAdminOn(rights, r.socle_scope_org_id),
  };
  const writer = canWriteWith(rr);
  const isAdmin = canAdminWith(rr);
  // Écrire à l'usager exige le droit d'INSTRUCTION — miroir de la garde de
  // `send-request-email` (request_right_for … 'instruction'), qui reste l'autorité.
  const canInstruct = canProcessWith(rr);
  const status = r.status as RequestStatus;
  const transitions = writer ? allowedTransitionsFor(status, rr) : [];

  const archived = status === "archivee";
  const memberList = members.data ?? [];
  const nameOf = (userId: string | null) => memberName(memberList, userId);
  // RM-16 : les DEUX sélecteurs d'affectation (rail + dialogue de transition)
  // ne proposent que les membres éligibles (instruction sur le couple de la
  // demande) — `memberList` reste complet pour l'affichage des noms (`nameOf`).
  const eligibleMembers: TenantMember[] = (eligibleAssignees.data ?? []).map((e) => {
    const known = memberList.find((m) => m.userId === e.user_id);
    return known ?? { userId: e.user_id, role: "agent", displayName: e.display_name || e.email, email: e.email };
  });

  // ---- Dérivés purs ---------------------------------------------------------------
  // Identité affichée = fiche Socle du jour si elle a pu être relue, dépôt sinon
  // (`view.changes` porte l'écart, `view.deposited` la pièce du dossier).
  const view = requesterView(r.requester_snapshot, r.identity_status, socleContact.data ?? null);
  const identity = view.identity;
  // Les champs d'adresse partent dans le bloc « Lieu d'intervention » : ils ne
  // sont pas répétés dans les informations saisies.
  const lieu = interventionLocation(r.procedure_snapshot, r.form_data);
  const lieuKeys = new Set(lieu?.keys ?? []);
  const answers = formAnswers(r.procedure_snapshot, r.form_data).filter((a) => !lieuKeys.has(a.key));
  const formVersion = formSchemaVersion(r.procedure_snapshot);
  const due = dueView(r.due_at, now);
  const subtitle = headerSubtitle({
    // Pendant la relecture, aucun nom plutôt que celui du dépôt : le voir
    // remplacé sous les yeux dans le titre de la page est exactement ce qu'on
    // vient de supprimer du bloc Usager.
    requesterName: socleContact.isLoading ? null : identity.name,
    channel: r.channel, source: r.source,
    receivedAt: r.received_at, dueAt: r.due_at,
  });
  const stages = buildStages({
    status, closureMotif: r.closure_motif, createdAt: r.created_at, events: events.data ?? [],
  });
  const attachmentList = attachments.data ?? [];
  // Exigences de pièces du formulaire, avec leur qualification — miroir de
  // `form_attachment_requirements` / `request_pieces_blocking` (migration
  // 20260828100000). L'autorité reste la garde SQL t17 : ici on explique.
  const requirements = pieceRequirements(r.procedure_snapshot, r.form_data, attachmentList);
  const piecesBlocking = blockingMessage(requirements);
  const canResume = readyToResume(requirements);
  // Le schéma FIGÉ de la demande — celui du dépôt, jamais la démarche du jour.
  const formSchema = formSchemaFrom(r.procedure_snapshot);
  // Un dossier clos ne se réécrit pas : l'écriture reste ouverte côté serveur
  // pour une correction a posteriori, l'UI ne la propose simplement pas.
  const editable = canInstruct && !archived && !isFinal(status);
  // Pièces ACTIVES, déclarées telles quelles au moteur de validation : les
  // conditions se rejouent exactement comme à l'écran.
  const activeDeclarations = attachmentList
    .filter((a) => !a.email_id && !a.superseded_by)
    .map((a) => ({
      form_field_key: a.form_field_key ?? "",
      file_name: a.file_name,
      storage_path: a.storage_path,
    }));
  /** Formats acceptés déclarés par la démarche pour l'exigence visée. */
  const acceptedFormatsFor = (requirement: PieceRequirement | null): string[] => {
    if (!requirement?.key || !formSchema) return [];
    const entry = flatFields(formSchema).find(
      (e) => e.field.type === "attachment" && dataKey(e.field) === requirement.key,
    );
    return entry && entry.field.type === "attachment" ? entry.field.acceptedFormats : [];
  };
  const { primary, secondary } = splitTransitions(status, transitions);
  /**
   * Miroir EXACT de la garde t17 : seule `en_instruction → resolue_positive`
   * est fermée par des pièces obligatoires non conformes. La mise en attente,
   * l'annulation et la résolution négative restent ouvertes — on refuse
   * souvent PARCE QU'une pièce manque.
   */
  const blockedBecauseOfPieces = (spec: TransitionSpec): string | null =>
    spec.to === "resolue_positive" && status === "en_instruction" ? piecesBlocking : null;
  const fallbackLabel = !writer ? null
    : archived ? "Demande archivée"
    : primary === null && secondary.length === 0 ? "Demande clôturée"
    : null;
  const activity = activityItems({
    events: events.data ?? [], notes: messages.data ?? [], nameOf, motifLabel,
  });
  const noteList = messages.data ?? [];
  const headerError = error ?? (runner.active ? null : runner.error);

  const tabs: { key: TabKey; label: string; count: number | null }[] = [
    { key: "resume", label: "Résumé", count: null },
    // Le compteur suit l'onglet : les pièces d'un e-mail sortant vivent sous
    // leur échange, pas dans « Pièces de la demande ».
    { key: "docs", label: "Documents", count: attachmentList.filter((a) => !a.email_id).length },
    { key: "echanges", label: "Échanges", count: null },
    { key: "notes", label: "Notes internes", count: noteList.length },
    { key: "activite", label: "Activité", count: null },
  ];

  // ---- Actions ---------------------------------------------------------------------
  async function guarded(action: () => Promise<unknown>, success: string) {
    setError(null);
    try {
      await action();
      flash(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action refusée.");
    }
  }

  async function openAttachment(a: RequestAttachment, download: boolean) {
    setError(null);
    const url = await createAttachmentUrl(a.storage_path, download ? a.file_name : undefined);
    if (!url) {
      setError("La pièce n'a pas pu être ouverte — URL signée refusée.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  async function submitQualification(input: QualificationSubmit) {
    if (!qualifying) return;
    setQualifyError(null);
    try {
      const result = await qualify.mutateAsync({
        attachmentId: qualifying.attachment.id,
        requestId: r!.id,
        compliance: input.compliance,
        motif: input.motif,
        note: input.note,
      });
      setQualifying(null);
      // La bascule en attente est décidée par le SERVEUR (elle est refusée par
      // la matrice depuis « À traiter ») : on annonce ce qui s'est passé, pas
      // ce qu'on espérait.
      flash(result.status_changed
        ? "Pièce non conforme — demande en attente d'information."
        : input.compliance === "conforme" ? "Pièce déclarée conforme." : "Pièce déclarée non conforme.");
    } catch (err) {
      setQualifyError(err instanceof Error ? err.message : "Qualification refusée.");
    }
  }

  /**
   * Le signalement n'est PAS envoyé d'ici : il dépose un brouillon dans le
   * composeur de l'onglet Échanges, que l'agent relit, amende et envoie
   * lui-même. Ce texte parle au nom de la collectivité — personne ne le fait
   * partir sans l'avoir lu.
   */
  function signalNonConformity() {
    setComposerDraft(buildNonConformityEmail({
      reference: r!.reference,
      subject: r!.subject,
      requirements,
      recipient: {
        civility: identity.civility,
        // Même règle que les variables de modèle : `identity.name` retombe sur
        // « Identité déclarée » quand rien n'est connu, et ce mot d'écran de
        // gestion ne doit jamais atteindre un usager.
        fullName: identity.known ? identity.name : null,
      },
      tenantName: current?.organizationName ?? "",
    }));
    setTab("echanges");
  }

  function resumeInstruction() {
    const spec = transitions.find((t) => t.to === "en_instruction");
    if (spec) runner.start(spec);
  }

  async function submitAddPiece(file: File) {
    if (!addingPiece) return;
    setAddPieceError(null);
    try {
      const result = await attachPiece.mutateAsync({
        requestId: r!.id,
        organizationId: r!.organization_id,
        file,
        formFieldKey: addingPiece.key,
        // Sans exigence à laquelle se rattacher (pièce hors formulaire), le
        // remplacement doit désigner sa cible nommément.
        replacesAttachmentId: addingPiece.key ? null : addingPiece.attachments[0]?.id ?? null,
      });
      setAddingPiece(null);
      flash(result.remplacees > 0
        ? `Pièce ajoutée — ${result.remplacees} pièce${result.remplacees > 1 ? "s" : ""} remplacée${result.remplacees > 1 ? "s" : ""}. À qualifier.`
        : "Pièce ajoutée. À qualifier.");
    } catch (err) {
      setAddPieceError(err instanceof Error ? err.message : "Dépôt refusé.");
    }
  }

  async function submitAnswers(formData: Record<string, unknown>, changed: string[]) {
    setAnswersError(null);
    try {
      await updateFormData.mutateAsync({ requestId: r!.id, formData });
      setAnswersOpen(false);
      flash(`${changed.length} réponse${changed.length > 1 ? "s" : ""} modifiée${changed.length > 1 ? "s" : ""}.`);
    } catch (err) {
      setAnswersError(err instanceof Error ? err.message : "Enregistrement refusé.");
    }
  }

  function copyReference() {
    setMenuOpen(false);
    void navigator.clipboard?.writeText(r!.reference).then(() => flash("Référence copiée"));
  }

  // ---- Vue ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3.5 px-5 pt-4">
        <nav aria-label="Fil d'Ariane" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Link to="/demandes" className="font-semibold text-primary hover:underline">Demandes</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/demandes?status=${status}`} className="font-semibold text-primary hover:underline">
            {STATUS_LABELS[status] ?? r.status}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="font-mono font-semibold text-foreground">{r.reference}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-[260px] flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[23px] font-bold leading-tight tracking-tight">{r.subject}</h1>
              <StatusBadge status={r.status} size="md" />
              {due ? (
                <span className={cn("inline-flex items-center rounded-full px-[11px] py-[5px] text-[11.5px] font-semibold", DUE_TONE[due.tone])}>
                  {due.label}
                </span>
              ) : null}
            </div>
            <p className="text-[13px] text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canInstruct || archived || !identity.email}
              title={
                !canInstruct ? "Exige le droit d'instruction sur cette demande"
                  : archived ? "Demande archivée"
                  : !identity.email ? "Aucune adresse de courriel dans l'identité déposée"
                  : undefined
              }
              onClick={() => setTab("echanges")}
            >
              <MessageSquare /> Écrire à l'usager
            </Button>
            {writer && primary ? (
              <Button
                type="button"
                size="sm"
                disabled={runner.pending || Boolean(blockedBecauseOfPieces(primary))}
                title={blockedBecauseOfPieces(primary) ?? undefined}
                onClick={() => runner.start(primary)}
              >
                {primary.label}
              </Button>
            ) : null}
            <Dropdown
              open={menuOpen}
              onOpenChange={setMenuOpen}
              trigger={(p) => (
                <Button type="button" variant="ghost" size="icon" aria-label="Autres actions" {...p}>
                  <MoreHorizontal />
                </Button>
              )}
            >
              {secondary.map((spec) => (
                <DropdownItem
                  key={spec.to + spec.label}
                  disabled={runner.pending || Boolean(blockedBecauseOfPieces(spec))}
                  className={spec.to === "annulee" ? "text-destructive" : undefined}
                  onClick={() => { setMenuOpen(false); runner.start(spec); }}
                >
                  {spec.label}
                </DropdownItem>
              ))}
              {secondary.length > 0 ? <DropdownDivider /> : null}
              <DropdownItem onClick={copyReference}>
                <Copy className="size-3.5 text-muted-foreground" aria-hidden="true" /> Copier la référence
              </DropdownItem>
            </Dropdown>
          </div>
        </div>

        {headerError ? (
          <p role="alert" className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
            {headerError}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-7 pt-[18px]">
        <div className="flex flex-wrap items-start gap-[18px]">
          <div className="flex min-w-0 flex-[1_1_540px] flex-col gap-4">
            <div role="tablist" aria-label="Sections de la fiche" className="flex gap-1 overflow-x-auto border-b border-border">
              {tabs.map((t) => {
                const on = t.key === tab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-controls={`pane-${t.key}`}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-[7px] whitespace-nowrap border-b-[2.5px] px-[13px] py-[9px] text-[13px] font-bold transition-colors",
                      on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span>{t.label}</span>
                    {t.count !== null && t.count > 0 ? (
                      <span className={cn(
                        "rounded-full px-[7px] py-0.5 text-[10.5px] font-bold",
                        on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}>
                        {t.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div id={`pane-${tab}`} role="tabpanel">
              {tab === "resume" ? (
                <ResumePane
                  request={r}
                  answers={answers}
                  formVersion={formVersion}
                  lieu={lieu}
                  links={links.data ?? []}
                  linkedSummaries={linkedSummaries.data ?? []}
                  onEditAnswers={
                    editable && formSchema && formSchema.content.length > 0
                      ? () => { setAnswersError(null); setAnswersOpen(true); }
                      : null
                  }
                />
              ) : null}
              {tab === "docs" ? (
                <DocumentsPane
                  attachments={attachmentList}
                  requirements={requirements}
                  canInstruct={canInstruct}
                  archived={archived}
                  waiting={status === "en_attente"}
                  readyToResume={canResume}
                  resuming={runner.pending}
                  onQualify={(attachment, label) => { setQualifyError(null); setQualifying({ attachment, label }); }}
                  onAddPiece={(requirement) => { setAddPieceError(null); setAddingPiece(requirement); }}
                  onSignal={signalNonConformity}
                  onResume={resumeInstruction}
                  onOpen={(a) => void openAttachment(a, false)}
                  onDownload={(a) => void openAttachment(a, true)}
                />
              ) : null}
              {tab === "echanges" ? (
                <EchangesPane
                  request={r}
                  identity={identity}
                  emails={emails.data ?? []}
                  attachments={attachmentList}
                  members={memberList}
                  events={events.data ?? []}
                  tenantName={current?.organizationName ?? ""}
                  canInstruct={canInstruct}
                  archived={archived}
                  sending={sendEmail.isPending}
                  draft={composerDraft}
                  onDraftApplied={() => setComposerDraft(null)}
                  onSend={(payload: SendEmailPayload) => sendEmail.mutateAsync({
                    requestId: r.id,
                    organizationId: r.organization_id,
                    subject: payload.subject,
                    body: payload.body,
                    files: payload.files,
                    templateId: payload.templateId,
                    templateName: payload.templateName,
                  }).then(() => { flash("Message envoyé à l'usager."); })}
                  onDownload={(a) => void openAttachment(a, true)}
                />
              ) : null}
              {tab === "notes" ? (
                <NotesPane
                  messages={noteList}
                  members={memberList}
                  mentionables={(mentionables.data ?? []).map((u) => ({
                    userId: u.user_id,
                    displayName: u.display_name,
                    email: u.email,
                    avatarPath: u.avatar_path,
                  }))}
                  canWrite={writer}
                  archived={archived}
                  currentUserId={session?.user.id ?? null}
                  isAdmin={isAdmin}
                  pending={addMessage.isPending}
                  onAdd={(body) => guarded(
                    () => addMessage.mutateAsync({
                      requestId: r!.id, organizationId: r!.organization_id,
                      authorId: session?.user.id ?? "", body,
                    }),
                    "Note interne enregistrée",
                  )}
                  onDelete={(messageId) => void guarded(
                    () => deleteMessage.mutateAsync({ messageId, requestId: r!.id }),
                    "Note supprimée",
                  )}
                />
              ) : null}
              {tab === "activite" ? <ActivityPane items={activity} /> : null}
            </div>
          </div>

          <div className="flex min-w-0 max-w-[372px] flex-[1_1_320px] flex-col gap-3.5">
            <PriseEnChargeCard
              priority={r.priority}
              assignedTo={r.assigned_to}
              serviceLabel={r.socle_organization_label}
              members={eligibleMembers}
              serviceOptions={orgCatalog.data ?? []}
              editable={canProcessWith(rr) && !archived}
              pending={updatePriority.isPending || assignRequest.isPending}
              onPriority={(priority) => void guarded(
                () => updatePriority.mutateAsync({ requestId: r!.id, priority }),
                `Urgence : ${priorityOption(priority).label.toLowerCase()}`,
              )}
              onAssign={(userId) => void guarded(
                () => assignRequest.mutateAsync({ requestId: r!.id, assigneeId: userId }),
                userId ? `Affectée à ${nameOf(userId)}` : "Demande désaffectée",
              )}
            />
            <AvancementCard
              reference={r.reference}
              stages={stages}
              primary={primary}
              fallbackLabel={fallbackLabel}
              blockedReason={primary ? blockedBecauseOfPieces(primary) : null}
              showAction={writer}
              pending={runner.pending}
              onPrimary={() => { if (primary) runner.start(primary); }}
            />
            <UsagerCard
              identity={identity}
              changes={view.changes}
              socleContactId={r.socle_contact_id}
              identityError={socleContact.isError}
              identityPending={socleContact.isLoading}
              otherRequests={otherRequests.data ?? []}
              otherLoading={otherRequests.isLoading}
              // Reflet du DROIT, pas de l'état de chargement : la carte pose le
              // bouton dès le départ et le désactive tant que la fiche manque.
              // `isLoading` reste faux pour une requête désactivée (sans droit)
              // comme pour un rafraîchissement après enregistrement : pas de
              // squelette au retour d'une modification.
              canEdit={canBrowseUsagers && Boolean(r.socle_contact_id)}
              onEdit={() => setUsagerEditOpen(true)}
            />
          </div>
        </div>
      </div>

      <TransitionDialog runner={runner} members={eligibleMembers} />

      {/* Qualification d'une pièce. L'écriture passe par la RPC
          `qualify_request_attachment` — `request_attachments` n'a aucune policy
          UPDATE cliente, et c'est le serveur qui met la demande en attente. */}
      <QualificationDialog
        attachment={qualifying?.attachment ?? null}
        requirementLabel={qualifying?.label ?? null}
        pending={qualify.isPending}
        error={qualifyError}
        onClose={() => { setQualifying(null); setQualifyError(null); }}
        onSubmit={(input) => void submitQualification(input)}
      />

      {/* Dépôt d'une pièce sur une exigence non conforme ou manquante. Le
          remplacement (« la plus récente fait foi ») est annoncé AVANT l'envoi. */}
      <AjouterPieceDialog
        requirement={addingPiece}
        acceptedFormats={acceptedFormatsFor(addingPiece)}
        pending={attachPiece.isPending}
        error={addPieceError}
        onClose={() => { setAddingPiece(null); setAddPieceError(null); }}
        onSubmit={(file) => void submitAddPiece(file)}
      />

      {/* Correction des RÉPONSES au formulaire figé de la demande. La
          définition de la démarche, elle, vit dans le Socle. */}
      <FormulaireEditDialog
        open={answersOpen}
        schema={formSchema}
        formData={r.form_data}
        attachments={activeDeclarations}
        pending={updateFormData.isPending}
        error={answersError}
        onClose={() => { setAnswersOpen(false); setAnswersError(null); }}
        onSubmit={(formData, changed) => void submitAnswers(formData, changed)}
      />

      {/* Correction de l'usager sans quitter la demande : l'écriture va au
          SOCLE (socle-proxy → contacts-api), la fiche est ensuite relue.
          Le `requester_snapshot` de la demande, lui, ne bouge pas. */}
      {socleContact.data ? (
        <UsagerEditDialog
          open={usagerEditOpen}
          onOpenChange={setUsagerEditOpen}
          organizationId={orgId}
          contact={socleContact.data}
          onSaved={flash}
        />
      ) : null}

      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-4 py-[11px] shadow-airbnb-xl transition-all duration-200",
          toast.visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
      >
        <Check className="size-4 text-primary" aria-hidden="true" />
        <span className="text-[13px] font-semibold">{toast.text}</span>
      </div>
    </div>
  );
}
