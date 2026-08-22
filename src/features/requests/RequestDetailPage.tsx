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
import { isAdminOn, rightsFor } from "@/features/rights/rights";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { TransitionDialog, useTransitionRunner } from "./TransitionActions";
import {
  allowedTransitionsFor, canAdminWith, canProcessWith, canWriteWith, STATUS_LABELS,
  type RequestRights, type RequestStatus, type TransitionSpec,
} from "./statuts";
import {
  createAttachmentUrl, useAddMessage, useAssignRequest, useDeleteMessage, useEligibleAssignees,
  useRequest, useRequestAttachments, useRequestEvents, useRequestLinks, useRequestMessages,
  useRequestSummaries, useRequesterRequests, useTenantMembers, useUpdatePriority,
  type RequestAttachment, type TenantMember,
} from "./useRequests";
import { ActivityPane } from "./instruction/ActivityPane";
import { DocumentsPane } from "./instruction/DocumentsPane";
import { EchangesPane } from "./instruction/EchangesPane";
import { NotesPane } from "./instruction/NotesPane";
import { ResumePane } from "./instruction/ResumePane";
import { AvancementCard, PriseEnChargeCard, UsagerCard } from "./instruction/InstructionRail";
import { SOON } from "@/components/ui/surface";
import {
  activityItems, attachmentFieldLabels, buildStages, dueView, formAnswers, formSchemaVersion,
  headerSubtitle, memberName, priorityOption, requesterIdentity, splitTransitions,
} from "./instruction/instruction";

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
  const links = useRequestLinks(id);
  const members = useTenantMembers(orgId);
  const eligibleAssignees = useEligibleAssignees(id);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const r = request.data ?? null;
  const linkTargets = React.useMemo(
    () => (links.data ?? []).map((l) => l.target_request_id).filter((x): x is string => Boolean(x)),
    [links.data],
  );
  const linkedSummaries = useRequestSummaries(linkTargets);
  const otherRequests = useRequesterRequests(orgId, r?.socle_contact_id ?? null, id ?? "");

  const assignRequest = useAssignRequest();
  const updatePriority = useUpdatePriority();
  const addMessage = useAddMessage();
  const deleteMessage = useDeleteMessage();

  const [tab, setTab] = React.useState<TabKey>("resume");
  const [menuOpen, setMenuOpen] = React.useState(false);
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

  const onTransitionDone = React.useCallback(
    (spec: TransitionSpec) => flash(`Statut : ${STATUS_LABELS[spec.to]}`),
    [flash],
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
  const identity = requesterIdentity(r.requester_snapshot, r.identity_status);
  const answers = formAnswers(r.procedure_snapshot, r.form_data);
  const formVersion = formSchemaVersion(r.procedure_snapshot);
  const fieldLabels = attachmentFieldLabels(r.procedure_snapshot);
  const due = dueView(r.due_at, now);
  const subtitle = headerSubtitle({
    requesterName: identity.name, channel: r.channel, source: r.source,
    receivedAt: r.received_at, dueAt: r.due_at,
  });
  const stages = buildStages({
    status, closureMotif: r.closure_motif, createdAt: r.created_at, events: events.data ?? [],
  });
  const { primary, secondary } = splitTransitions(status, transitions);
  const fallbackLabel = !writer ? null
    : archived ? "Demande archivée"
    : primary === null && secondary.length === 0 ? "Demande clôturée"
    : null;
  const activity = activityItems({ events: events.data ?? [], notes: messages.data ?? [], nameOf });
  const attachmentList = attachments.data ?? [];
  const noteList = messages.data ?? [];
  const headerError = error ?? (runner.active ? null : runner.error);

  const tabs: { key: TabKey; label: string; count: number | null }[] = [
    { key: "resume", label: "Résumé", count: null },
    { key: "docs", label: "Documents", count: attachmentList.length },
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
            <Button type="button" variant="outline" size="sm" {...SOON}>
              <MessageSquare /> Écrire à l'usager
            </Button>
            {writer && primary ? (
              <Button type="button" size="sm" disabled={runner.pending} onClick={() => runner.start(primary)}>
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
                  disabled={runner.pending}
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
                  links={links.data ?? []}
                  linkedSummaries={linkedSummaries.data ?? []}
                />
              ) : null}
              {tab === "docs" ? (
                <DocumentsPane
                  attachments={attachmentList}
                  fieldLabels={fieldLabels}
                  onOpen={(a) => void openAttachment(a, false)}
                  onDownload={(a) => void openAttachment(a, true)}
                />
              ) : null}
              {tab === "echanges" ? <EchangesPane identity={identity} /> : null}
              {tab === "notes" ? (
                <NotesPane
                  messages={noteList}
                  members={memberList}
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
              showAction={writer}
              pending={runner.pending}
              onPrimary={() => { if (primary) runner.start(primary); }}
            />
            <UsagerCard
              identity={identity}
              socleContactId={r.socle_contact_id}
              otherRequests={otherRequests.data ?? []}
              otherLoading={otherRequests.isLoading}
            />
          </div>
        </div>
      </div>

      <TransitionDialog runner={runner} members={eligibleMembers} />

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
