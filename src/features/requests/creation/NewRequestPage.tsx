// Parcours de création d'une demande — piloté EXCLUSIVEMENT par une démarche
// Socle active du tenant (règle non négociable : aucune demande libre).
// Quatre étapes (démarche → usager → formulaire → récapitulatif) puis création
// via l'edge function create-request-from-procedure (revalidation + écriture
// atomique côté serveur — le navigateur ne fournit jamais de snapshot).
// Autour : brouillon local continu, détection best-effort des demandes proches
// avec liaison explicite, récépissé imprimable. La base de connaissances
// (onglet « Procédure » du rail) viendra dans un second temps.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFullBleedLayout } from "@/components/layout/shellLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import {
  fetchProcedureSnapshot,
  useSocleOrganizationsCatalog,
  useSocleProcedureRows,
  type ProcedureSnapshot,
} from "@/features/socle/useSocleCatalog";
import { RequesterIdentification } from "@/features/contacts/RequesterIdentification";
import { useGetContact } from "@/features/contacts/useContacts";
import type { RequesterResolution } from "@/features/contacts/rapprochement";
import type { EdgeError } from "@/lib/edge";
import { cn } from "@/lib/utils";
import {
  dataKey,
  flatFields,
  parseFormSchema,
  validateFormSubmission,
  validateRequesterSubmission,
  type FormValues,
  type RequesterSubmission,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import { PRIORITY_LABELS, STATUS_LABELS } from "../statuts";
import { useLinkRequests } from "../useRequests";
import { CreationRail, type FicheLine, type NearbyState } from "./CreationRail";
import { CreationStepper, type StepDef } from "./CreationStepper";
import { ProcedureFormFields } from "./ProcedureFormFields";
import { ProcedurePicker } from "./ProcedurePicker";
import { PrintReceipt, RequestCreated, type ReceiptData } from "./RequestCreated";
import { RequestSummary } from "./RequestSummary";
import {
  draftDateLabel,
  draftRequesterFromResolution,
  savedAgoLabel,
  type CreationDraft,
} from "./draft";
import {
  activeFields,
  attachmentStats,
  creationProgress,
  fileCountsFrom,
  missingRequiredFields,
} from "./fiche";
import {
  displayFieldValue,
  requesterRows,
  requesterShortName,
  type CreationStep,
  type LinkedRequests,
  type LoadedProcedure,
} from "./model";
import { scoreNearbyRequests, type NearbyScored } from "./proches";
import { useCreateFromProcedure } from "./useCreateFromProcedure";
import {
  nearbyBasisFromResolution,
  useNearbyRequests,
  useProcedureMonthlyCounts,
} from "./useCreationData";
import { useCreationDraft, type DraftBody } from "./useCreationDraft";

/** 5 = confirmation de création (hors stepper). */
type PageStep = CreationStep | 5;

function toSubmission(resolution: RequesterResolution): RequesterSubmission {
  if (resolution.kind === "contact") {
    return { kind: "contact", audience: resolution.audience, socle_contact_id: resolution.contact.id };
  }
  if (resolution.kind === "sans_rapprochement") {
    return { kind: "sans_rapprochement", audience: resolution.audience, declared: resolution.declared };
  }
  return { kind: "anonyme" };
}

export function NewRequestPage() {
  useFullBleedLayout();
  const { current } = useTenant();
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const orgId = current?.organizationId ?? "";
  const userId = session?.user.id ?? "";

  const procRows = useSocleProcedureRows(orgId);
  const monthlyCounts = useProcedureMonthlyCounts(orgId);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const create = useCreateFromProcedure();
  const linkRequests = useLinkRequests();
  const getContact = useGetContact();
  const draft = useCreationDraft(orgId, userId);

  const [step, setStep] = React.useState<PageStep>(1);
  const [maxReached, setMaxReached] = React.useState(1);
  const [procedureId, setProcedureId] = React.useState("");
  const [procedure, setProcedure] = React.useState<LoadedProcedure | null>(null);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [destinationId, setDestinationId] = React.useState("");
  const [resolution, setResolution] = React.useState<RequesterResolution | null>(null);
  const [subject, setSubject] = React.useState("");
  const [bodyText, setBodyText] = React.useState("");
  const [priority, setPriority] = React.useState("normale");
  const [values, setValues] = React.useState<FormValues>({});
  const [files, setFiles] = React.useState<Record<string, File[]>>({});
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [linked, setLinked] = React.useState<LinkedRequests>({});
  const [dupDismissed, setDupDismissed] = React.useState(false);
  const [created, setCreated] = React.useState<{ id: string; reference: string; at: Date } | null>(null);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  // Le texte est conservé pendant le fondu de sortie (visible=false) pour que
  // la bulle ne se vide pas avant de disparaître.
  const [toast, setToast] = React.useState<{ text: string; visible: boolean }>({ text: "", visible: false });
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const [resuming, setResuming] = React.useState(false);
  const [now, setNow] = React.useState(() => new Date());
  const draftIdRef = React.useRef<string>(crypto.randomUUID());
  const toastTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 5000);
    return () => window.clearInterval(id);
  }, []);
  React.useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const flash = React.useCallback((text: string) => {
    setToast({ text, visible: true });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2800);
  }, []);

  // ---- Dérivés ---------------------------------------------------------------
  const agentName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
    : (session?.user.email ?? "l'agent");
  const schema = procedure?.schema ?? null;
  const categoryLabel = (procRows.data ?? []).find((r) => r.socle_id === procedureId)?.category_name ?? null;
  const destinationLabel = (orgCatalog.data ?? []).find((o) => o.value === destinationId)?.label ?? null;
  const fileCounts = fileCountsFrom(files);
  const activeCount = activeFields(schema, values).length;
  const missing = missingRequiredFields(schema, values, fileCounts).length
    + (procedure && subject.trim() === "" ? 1 : 0);
  const pieces = attachmentStats(schema, values, fileCounts);
  const progress = creationProgress({
    hasProcedure: Boolean(procedure), hasRequester: Boolean(resolution),
    subjectFilled: subject.trim() !== "", schema, values, fileCounts,
  });
  const linkedCount = Object.keys(linked).length;

  const nearbyBasis = React.useMemo(() => nearbyBasisFromResolution(resolution), [resolution]);
  const nearby = useNearbyRequests(orgId, nearbyBasis);
  const nearbyScored = React.useMemo<NearbyScored[]>(
    () => nearbyBasis && nearby.data
      ? scoreNearbyRequests(nearby.data, { basis: nearbyBasis.kind, procedureId, now: new Date() })
      : [],
    [nearby.data, nearbyBasis, procedureId],
  );
  const nearbyState: NearbyState = !nearbyBasis ? "idle"
    : nearby.isLoading ? "loading"
    : nearby.isError ? "error"
    : "ready";
  const duplicates = nearbyScored.filter((i) => i.likelyDuplicate);

  // ---- Brouillon local (différé à chaque saisie) -----------------------------
  const draftBody: DraftBody | null = procedureId !== "" && step !== 5
    ? {
        draftId: draftIdRef.current,
        step,
        procedureId,
        destinationId,
        requester: draftRequesterFromResolution(resolution),
        subject,
        body: bodyText,
        priority,
        values,
        linked: Object.entries(linked).map(([id, reference]) => ({ id, reference })),
        dupDismissed,
      }
    : null;
  const draftSignature = draftBody ? JSON.stringify(draftBody) : "";
  const scheduleSave = draft.scheduleSave;
  React.useEffect(() => {
    if (draftSignature === "") return;
    scheduleSave(JSON.parse(draftSignature) as DraftBody);
  }, [draftSignature, scheduleSave]);

  if (!current) return null;

  // ---- Actions -----------------------------------------------------------------
  const setValue = (fieldId: string, value: unknown) =>
    setValues((v) => ({ ...v, [fieldId]: value }));
  const setFieldFiles = (fieldId: string, next: File[]) =>
    setFiles((f) => ({ ...f, [fieldId]: next }));

  function goTo(n: CreationStep) {
    setStep(n);
    setMaxReached((m) => Math.max(m, n));
    setError(null);
  }

  function applyProcedure(id: string, snapshot: ProcedureSnapshot, resetForm: boolean) {
    const parsed = parseFormSchema(snapshot.form_schema);
    setProcedureId(id);
    setProcedure({ snapshot, schema: parsed });
    if (resetForm) {
      setValues({});
      setFiles({});
      setFieldErrors({});
      setDupDismissed(false);
      setMaxReached((m) => Math.min(m, 2));
    }
    setSubject((s) => (resetForm || s.trim() === "" ? snapshot.name : s));
    // Destinataire pré-rempli quand la démarche désigne une organisation du miroir.
    if (snapshot.organization_id
        && (orgCatalog.data ?? []).some((o) => o.value === snapshot.organization_id)) {
      setDestinationId((d) => (resetForm || d === "" ? snapshot.organization_id! : d));
    }
    // Le demandeur déjà désigné doit rester admissible par la nouvelle démarche
    // (publics activés, anonymat) — sinon il est à désigner de nouveau.
    setResolution((r) => (r && validateRequesterSubmission(snapshot.requester_config, toSubmission(r)).ok ? r : null));
  }

  async function selectProcedure(id: string) {
    setError(null);
    setLoadingId(id);
    try {
      const snapshot = await fetchProcedureSnapshot(orgId, id);
      if (!snapshot) {
        setError("La démarche n'a pas pu être chargée depuis le Socle — réessayez dans un instant.");
        return;
      }
      applyProcedure(id, snapshot, id !== procedureId);
      draft.dismissExisting();
      goTo(2);
    } finally {
      setLoadingId(null);
    }
  }

  async function resumeDraft(d: CreationDraft) {
    setResuming(true);
    setError(null);
    try {
      const snapshot = await fetchProcedureSnapshot(orgId, d.procedureId);
      if (!snapshot) {
        setError("Le brouillon ne peut pas être repris : la démarche n'a pas pu être rechargée depuis le Socle.");
        return;
      }
      draftIdRef.current = d.draftId;
      const parsed = parseFormSchema(snapshot.form_schema);
      setProcedureId(d.procedureId);
      setProcedure({ snapshot, schema: parsed });
      setDestinationId(d.destinationId);
      setSubject(d.subject.trim() === "" ? snapshot.name : d.subject);
      setBodyText(d.body);
      setPriority(d.priority);
      setValues(d.values);
      setFiles({});
      setFieldErrors({});
      setLinked(Object.fromEntries(d.linked.map((l) => [l.id, l.reference])));
      setDupDismissed(d.dupDismissed);

      // L'usager rapproché est RELU depuis le Socle : le brouillon n'en garde que l'id.
      let res: RequesterResolution | null = null;
      if (d.requester?.kind === "contact") {
        try {
          const contact = await getContact.mutateAsync({
            organizationId: orgId, socleContactId: d.requester.socleContactId,
          });
          res = { kind: "contact", audience: d.requester.audience, contact };
        } catch {
          flash("L'usager du brouillon n'a pas pu être relu depuis le Socle — à désigner de nouveau.");
        }
      } else if (d.requester?.kind === "sans_rapprochement") {
        res = { kind: "sans_rapprochement", audience: d.requester.audience, declared: d.requester.declared };
      } else if (d.requester?.kind === "anonyme") {
        res = { kind: "anonyme" };
      }
      if (res && !validateRequesterSubmission(snapshot.requester_config, toSubmission(res)).ok) res = null;
      setResolution(res);

      // Les pièces ne sont pas persistées : on repasse au plus tard par le formulaire.
      const target: CreationStep = !res ? 2 : (Math.max(2, Math.min(d.step, 3)) as CreationStep);
      setMaxReached(target);
      setStep(target);
      draft.dismissExisting();
      const hasAttachments = flatFields(parsed).some((e) => e.field.type === "attachment");
      if (res) {
        flash(hasAttachments
          ? "Brouillon repris — les pièces jointes sont à déposer de nouveau"
          : "Brouillon repris");
      }
    } finally {
      setResuming(false);
    }
  }

  /** Déclarations de pièces pour la validation de confort (chemins fictifs). */
  function draftAttachmentDeclarations(loaded: LoadedProcedure) {
    const out = [];
    for (const entry of flatFields(loaded.schema)) {
      if (entry.field.type !== "attachment") continue;
      for (const file of files[entry.field.id] ?? []) {
        out.push({
          form_field_key: dataKey(entry.field),
          file_name: file.name,
          storage_path: `${orgId}/${draftIdRef.current}/${file.name}`,
        });
      }
    }
    return out;
  }

  function nextFromForm() {
    if (!procedure) return;
    setError(null);
    const errors: Record<string, string> = {};
    if (subject.trim() === "") errors["_subject"] = "L'objet de la demande est obligatoire.";
    const result = validateFormSubmission(procedure.schema, values, draftAttachmentDeclarations(procedure));
    Object.assign(errors, result.errors);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("Corrigez les champs signalés avant de poursuivre.");
      return;
    }
    goTo(4);
  }

  function next() {
    if (step === 1 && procedure) goTo(2);
    else if (step === 2 && resolution) goTo(3);
    else if (step === 3) nextFromForm();
  }

  function back() {
    if (step > 1 && step < 5) {
      setStep((step - 1) as CreationStep);
      setError(null);
    }
  }

  function onResolve(r: RequesterResolution | null) {
    setResolution(r);
    setLinked({});
    setDupDismissed(false);
    if (r) goTo(3);
  }

  function toggleLink(id: string, reference: string) {
    setLinked((l) => {
      const nextLinks = { ...l };
      if (nextLinks[id]) delete nextLinks[id];
      else nextLinks[id] = reference;
      return nextLinks;
    });
  }

  async function submit(printAfter: boolean) {
    if (!procedure || !resolution) return;
    setError(null);
    setLinkError(null);
    try {
      const result = await create.mutateAsync({
        organizationId: orgId,
        draftRequestId: draftIdRef.current,
        procedureId,
        subject,
        body: bodyText,
        priority,
        destinationId: destinationId === "" ? null : destinationId,
        requester: toSubmission(resolution),
        schema: procedure.schema,
        values,
        files,
      });
      setCreated({ id: result.id, reference: result.reference, at: new Date() });
      draft.clear();
      setStep(5);
      const targetIds = Object.keys(linked);
      if (targetIds.length > 0) {
        try {
          await linkRequests.mutateAsync({ organizationId: orgId, requestId: result.id, targetIds, userId });
        } catch (err) {
          setLinkError(err instanceof Error ? err.message : "liaison refusée");
        }
      }
      flash(printAfter
        ? `Demande ${result.reference} créée — récépissé envoyé à l'impression`
        : `Demande ${result.reference} créée — ${STATUS_LABELS.a_traiter.toLowerCase()}`);
      if (printAfter) window.setTimeout(() => window.print(), 400);
    } catch (err) {
      const edge = err as EdgeError;
      if (edge.fields) {
        setFieldErrors(edge.fields);
        setStep(3);
      }
      if (edge.code === "conflict") {
        draftIdRef.current = crypto.randomUUID();
      }
      setError(edge.message ?? "Erreur lors de la création.");
    }
  }

  function restart() {
    draftIdRef.current = crypto.randomUUID();
    setStep(1);
    setMaxReached(1);
    setProcedureId("");
    setProcedure(null);
    setDestinationId("");
    setResolution(null);
    setSubject("");
    setBodyText("");
    setPriority("normale");
    setValues({});
    setFiles({});
    setFieldErrors({});
    setError(null);
    setLinked({});
    setDupDismissed(false);
    setCreated(null);
    setLinkError(null);
  }

  function requestClose() {
    if (procedureId === "" || step === 5) {
      navigate("/demandes");
      return;
    }
    setLeaveOpen(true);
  }
  function leaveKeepingDraft() {
    if (draftBody) draft.saveNow(draftBody);
    navigate("/demandes");
  }
  function leaveDiscarding() {
    draft.clear();
    navigate("/demandes");
  }

  // ---- Vue ---------------------------------------------------------------------
  const requesterName = requesterShortName(resolution);
  const steps: StepDef[] = [
    { num: 1, label: "Démarche", hint: procedure ? procedure.snapshot.name : "à choisir" },
    { num: 2, label: "Usager", hint: requesterName ?? "recherche & homonymes" },
    {
      num: 3, label: "Formulaire",
      hint: procedure ? `${activeCount} champ${activeCount > 1 ? "s" : ""} actif${activeCount > 1 ? "s" : ""}` : "paramétré par le service",
    },
    { num: 4, label: "Récapitulatif", hint: "doublons & liens" },
  ];

  const lines: FicheLine[] = [
    { key: "Démarche", value: procedure?.snapshot.name ?? "à choisir", ok: Boolean(procedure) },
    { key: "Usager", value: requesterName ?? "à désigner", ok: Boolean(resolution) },
    {
      key: "Champs obligatoires",
      value: procedure ? (missing === 0 ? "tous renseignés" : `${missing} manquant${missing > 1 ? "s" : ""}`) : "—",
      ok: Boolean(procedure) && missing === 0,
    },
    {
      key: "Pièces jointes",
      value: procedure ? (pieces.total === 0 ? "aucune attendue" : `${pieces.provided} sur ${pieces.total}`) : "—",
      ok: Boolean(procedure) && (pieces.total === 0 || pieces.provided === pieces.total),
    },
    { key: "Organisation destinataire", value: destinationLabel ?? "à affecter", ok: Boolean(destinationLabel) },
    { key: "Demandes liées", value: linkedCount > 0 ? Object.values(linked).join(", ") : "aucune", ok: linkedCount > 0 },
    { key: "Statut à la création", value: STATUS_LABELS.a_traiter, ok: true },
  ];

  const nextDisabled = step === 1 ? !procedure || loadingId !== null
    : step === 2 ? !resolution
    : false;
  const nextLabel = step === 1 ? "Continuer vers l'usager"
    : step === 2 ? "Continuer vers le formulaire"
    : "Voir le récapitulatif";
  const footHint = step === 1 ? "Choisissez la démarche Socle qui fonde la demande"
    : step === 2 ? "Renseignez l'usager : ses homonymes du Socle sont proposés automatiquement"
    : step === 3 ? (missing === 0 ? "Tous les champs obligatoires sont renseignés" : `${missing} champ${missing > 1 ? "s" : ""} obligatoire${missing > 1 ? "s" : ""} restant${missing > 1 ? "s" : ""}`)
    : "Vérifiez le récapitulatif avant création";

  const existingDraft = draft.existing;
  const existingDraftName = existingDraft
    ? (procRows.data ?? []).find((r) => r.socle_id === existingDraft.procedureId)?.name ?? null
    : null;

  const receipt: ReceiptData | null = created && procedure && resolution
    ? {
        tenantName: current.organizationName,
        reference: created.reference,
        createdAt: created.at,
        procedureName: procedure.snapshot.name,
        categoryLabel,
        destinationLabel,
        requesterRows: requesterRows(resolution).filter((r) => !r.mono).map((r) => ({ label: r.label, value: r.value })),
        subject,
        answers: activeFields(schema, values)
          .filter((e) => e.field.type !== "attachment")
          .map((e) => ({ label: e.field.label, value: displayFieldValue(e.field, values[e.field.id]) }))
          .filter((a) => a.value !== ""),
        attachments: activeFields(schema, values)
          .filter((e) => e.field.type === "attachment")
          .flatMap((e) => (files[e.field.id] ?? []).map((f) => ({ label: e.field.label, name: f.name }))),
        agentName,
        linkedReferences: Object.values(linked),
      }
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">Nouvelle demande</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Consignée pour le compte d'un usager — brouillon enregistré en continu sur ce poste
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-semibold",
                draft.savedAt ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", draft.savedAt ? "bg-primary" : "bg-border")} aria-hidden="true" />
              {savedAgoLabel(draft.savedAt, now)}
            </span>
            <Button type="button" variant="ghost" size="icon" aria-label="Quitter la saisie" onClick={requestClose}>
              <X />
            </Button>
          </div>
        </div>
        <div className="mt-4 border-b border-border pb-3.5">
          <CreationStepper
            steps={steps}
            current={step}
            maxReached={created ? 0 : maxReached}
            onGo={(n) => { setStep(n); setError(null); }}
          />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto px-6 pb-6 pt-5">
          {error && step !== 5 ? (
            <div role="alert" className="mb-4 max-w-[860px] rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-4">
              {existingDraft ? (
                <div className="flex max-w-[820px] flex-wrap items-center justify-between gap-3 rounded-[14px] border border-primary/30 bg-primary/[0.04] px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold">Un brouillon est en attente sur ce poste</span>
                    <span className="text-xs text-muted-foreground">
                      Enregistré le {draftDateLabel(existingDraft.savedAt)} — {existingDraftName ?? "démarche à recharger"},
                      étape {existingDraft.step} sur 4.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" disabled={resuming} onClick={() => draft.clear()}>
                      Abandonner
                    </Button>
                    <Button type="button" size="sm" disabled={resuming} onClick={() => void resumeDraft(existingDraft)}>
                      {resuming ? "Reprise…" : "Reprendre le brouillon"}
                    </Button>
                  </div>
                </div>
              ) : null}
              <ProcedurePicker
                rows={procRows.data ?? []}
                loading={procRows.isLoading}
                counts={monthlyCounts.data}
                selectedId={procedureId}
                loadingId={loadingId}
                onSelect={(id) => void selectProcedure(id)}
              />
            </div>
          ) : null}

          {step === 2 && procedure ? (
            <RequesterIdentification
              organizationId={orgId}
              requesterConfig={procedure.snapshot.requester_config}
              resolution={resolution}
              onResolve={onResolve}
            />
          ) : null}

          {step === 3 && procedure ? (
            <div className="flex max-w-[860px] flex-col gap-[18px]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{procedure.snapshot.name}</h3>
                  <small className="text-xs text-muted-foreground">
                    Formulaire paramétré par le service · {activeCount} champ{activeCount > 1 ? "s" : ""} actif{activeCount > 1 ? "s" : ""}
                  </small>
                </div>
                {categoryLabel ? <Badge variant="outline" className="h-[26px]">{categoryLabel}</Badge> : null}
              </div>

              <section className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4 shadow-airbnb-sm">
                <h4 className="text-sm font-bold">Informations de la demande</h4>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Field label="Objet" htmlFor="nw-subject" required error={fieldErrors["_subject"]}>
                      <Input id="nw-subject" value={subject} maxLength={500}
                        onChange={(e) => setSubject(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Priorité" htmlFor="nw-priority">
                    <Select id="nw-priority" className="h-11 px-4" value={priority}
                      onChange={(e) => setPriority(e.target.value)}>
                      {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="Description" htmlFor="nw-body"
                      hint="Contexte utile à l'instruction, visible dans la fiche de la demande (ce n'est pas une note interne).">
                      <Textarea id="nw-body" value={bodyText}
                        onChange={(e) => setBodyText(e.target.value)} />
                    </Field>
                  </div>
                </div>
              </section>

              <ProcedureFormFields schema={procedure.schema} values={values} onChange={setValue}
                files={files} onFilesChange={setFieldFiles} errors={fieldErrors} />
              {fieldErrors["_attachments"] ? (
                <p className="text-sm text-destructive">{fieldErrors["_attachments"]}</p>
              ) : null}
            </div>
          ) : null}

          {step === 4 && procedure && resolution ? (
            <RequestSummary
              procedure={procedure}
              categoryLabel={categoryLabel}
              destination={{ value: destinationId, options: orgCatalog.data ?? [], onChange: setDestinationId }}
              channelLabel={`Guichet — consignée par ${agentName}`}
              priority={priority}
              subject={subject}
              body={bodyText}
              resolution={resolution}
              values={values}
              files={files}
              duplicates={duplicates}
              dupDismissed={dupDismissed}
              onDismissDup={() => setDupDismissed(true)}
              linked={linked}
              onToggleLink={toggleLink}
              onEdit={(n) => { setStep(n); setError(null); }}
              now={now}
            />
          ) : null}

          {step === 5 && created && procedure ? (
            <RequestCreated
              requestId={created.id}
              reference={created.reference}
              procedureName={procedure.snapshot.name}
              requesterLabel={requesterName ?? "demandeur"}
              linkedReferences={Object.values(linked)}
              linkError={linkError}
              onPrint={() => window.print()}
              onRestart={restart}
            />
          ) : null}
        </div>

        <CreationRail
          reference={created?.reference ?? null}
          progress={created ? 100 : progress}
          lines={lines}
          nearby={{ state: nearbyState, items: nearbyScored }}
          linked={linked}
          onToggleLink={toggleLink}
          now={now}
        />

        <div
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-airbnb-xl transition-all duration-200",
            toast.visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
          )}
        >
          <Check className="size-4 text-primary" aria-hidden="true" />
          <span className="text-[13px] font-semibold">{toast.visible ? toast.text : ""}</span>
        </div>
      </div>

      {step !== 5 ? (
        <div className="flex shrink-0 items-center gap-2.5 border-t border-border bg-card px-6 py-3">
          <Button type="button" variant="ghost" onClick={back}
            disabled={step === 1 || create.isPending} className={cn(step === 1 && "invisible")}>
            <ArrowLeft />
            Retour
          </Button>
          <div className="flex-1 text-xs text-muted-foreground">{footHint}</div>
          <Button type="button" variant="outline" onClick={leaveKeepingDraft}
            disabled={procedureId === "" || create.isPending}>
            Reprendre plus tard
          </Button>
          {step < 4 ? (
            <Button type="button" onClick={next} disabled={nextDisabled}>
              {nextLabel}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={create.isPending} onClick={() => void submit(true)}>
                Créer et imprimer
              </Button>
              <Button type="button" disabled={create.isPending} onClick={() => void submit(false)}>
                <Check />
                {create.isPending ? "Création…" : "Créer la demande"}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {receipt ? <PrintReceipt data={receipt} /> : null}

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quitter la saisie ?</DialogTitle>
            <DialogDescription>
              Le brouillon peut être conservé sur ce poste et repris plus tard depuis « Nouvelle
              demande ». Les pièces jointes seront à déposer de nouveau.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="ghost" onClick={() => setLeaveOpen(false)}>Continuer la saisie</Button>
            <Button type="button" variant="outline" onClick={leaveDiscarding}>Abandonner le brouillon</Button>
            <Button type="button" onClick={leaveKeepingDraft}>Conserver et quitter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
