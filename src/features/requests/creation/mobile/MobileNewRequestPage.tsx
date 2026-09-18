// Création d'une demande — page MOBILE « une page » (`/demandes/nouvelle`),
// maquette « Iris mobile — v2 » écran 6 : la même machine à états que le
// parcours de bureau (`NewRequestPage.tsx`), réduite à une page défilante SANS
// stepper, SANS rail, SANS récépissé imprimable, SANS usager imposé
// (`?usager=`) et SANS demandes liées — des usages de bureau que le pouce ne
// réclame pas. Toute la logique de fond (démarche Socle active, organisme
// d'abord, brouillon local, demandes proches, revalidation serveur) est
// réutilisée telle quelle depuis `creation/` : cette page ne fait que la
// mettre en scène différemment.
//
// ⚠️ Le bloc PHOTO n'est pas la première chose codée : il vise le premier
// champ pièce de la démarche CHOISIE (`mobileCreation.photoBlockState`), donc
// il n'existe qu'une fois une démarche chargée. La maquette le place en tête
// visuelle — c'est fait ici en le rendant AVANT la section Démarche dans le
// JSX dès qu'il existe, jamais en écrivant dans le formulaire avant de savoir
// où. La numérotation des sections (`sectionNumbers`) suit ce même choix.
//
// « M'affecter cette demande » et le bloc photo partagent l'état `files` avec
// `ProcedureFormFields`, qui rend aussi ce même champ pièce plus bas dans les
// Précisions : un seul état, deux entrées (raccourci photo + formulaire
// complet), comme demandé — pas une redondance, un accès rapide en plus.

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Camera, Check, TriangleAlert, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MobileChip, MobileFooter, MobileHeader, MobileNotice, MobileSheet,
} from "@/components/layout/mobile/MobilePage";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { creatableProcedures, creationOrganizationIds, rightsFor } from "@/features/rights/rights";
import {
  fetchProcedureSnapshot,
  useSocleOrganizationsCatalog,
  useSocleProcedureActivations,
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
import { CameraCaptureDialog, prefersNativeCapture, supportsInAppCamera } from "../../interventions/CameraCapture";
import { PRIORITY_LABELS } from "../../statuts";
import { useAssignRequest } from "../../useRequests";
import { draftRequesterFromResolution, type CreationDraft } from "../draft";
import { destinationMissing, fileCountsFrom, missingRequiredFields } from "../fiche";
import { requesterShortName, type LoadedProcedure } from "../model";
import { needsOrganizationChoice, organizationChoices, soleOrganization } from "../organismes";
import { scoreNearbyRequests, type NearbyScored } from "../proches";
import { activationsByOrganisation, creatableByOrganisation } from "../proposables";
import { ProcedureFormFields } from "../ProcedureFormFields";
import { useCreateFromProcedure } from "../useCreateFromProcedure";
import { nearbyBasisFromResolution, useNearbyRequests } from "../useCreationData";
import { useCreationDraft, type DraftBody } from "../useCreationDraft";
import { draftBanner, photoBlockState, procedureChips, readinessLine, sectionNumbers } from "./mobileCreation";
import {
  CONSENTS,
  consentsSatisfied,
  consentStatement,
  defaultConsentAnswers,
  type ConsentKind,
} from "@fn/_shared/consents/catalog";

function toSubmission(resolution: RequesterResolution): RequesterSubmission {
  if (resolution.kind === "contact") {
    return { kind: "contact", audience: resolution.audience, socle_contact_id: resolution.contact.id };
  }
  if (resolution.kind === "sans_rapprochement") {
    return { kind: "sans_rapprochement", audience: resolution.audience, declared: resolution.declared };
  }
  return { kind: "anonyme" };
}

/** Interrupteur DS (bouton `role="switch"`) — même motif que « Afficher les quartiers » de la carte. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3 shadow-airbnb-sm">
      <span className="text-[15px] font-bold">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={cn(
          "relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-6 rounded-full bg-card shadow-airbnb-sm transition-all",
            checked ? "left-[23px]" : "left-[3px]",
          )}
        />
      </button>
    </div>
  );
}

/** Vignettes des photos déjà prises — `URL.createObjectURL`, révoquées au changement. */
function PhotoThumbnails({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  const [urls, setUrls] = React.useState<string[]>([]);
  React.useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return (
    <>
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          className="relative size-[88px] shrink-0 overflow-hidden rounded-[14px] border border-border bg-muted"
        >
          {urls[i] ? <img src={urls[i]} alt="" className="size-full object-cover" /> : null}
          <button
            type="button"
            aria-label={`Retirer la photo ${i + 1}`}
            onClick={() => onRemove(i)}
            className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-foreground/70 text-background"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </>
  );
}

export function MobileNewRequestPage() {
  const { current, rights, rightsLoading } = useTenant();
  const { session } = useAuth();
  const navigate = useNavigate();
  const orgId = current?.organizationId ?? "";
  const userId = session?.user.id ?? "";

  const procRows = useSocleProcedureRows(orgId);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const activationRows = useSocleProcedureActivations(orgId);
  const create = useCreateFromProcedure();
  const assignRequest = useAssignRequest();
  const getContact = useGetContact();
  const draft = useCreationDraft(orgId, userId);

  const [destinationId, setDestinationId] = React.useState("");
  const [procedureId, setProcedureId] = React.useState("");
  const [procedure, setProcedure] = React.useState<LoadedProcedure | null>(null);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [resolution, setResolution] = React.useState<RequesterResolution | null>(null);
  const [subject, setSubject] = React.useState("");
  const [bodyText, setBodyText] = React.useState("");
  const [priority, setPriority] = React.useState("normale");
  const [values, setValues] = React.useState<FormValues>({});
  const [files, setFiles] = React.useState<Record<string, File[]>>({});
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [dupDismissed, setDupDismissed] = React.useState(false);
  const [created, setCreated] = React.useState<{ id: string; reference: string } | null>(null);
  const [assignError, setAssignError] = React.useState<string | null>(null);
  const [assignToMe, setAssignToMe] = React.useState(false);
  // Consentements RGPD — mêmes questions qu'au bureau, même catalogue fermé.
  // Non persistés dans le brouillon : un consentement est un acte de l'usager
  // présent à cet instant, pas un réglage qui se reprend trois jours plus tard.
  const [consents, setConsents] = React.useState<Record<ConsentKind, boolean>>(defaultConsentAnswers);
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const [orgSheetOpen, setOrgSheetOpen] = React.useState(false);
  const [procedureExpanded, setProcedureExpanded] = React.useState(false);
  const [procedureQuery, setProcedureQuery] = React.useState("");
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [resuming, setResuming] = React.useState(false);
  const draftIdRef = React.useRef<string>(crypto.randomUUID());
  const captureInputRef = React.useRef<HTMLInputElement>(null);

  const schema = procedure?.schema ?? null;
  const fileCounts = fileCountsFrom(files);
  const missing = missingRequiredFields(schema, values, fileCounts).length
    + (procedure && subject.trim() === "" ? 1 : 0);

  // ---- Périmètre de création : l'organisme D'ABORD (même règle qu'au bureau) --
  const cacheIds = (procRows.data ?? []).map((r) => r.socle_id);
  const perimeterReady = !rightsLoading && !procRows.isLoading
    && !orgCatalog.isLoading && !activationRows.isLoading;
  const activated = React.useMemo(
    () => activationsByOrganisation(activationRows.data ?? []),
    [activationRows.data],
  );
  const proposable = creatableByOrganisation(rights, cacheIds, activated);
  const orgChoices = organizationChoices(orgCatalog.data ?? [], new Set(proposable.keys()));
  const needsOrgStep = needsOrganizationChoice(orgChoices);
  const soleOrgId = soleOrganization(orgChoices);
  const creatableProcedureIds = destinationId === ""
    ? new Set([...proposable.values()].flatMap((set) => [...set]))
    : (proposable.get(destinationId) ?? new Set<string>());
  const creatableRows = (procRows.data ?? []).filter((r) => creatableProcedureIds.has(r.socle_id));
  const noCreationRight = perimeterReady && orgChoices.length === 0;
  const mirrorEmpty = noCreationRight && creatableProcedures(rights, cacheIds).size > 0;

  const destinationLabel = (orgCatalog.data ?? []).find((o) => o.value === destinationId)?.label ?? null;

  const nearbyBasis = React.useMemo(() => nearbyBasisFromResolution(resolution), [resolution]);
  const nearby = useNearbyRequests(orgId, nearbyBasis);
  const nearbyScored = React.useMemo<NearbyScored[]>(
    () => nearbyBasis && nearby.data
      ? scoreNearbyRequests(nearby.data, { basis: nearbyBasis.kind, procedureId, now: new Date() })
      : [],
    [nearby.data, nearbyBasis, procedureId],
  );
  const duplicates = nearbyScored.filter((i) => i.likelyDuplicate);

  const canAssignSelf = Boolean(
    procedure && destinationId !== ""
      && rightsFor(rights, destinationId, procedureId).has("instruction"),
  );

  const photo = procedure ? photoBlockState(procedure.schema, files) : null;
  const sectionTitles = sectionNumbers(Boolean(photo));
  const chips = procedureChips(creatableRows, procedureExpanded ? procedureQuery : "");
  const nativeCapture = prefersNativeCapture();

  // Unique organisme admissible : retenu d'office, comme au bureau (aucun
  // pré-choix quand il y en a plusieurs).
  React.useEffect(() => {
    if (soleOrgId) setDestinationId((d) => (d === "" ? soleOrgId : d));
  }, [soleOrgId]);

  // Le droit d'instruction sur le couple décide du réglage par défaut de
  // « M'affecter cette demande » — recalculé à chaque changement de couple.
  React.useEffect(() => {
    setAssignToMe(canAssignSelf);
  }, [canAssignSelf]);

  // ---- Brouillon local (même clé de stockage que le bureau — step figé à 3) --
  const draftBody: DraftBody | null = procedureId !== "" && !created
    ? {
        draftId: draftIdRef.current,
        step: 3,
        procedureId,
        destinationId,
        requester: draftRequesterFromResolution(resolution),
        subject,
        body: bodyText,
        priority,
        values,
        linked: [],
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

  if (!perimeterReady && !procedure) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-lg font-bold">Nouvelle demande</h1>
        <p className="text-sm text-muted-foreground">Lecture de votre périmètre de création…</p>
      </div>
    );
  }

  if (noCreationRight && !procedure) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-lg font-bold">Nouvelle demande</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {mirrorEmpty
            ? "Vos droits autorisent la création, mais aucune de vos organisations n'est connue du "
              + "référentiel de ce tenant — signalez-le à votre administrateur."
            : "Vous n'avez pas de droit de création de demande — contactez votre administrateur."}
        </p>
        <Button type="button" variant="outline" onClick={() => navigate("/demandes")}>
          Retour aux demandes
        </Button>
      </div>
    );
  }

  // ---- Actions -----------------------------------------------------------------
  const setValue = (fieldId: string, value: unknown) => setValues((v) => ({ ...v, [fieldId]: value }));
  const setFieldFiles = (fieldId: string, next: File[]) => setFiles((f) => ({ ...f, [fieldId]: next }));

  function applyProcedure(id: string, snapshot: ProcedureSnapshot, resetForm: boolean) {
    const parsed = parseFormSchema(snapshot.form_schema);
    setProcedureId(id);
    setProcedure({ snapshot, schema: parsed });
    if (resetForm) {
      setValues({});
      setFiles({});
      setFieldErrors({});
      setDupDismissed(false);
    }
    setSubject((s) => (resetForm || s.trim() === "" ? snapshot.name : s));
    const allowedIds = creationOrganizationIds(rights, id);
    const validOrgIds = new Set(
      (orgCatalog.data ?? []).filter((o) => allowedIds.has(o.value)).map((o) => o.value),
    );
    setDestinationId((d) => (validOrgIds.has(d) ? d : ""));
    setResolution((r) => (r && validateRequesterSubmission(snapshot.requester_config, toSubmission(r)).ok ? r : null));
  }

  async function selectProcedure(id: string) {
    setError(null);
    setLoadingId(id);
    try {
      const snapshot = await fetchProcedureSnapshot(orgId, id);
      if (!snapshot) {
        setError("La démarche n'a pas pu être chargée depuis le Référentiel — réessayez dans un instant.");
        return;
      }
      applyProcedure(id, snapshot, id !== procedureId);
      draft.dismissExisting();
      setProcedureExpanded(false);
      setProcedureQuery("");
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
        setError("Le brouillon ne peut pas être repris : la démarche n'a pas pu être rechargée depuis le Référentiel.");
        return;
      }
      draftIdRef.current = d.draftId;
      const parsed = parseFormSchema(snapshot.form_schema);
      setProcedureId(d.procedureId);
      setProcedure({ snapshot, schema: parsed });
      const allowedIds = creationOrganizationIds(rights, d.procedureId);
      const validOrgIds = new Set(
        (orgCatalog.data ?? []).filter((o) => allowedIds.has(o.value)).map((o) => o.value),
      );
      const keptDestination = validOrgIds.has(d.destinationId) ? d.destinationId : "";
      setDestinationId(keptDestination);
      setSubject(d.subject.trim() === "" ? snapshot.name : d.subject);
      setBodyText(d.body);
      setPriority(d.priority);
      setValues(d.values);
      setFiles({});
      setFieldErrors({});
      setDupDismissed(d.dupDismissed);

      let res: RequesterResolution | null = null;
      if (d.requester?.kind === "contact") {
        try {
          const contact = await getContact.mutateAsync({
            organizationId: orgId, socleContactId: d.requester.socleContactId,
          });
          res = { kind: "contact", audience: d.requester.audience, contact };
        } catch {
          setError("L'usager du brouillon n'a pas pu être relu depuis le Référentiel — à désigner de nouveau.");
        }
      } else if (d.requester?.kind === "sans_rapprochement") {
        res = { kind: "sans_rapprochement", audience: d.requester.audience, declared: d.requester.declared };
      } else if (d.requester?.kind === "anonyme") {
        res = { kind: "anonyme" };
      }
      if (res && !validateRequesterSubmission(snapshot.requester_config, toSubmission(res)).ok) res = null;
      setResolution(res);
      draft.dismissExisting();
    } finally {
      setResuming(false);
    }
  }

  function chooseOrganisme(id: string) {
    setDestinationId(id);
    setError(null);
    if (procedureId !== "" && !creationOrganizationIds(rights, procedureId).has(id)) {
      setProcedureId("");
      setProcedure(null);
      setValues({});
      setFiles({});
      setFieldErrors({});
      setResolution(null);
      setDupDismissed(false);
    }
    setOrgSheetOpen(false);
  }

  function onResolve(r: RequesterResolution | null) {
    setResolution(r);
    setDupDismissed(false);
  }

  /** Déclarations de pièces pour la validation de confort (chemins fictifs, comme au bureau). */
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

  function addPhotoFile(file: File) {
    if (!photo) return;
    const fieldId = photo.field.field.id;
    const max = photo.field.field.maxFiles;
    setFiles((f) => {
      const current = f[fieldId] ?? [];
      return current.length >= max ? f : { ...f, [fieldId]: [...current, file] };
    });
  }

  function removePhotoFile(index: number) {
    if (!photo) return;
    const fieldId = photo.field.field.id;
    setFiles((f) => ({ ...f, [fieldId]: (f[fieldId] ?? []).filter((_, i) => i !== index) }));
  }

  function openCamera() {
    // Écran tactile ou appareil sans aperçu vidéo : l'appareil photo natif
    // (ou, à défaut, le sélecteur de fichiers habituel) — jamais une impasse.
    if (nativeCapture || !supportsInAppCamera()) captureInputRef.current?.click();
    else setCameraOpen(true);
  }

  async function handleSubmit() {
    if (!procedure || !resolution) return;
    setError(null);
    setAssignError(null);
    const errors: Record<string, string> = {};
    if (subject.trim() === "") errors["_subject"] = "L'objet de la demande est obligatoire.";
    const result = validateFormSubmission(procedure.schema, values, draftAttachmentDeclarations(procedure));
    Object.assign(errors, result.errors);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("Corrigez les champs signalés avant de créer la demande.");
      return;
    }
    if (destinationMissing(destinationId)) {
      setError("L'organisme est obligatoire.");
      if (needsOrgStep) setOrgSheetOpen(true);
      return;
    }
    try {
      const created2 = await create.mutateAsync({
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
        consents: CONSENTS.map((c) => ({ kind: c.kind, granted: consents[c.kind] === true })),
      });
      draft.clear();
      setCreated({ id: created2.id, reference: created2.reference });
      if (assignToMe) {
        try {
          await assignRequest.mutateAsync({ requestId: created2.id, assigneeId: userId });
        } catch {
          setAssignError("L'affectation ne s'est pas appliquée — attribuez-la depuis la fiche.");
        }
      }
    } catch (err) {
      const edge = err as EdgeError;
      if (edge.fields) setFieldErrors(edge.fields);
      if (edge.code === "conflict") draftIdRef.current = crypto.randomUUID();
      setError(edge.message ?? "Erreur lors de la création.");
    }
  }

  function restart() {
    draftIdRef.current = crypto.randomUUID();
    setProcedureId("");
    setProcedure(null);
    setDestinationId("");
    setResolution(null);
    setSubject("");
    setBodyText("");
    setPriority("normale");
    setConsents(defaultConsentAnswers());
    setValues({});
    setFiles({});
    setFieldErrors({});
    setError(null);
    setDupDismissed(false);
    setCreated(null);
    setAssignError(null);
    setProcedureExpanded(false);
    setProcedureQuery("");
  }

  function requestClose() {
    if (procedureId === "" || created) {
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

  // ---- Écran de confirmation : remplace la page --------------------------------
  if (created && procedure) {
    const requesterName = requesterShortName(resolution);
    return (
      <div className="flex min-h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Check className="size-8" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-extrabold">Demande {created.reference} créée</h1>
          <p className="text-sm text-muted-foreground">
            {procedure.snapshot.name} pour {requesterName ?? "l'usager"}
          </p>
          {assignError ? <MobileNotice tone="warn">{assignError}</MobileNotice> : null}
        </div>
        <MobileFooter safeArea>
          <Button size="lg" className="h-12 w-full rounded-[14px] text-base"
            onClick={() => navigate(`/demandes/${created.id}`)}>
            Ouvrir la demande
          </Button>
          <Button type="button" variant="outline" size="lg" className="h-12 w-full rounded-[14px] text-base"
            onClick={restart}>
            Nouvelle demande
          </Button>
        </MobileFooter>
      </div>
    );
  }

  // ---- Vue ---------------------------------------------------------------------
  const photoFiles = photo ? (files[photo.field.field.id] ?? []) : [];
  const photoFull = photo ? photoFiles.length >= photo.field.field.maxFiles : true;
  const existingDraft = draft.existing;
  const existingDraftName = existingDraft
    ? (procRows.data ?? []).find((r) => r.socle_id === existingDraft.procedureId)?.name ?? null
    : null;
  // Reflet d'écran : la garde qui compte est `normalizeConsents`, côté serveur.
  const consentsMissing = !consentsSatisfied(consents);
  const submitDisabled = !procedure || !resolution || destinationMissing(destinationId)
    || consentsMissing || create.isPending;

  return (
    <div className="flex min-h-full flex-col">
      <MobileHeader
        leading="close"
        onLeading={requestClose}
        title="Nouvelle demande"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <span className="truncate">
              {current.organizationName}
              {destinationLabel ? ` · ${destinationLabel}` : (needsOrgStep ? " · organisme à choisir" : "")}
            </span>
            {needsOrgStep ? (
              <button type="button" className="shrink-0 font-bold text-primary" onClick={() => setOrgSheetOpen(true)}>
                changer
              </button>
            ) : null}
          </span>
        }
        trailing={draft.savedAt ? (
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-secondary-foreground">
            Brouillon
          </span>
        ) : null}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {error ? <MobileNotice tone="error">{error}</MobileNotice> : null}

        {existingDraft ? (
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-primary/30 bg-primary/[0.04] px-4 py-3.5">
            <div className="flex flex-col">
              <span className="text-sm font-bold">Un brouillon est en attente sur cet appareil</span>
              <span className="text-xs text-muted-foreground">{draftBanner(existingDraft, existingDraftName)}</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={resuming} onClick={() => draft.clear()}>
                Abandonner
              </Button>
              <Button type="button" size="sm" disabled={resuming} onClick={() => void resumeDraft(existingDraft)}>
                {resuming ? "Reprise…" : "Reprendre"}
              </Button>
            </div>
          </div>
        ) : null}

        {/* La section Photo n'existe que si la démarche chargée a un champ
            pièce — voir l'en-tête de fichier : elle vise CE champ, donc elle
            attend de le connaître avant de pouvoir s'afficher. */}
        {photo ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold leading-tight">{sectionTitles.photo}</h2>
            <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={openCamera}
                disabled={photoFull}
                className="flex min-h-[88px] w-[120px] shrink-0 flex-col items-center justify-center gap-1 rounded-[14px] bg-primary text-primary-foreground shadow-airbnb-sm transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                <Camera className="size-[26px]" aria-hidden="true" />
                <span className="text-sm font-extrabold">Photographier</span>
              </button>
              <PhotoThumbnails files={photoFiles} onRemove={removePhotoFile} />
            </div>
            <input
              ref={captureInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhotoFile(f); e.target.value = ""; }}
            />
            {!nativeCapture && supportsInAppCamera() ? (
              <CameraCaptureDialog
                open={cameraOpen}
                remaining={Math.max(0, photo.field.field.maxFiles - photoFiles.length)}
                onClose={() => setCameraOpen(false)}
                onCapture={(file) => addPhotoFile(file)}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              Les photos rejoignent la pièce « {photo.field.field.label} ».
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-[15px] font-extrabold leading-tight">{sectionTitles.demarche}</h2>
          {needsOrgStep && destinationId === "" ? (
            <MobileNotice tone="warn">
              Choisissez d'abord l'organisme — il détermine les démarches proposées.
            </MobileNotice>
          ) : procRows.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement des démarches…</p>
          ) : creatableRows.length === 0 ? (
            <MobileNotice tone="warn">Aucune démarche disponible pour cet organisme.</MobileNotice>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {chips.visible.map((row) => (
                  <MobileChip
                    key={row.socle_id}
                    active={row.socle_id === procedureId}
                    onClick={() => void selectProcedure(row.socle_id)}
                  >
                    {loadingId === row.socle_id ? "Chargement…" : row.name}
                  </MobileChip>
                ))}
                {!procedureExpanded && chips.hiddenCount > 0 ? (
                  <MobileChip active={false} onClick={() => setProcedureExpanded(true)}>
                    Autres… (+{chips.hiddenCount})
                  </MobileChip>
                ) : null}
              </div>
              {procedureExpanded ? (
                <Input
                  value={procedureQuery}
                  onChange={(e) => setProcedureQuery(e.target.value)}
                  placeholder="Rechercher une démarche…"
                  aria-label="Rechercher une démarche"
                />
              ) : null}
            </>
          )}
        </section>

        {procedure ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold leading-tight">{sectionTitles.usager}</h2>
            <RequesterIdentification
              organizationId={orgId}
              requesterConfig={procedure.snapshot.requester_config}
              resolution={resolution}
              onResolve={onResolve}
            />
          </section>
        ) : null}

        {procedure && resolution ? (
          <section className="flex flex-col gap-3.5">
            <h2 className="text-[15px] font-extrabold leading-tight">{sectionTitles.details}</h2>

            <Field label="Objet" htmlFor="mnw-subject" required error={fieldErrors["_subject"]}>
              <Input id="mnw-subject" value={subject} maxLength={500} onChange={(e) => setSubject(e.target.value)} />
            </Field>

            <ProcedureFormFields
              schema={procedure.schema} values={values} onChange={setValue}
              files={files} onFilesChange={setFieldFiles} errors={fieldErrors}
            />
            {fieldErrors["_attachments"] ? (
              <p className="text-sm text-destructive">{fieldErrors["_attachments"]}</p>
            ) : null}

            <Field label="Description" htmlFor="mnw-body"
              hint="Visible dans la fiche de la demande — ce n'est pas une note interne.">
              <Textarea id="mnw-body" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            </Field>

            <Field label="Urgence" htmlFor="mnw-priority">
              <Select id="mnw-priority" className="h-11 px-4" value={priority}
                onChange={(e) => setPriority(e.target.value)}>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>

            {canAssignSelf ? (
              <Toggle checked={assignToMe} onChange={() => setAssignToMe((v) => !v)} label="M'affecter cette demande" />
            ) : null}
          </section>
        ) : null}

        {procedure ? (
          <section className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-muted-foreground">
              Consentements de l'usager
            </h2>
            {CONSENTS.map((def) => (
              <label
                key={def.kind}
                className="flex items-start gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3 shadow-airbnb-sm"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 shrink-0 rounded border-input text-primary"
                  checked={consents[def.kind] === true}
                  onChange={(e) => setConsents((c) => ({ ...c, [def.kind]: e.target.checked }))}
                />
                <span className="flex flex-col gap-1">
                  <span className="text-[14px] font-semibold leading-relaxed">
                    {consentStatement(def.kind, current.organizationName)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {def.required
                      ? "Obligatoire — sans ce consentement, la demande ne peut pas être déposée."
                      : "Facultatif — l'usager peut le refuser sans conséquence sur sa demande."}
                  </span>
                </span>
              </label>
            ))}
          </section>
        ) : null}

        {duplicates.length > 0 && !dupDismissed ? (
          <MobileNotice tone="warn" icon={<TriangleAlert aria-hidden="true" />}>
            <div className="flex flex-col gap-1.5">
              <span>Des demandes proches existent peut-être déjà :</span>
              <ul className="flex flex-col gap-1">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    <Link to={`/demandes/${d.id}`} className="font-bold underline">{d.reference}</Link> — {d.subject}
                  </li>
                ))}
              </ul>
              <button type="button" className="self-start text-xs font-bold underline" onClick={() => setDupDismissed(true)}>
                Créer quand même
              </button>
            </div>
          </MobileNotice>
        ) : null}
      </div>

      <MobileFooter safeArea hint="Statut à la création : à traiter · brouillon repris sur le poste">
        <p className="text-center text-xs font-semibold text-muted-foreground">
          {readinessLine({ hasProcedure: Boolean(procedure), hasRequester: Boolean(resolution), missing })}
        </p>
        <Button size="lg" className="h-12 w-full rounded-[14px] text-base" disabled={submitDisabled}
          onClick={() => void handleSubmit()}>
          {create.isPending ? "Création…" : "Créer la demande"}
        </Button>
      </MobileFooter>

      <MobileSheet open={orgSheetOpen} onOpenChange={setOrgSheetOpen} title="Pour quel organisme ?">
        <div className="flex flex-col gap-2">
          {orgChoices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => chooseOrganisme(choice.value)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-[14px] border px-3.5 py-3 text-left transition-colors",
                choice.value === destinationId
                  ? "border-primary bg-primary/[0.04]"
                  : "border-border bg-card hover:bg-muted/40",
              )}
            >
              <span className="text-[15px] font-bold">{choice.label}</span>
              {choice.context ? <span className="text-xs text-muted-foreground">{choice.context}</span> : null}
            </button>
          ))}
        </div>
      </MobileSheet>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quitter la saisie ?</DialogTitle>
            <DialogDescription>
              Le brouillon peut être conservé sur cet appareil et repris plus tard depuis
              « Nouvelle demande ». Les photos et pièces jointes seront à déposer de nouveau.
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
