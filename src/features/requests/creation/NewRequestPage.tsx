// Parcours de création d'une demande — piloté EXCLUSIVEMENT par une démarche
// Socle active du tenant (règle non négociable : aucune demande libre).
// Quatre étapes (démarche → usager → formulaire → récapitulatif) puis création
// via l'edge function create-request-from-procedure (revalidation + écriture
// atomique côté serveur — le navigateur ne fournit jamais de snapshot).
//
// …précédées, POUR QUI EN A PLUSIEURS, d'une question préalable : « pour quel
// organisme ? » (étape 0, décision PO du 2026-08-31 — backlog B4). Elle ne
// s'affiche pas quand la réponse est unique, et rien n'y est pré-sélectionné
// quand elle s'affiche : l'organisme porteur décide des droits d'instruction et
// de clôture, il ne doit pas se choisir par défaut. C'est lui, ensuite, qui
// borne les démarches proposées — les droits étant des couples (organisation,
// démarche), l'ordre inverse proposerait des démarches refusées au bout.
// Autour : brouillon local continu, détection best-effort des demandes proches
// avec liaison explicite, récépissé imprimable, et l'onglet « Procédure » du
// rail : la base de connaissances que le Socle destine à l'agent, lue à côté
// de la saisie plutôt que dans un autre outil.
//
// Entrée « depuis la fiche usager » (`?usager=<id Socle>`) : l'usager est
// IMPOSÉ — relu depuis le Socle, appliqué dès que la démarche est choisie,
// affiché verrouillé à l'étape 2 (ni recherche, ni « Modifier »). Il reste
// soumis au requester_config de la démarche : un public qu'elle ne propose pas
// est refusé ici comme il le serait côté serveur.

import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { creatableProcedures, creationOrganizationIds } from "@/features/rights/rights";
import {
  fetchProcedureSnapshot,
  useSocleOrganizationsCatalog,
  useSocleProcedureActivations,
  useSocleProcedureRows,
  type ProcedureSnapshot,
  type SocleProcedureRow,
} from "@/features/socle/useSocleCatalog";
import { RequesterIdentification } from "@/features/contacts/RequesterIdentification";
import { useGetContact, useSocleContact } from "@/features/contacts/useContacts";
import { candidateSummary, contactAudience } from "@/features/contacts/rapprochement";
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
import { useProcedureDocumentUrl } from "../procedure/useProcedureKnowledge";
import { AssistantThreadProvider } from "../assistant/AssistantThreadProvider";
import { FicheDemarcheDialog } from "../procedure/FicheDemarcheDialog";
import {
  parseAgentKnowledge,
  type KnowledgeDocument,
} from "@fn/socle-proxy/_shared/knowledge";
import {
  CONSENTS,
  consentsSatisfied,
  defaultConsentAnswers,
  type ConsentKind,
} from "@fn/_shared/consents/catalog";
import { CreationRail, type FicheLine, type NearbyState } from "./CreationRail";
import { CreationStepper, type StepDef } from "./CreationStepper";
import { OrganismePicker } from "./OrganismePicker";
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
  destinationMissing,
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
import {
  needsOrganizationChoice,
  organizationChoices,
  soleOrganization,
} from "./organismes";
import { scoreNearbyRequests, type NearbyScored } from "./proches";
import { activationsByOrganisation, creatableByOrganisation } from "./proposables";
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
  const { current, rights, rightsLoading } = useTenant();
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const orgId = current?.organizationId ?? "";
  const userId = session?.user.id ?? "";

  const procRows = useSocleProcedureRows(orgId);
  const monthlyCounts = useProcedureMonthlyCounts(orgId);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const activationRows = useSocleProcedureActivations(orgId);
  const create = useCreateFromProcedure();
  const linkRequests = useLinkRequests();
  const getContact = useGetContact();
  const documentUrl = useProcedureDocumentUrl();
  const draft = useCreationDraft(orgId, userId);

  // Usager imposé (création depuis sa fiche) : relu depuis le Socle, jamais
  // transporté par l'URL autrement que par son identifiant.
  const [searchParams, setSearchParams] = useSearchParams();
  const imposedContactId = searchParams.get("usager");
  const imposedContact = useSocleContact(orgId, imposedContactId);

  // `null` = l'agent n'a pas encore navigué : l'étape courante est alors la
  // PREMIÈRE du parcours — laquelle n'est connue qu'une fois le périmètre lu
  // (0 quand l'organisme reste à choisir, 1 sinon). Dériver plutôt que
  // d'initialiser évite d'ouvrir sur une étape que les droits contrediront.
  const [stepState, setStep] = React.useState<PageStep | null>(null);
  const [maxReachedState, setMaxReached] = React.useState<number | null>(null);
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
  // « Fiche démarche » ouverte depuis le bouton « i » d'une carte — la démarche
  // CONSULTÉE, qui n'est pas forcément la démarche choisie.
  const [ficheRow, setFicheRow] = React.useState<SocleProcedureRow | null>(null);
  const [dupDismissed, setDupDismissed] = React.useState(false);
  // Consentements RGPD — questions SYSTÉMATIQUES du dépôt, hors `form_schema`.
  // Volontairement ABSENTS du brouillon local : un consentement est un acte de
  // l'usager présent à cet instant. Le restaurer d'une session vieille de trois
  // jours ferait valider un dépôt sur une case que personne n'a cochée. À la
  // reprise, la question est reposée — c'est le prix, et il est juste.
  const [consents, setConsents] = React.useState<Record<ConsentKind, boolean>>(defaultConsentAnswers);
  const [created, setCreated] = React.useState<{ id: string; reference: string; at: Date } | null>(null);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [documentError, setDocumentError] = React.useState<string | null>(null);
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

  // ---- Périmètre de création : l'organisme D'ABORD (B4) ----------------------
  // Le périmètre est connu quand les droits ET les deux catalogues du tenant le
  // sont : tant qu'il ne l'est pas, on ne sait pas encore si la question de
  // l'organisme se pose, donc on n'affiche aucune étape (voir le garde-fou
  // plus bas) plutôt qu'un parcours qui se renumérote sous les yeux de l'agent.
  const cacheIds = (procRows.data ?? []).map((r) => r.socle_id);
  const perimeterReady = !rightsLoading && !procRows.isLoading
    && !orgCatalog.isLoading && !activationRows.isLoading;

  // Les QUATRE règles de la spécification PO du 2026-08-31, croisées une seule
  // fois : `cacheIds` porte déjà « en production » et « dans sa période »,
  // `creatableByOrganisation` ajoute « activée pour cet organisme » et « dans
  // mes droits ». Une organisation absente de la table n'a rien à proposer —
  // elle ne sera donc pas offerte à l'étape 0 (pas de cul-de-sac).
  const activated = React.useMemo(
    () => activationsByOrganisation(activationRows.data ?? []),
    [activationRows.data],
  );
  const proposable = creatableByOrganisation(rights, cacheIds, activated);
  const orgChoices = organizationChoices(orgCatalog.data ?? [], new Set(proposable.keys()));
  const needsOrgStep = needsOrganizationChoice(orgChoices);
  const firstStep: CreationStep = needsOrgStep ? 0 : 1;
  const step: PageStep = stepState ?? firstStep;
  const maxReached = maxReachedState ?? firstStep;
  /** Unique organisme admissible : retenu d'office, sans question (B4). */
  const soleOrgId = soleOrganization(orgChoices);

  // RM-58 : seules les démarches où l'utilisateur détient création sont
  // proposées — et, l'organisme une fois arrêté, seulement celles créables POUR
  // LUI (les droits sont des couples). Avant qu'il le soit, l'union sert au
  // seul état vide « aucun droit de création ».
  const creatableProcedureIds = destinationId === ""
    ? new Set([...proposable.values()].flatMap((set) => [...set]))
    : (proposable.get(destinationId) ?? new Set<string>());
  const creatableRows = (procRows.data ?? []).filter((r) => creatableProcedureIds.has(r.socle_id));
  const noCreationRight = perimeterReady && orgChoices.length === 0;
  // Droits en règle mais rien de proposable : ce n'est PAS un défaut de droits,
  // et l'administrateur doit pouvoir faire la différence — le plus souvent,
  // aucune démarche n'est activée pour ses organisations dans le Socle.
  const mirrorEmpty = noCreationRight && creatableProcedures(rights, cacheIds).size > 0;

  // RM-59 : le destinataire ne propose que l'intersection périmètre (création sur cette
  // démarche) ∩ organisations non obsolètes du miroir.
  const destinationAllowedIds = procedure ? creationOrganizationIds(rights, procedureId) : new Set<string>();
  const destinationOptions = (orgCatalog.data ?? []).filter((o) => destinationAllowedIds.has(o.value));

  const missing = missingRequiredFields(schema, values, fileCounts).length
    + (procedure && subject.trim() === "" ? 1 : 0)
    + (procedure && destinationMissing(destinationId) ? 1 : 0);
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

  // ---- Usager imposé (entrée depuis la fiche usager) --------------------------
  type ContactResolution = Extract<RequesterResolution, { kind: "contact" }>;
  const imposedResolution = React.useMemo<ContactResolution | null>(() => {
    const contact = imposedContact.data;
    if (!contact) return null;
    const audience = contactAudience(contact.contact_type);
    return audience === null ? null : { kind: "contact", audience, contact };
  }, [imposedContact.data]);

  /** Nom de l'usager imposé, connu avant même le choix de la démarche. */
  const imposedName = imposedContact.data ? candidateSummary(imposedContact.data).title : null;

  const imposedRefused = Boolean(
    procedure && imposedResolution
      && !validateRequesterSubmission(procedure.snapshot.requester_config, toSubmission(imposedResolution)).ok,
  );

  /** Pourquoi l'étape 2 ne propose rien (usager imposé inutilisable), ou null. */
  const imposedMessage: string | null = !imposedContactId ? null
    : imposedContact.isLoading ? "Lecture de la fiche usager dans le référentiel Socle…"
    : imposedContact.isError || !imposedContact.data
      ? `La fiche usager n'a pas pu être relue depuis le Socle${
          imposedContact.error instanceof Error ? ` — ${imposedContact.error.message}` : "."
        } Reprenez depuis la fiche de l'usager, ou créez la demande sans point d'entrée imposé.`
    : imposedResolution === null
      ? "Cet usager est enregistré comme administration dans le Socle : aucun public de démarche Iris ne lui correspond."
    : imposedRefused
      ? `La démarche « ${procedure!.snapshot.name} » ne propose pas le public « ${
          imposedResolution.audience === "citoyen" ? "Citoyen"
            : imposedResolution.audience === "entreprise" ? "Entreprise" : "Association"
        } » — choisissez une autre démarche.`
    : null;

  // L'usager imposé est appliqué dès que la démarche est chargée (et rejoué si
  // la fiche Socle arrive après). Le requester_config reste l'arbitre.
  React.useEffect(() => {
    if (!imposedContactId || !procedure) return;
    const config = procedure.snapshot.requester_config;
    setResolution((current) => {
      if (!imposedResolution) return null;
      if (!validateRequesterSubmission(config, toSubmission(imposedResolution)).ok) return null;
      const same = current?.kind === "contact" && current.contact.id === imposedResolution.contact.id;
      return same ? current : imposedResolution;
    });
  }, [imposedContactId, imposedResolution, procedure]);

  // Un seul organisme admissible : il est retenu d'office et l'étape 0 ne
  // s'ouvre pas — il n'y a rien à demander. Plusieurs : RIEN n'est
  // pré-sélectionné (décision PO du 2026-08-31), sans quoi la question serait
  // entérinée sans être lue, comme l'était le pré-remplissage par
  // l'organisation de la démarche.
  React.useEffect(() => {
    if (soleOrgId) setDestinationId((d) => (d === "" ? soleOrgId : d));
  }, [soleOrgId]);

  // ---- Brouillon local (différé à chaque saisie) -----------------------------
  const draftBody: DraftBody | null = procedureId !== "" && step !== 5
    ? {
        draftId: draftIdRef.current,
        // L'étape 0 n'est pas une saisie mais une question, et le brouillon
        // porte déjà sa réponse (`destinationId`) : un retour en arrière sur
        // l'organisme se reprend à la démarche. `resumeDraft` renverra à la
        // question si la réponse enregistrée n'est plus admissible.
        step: Math.max(step, 1) as 1 | 2 | 3 | 4,
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

  // Base de connaissances de la démarche : elle est arrivée AVEC elle
  // (socle-proxy l'ajoute à la lecture complète), donc aucun appel de plus.
  // ⚠️ Ce `useMemo` est le DERNIER hook du composant, et il doit rester
  // au-dessus des sorties anticipées qui suivent : sous elles, il n'était
  // évalué que sur certains rendus — « Rendered more hooks than during the
  // previous render » dès que le garde-fou de chargement s'ouvrait.
  const knowledge = React.useMemo(
    () => (procedure ? parseAgentKnowledge(procedure.snapshot.knowledge_base) : null),
    [procedure],
  );

  if (!current) return null;

  // Le parcours n'ouvre pas avant de savoir combien d'organismes l'agent peut
  // servir : c'est ce qui décide de sa PREMIÈRE étape. Ouvrir avant, ce serait
  // afficher un stepper qui se renumérote une fraction de seconde plus tard.
  if (!perimeterReady && !procedure) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <h1 className="text-xl font-semibold">Nouvelle demande</h1>
        <p className="text-sm text-muted-foreground">Lecture de votre périmètre de création…</p>
      </div>
    );
  }

  // RM-58 : sans droit de création sur aucune démarche, le parcours ne
  // s'ouvre pas — sauf pour ne pas interrompre une saisie déjà commencée
  // (perte de droits en cours de route, RM-54).
  if (noCreationRight && !procedure) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <h1 className="text-xl font-semibold">Nouvelle demande</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {mirrorEmpty
            ? "Vos droits autorisent la création, mais aucune des organisations de votre "
              + "périmètre n'est connue du référentiel de ce tenant — signalez-le à votre "
              + "administrateur, une synchronisation du Socle est probablement en attente."
            : "Vous n'avez pas de droit de création de demande — contactez votre administrateur."}
        </p>
        <Button type="button" variant="outline" onClick={() => navigate("/demandes")}>
          Retour aux demandes
        </Button>
      </div>
    );
  }

  // ---- Actions -----------------------------------------------------------------
  const setValue = (fieldId: string, value: unknown) =>
    setValues((v) => ({ ...v, [fieldId]: value }));
  const setFieldFiles = (fieldId: string, next: File[]) =>
    setFiles((f) => ({ ...f, [fieldId]: next }));

  function goTo(n: CreationStep) {
    setStep(n);
    setMaxReached((m) => Math.max(m ?? n, n));
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
      setMaxReached((m) => Math.min(m ?? 2, 2));
    }
    setSubject((s) => (resetForm || s.trim() === "" ? snapshot.name : s));
    // RM-59 : le destinataire ne peut être que dans l'intersection périmètre
    // (création sur CETTE démarche) ∩ miroir non obsolète. L'organisme est
    // désormais arrêté AVANT la démarche, et la liste des démarches est bornée
    // par lui : cette vérification est défensive, elle ne devrait jamais mordre.
    // ⚠️ Plus de repli sur `snapshot.organization_id` : c'est ce pré-remplissage
    // silencieux qui faisait atterrir sur la racine des demandes communales
    // (décision PO du 2026-08-31 — B4).
    const allowedIds = creationOrganizationIds(rights, id);
    const validOrgIds = new Set(
      (orgCatalog.data ?? []).filter((o) => allowedIds.has(o.value)).map((o) => o.value),
    );
    setDestinationId((d) => (validOrgIds.has(d) ? d : ""));
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
      // L'organisme du brouillon est REVÉRIFIÉ : les droits ont pu changer
      // depuis l'enregistrement, et un brouillon n'est pas un droit acquis.
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

      // Les pièces ne sont pas persistées : on repasse au plus tard par le
      // formulaire — et par l'étape 0 si l'organisme du brouillon n'est plus
      // admissible, plutôt que de laisser une saisie qui sera refusée au bout.
      const target: CreationStep = keptDestination === "" && needsOrgStep ? 0
        : !res ? 2
        : (Math.max(2, Math.min(d.step, 3)) as CreationStep);
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

  /**
   * Choix de l'organisme porteur (étape 0). Comme le choix d'une démarche
   * (`selectProcedure`) et celui d'un usager (`onResolve`), il ENCHAÎNE sur
   * l'étape suivante : désigner, c'est avoir répondu — faire cliquer
   * « Continuer » derrière serait un geste de plus pour rien, et cette étape-ci
   * était la seule à le demander.
   *
   * En changer peut RETIRER la démarche déjà choisie : les droits sont des
   * couples (organisation, démarche), et une démarche créable à Arles ne l'est
   * pas forcément à Fontvieille. On la relâche franchement plutôt que de
   * laisser courir une saisie que le serveur refusera.
   */
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
      setLinked({});
      setDupDismissed(false);
      flash("Démarche retirée — elle n'est pas proposée pour cet organisme");
    }
    goTo(1);
  }

  function next() {
    if (step === 0 && destinationId !== "") goTo(1);
    else if (step === 1 && procedure) goTo(2);
    else if (step === 2 && resolution) goTo(3);
    else if (step === 3) nextFromForm();
  }

  function back() {
    if (step > firstStep && step < 5) {
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
    if (destinationMissing(destinationId)) {
      setError("L'organisme est obligatoire.");
      // Renvoyé là où la question se pose : l'étape 0 quand elle existe.
      setStep(needsOrgStep ? 0 : 4);
      return;
    }
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
        // Le catalogue décide de ce qui part, pas l'état d'écran : un `kind`
        // absent de `consents` vaut refus explicite, jamais une omission.
        consents: CONSENTS.map((c) => ({ kind: c.kind, granted: consents[c.kind] === true })),
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
    setStep(firstStep);
    setMaxReached(firstStep);
    setProcedureId("");
    setProcedure(null);
    // L'organisme est reposé à la question quand il y en a plusieurs ; l'unique
    // organisme, lui, sera remis d'office par l'effet dédié.
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
    setConsents(defaultConsentAnswers());
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

  // Le service affiché est le DESTINATAIRE retenu — le même sous-titre qu'à
  // l'instruction —, avec repli sur l'organisation qui porte la démarche dans
  // le Socle tant que le destinataire n'est pas arrêté.
  const procedureService = destinationLabel
    ?? (procedure?.snapshot.organization_id
      ? (orgCatalog.data ?? []).find((o) => o.value === procedure.snapshot.organization_id)?.label ?? null
      : null);
  const railProcedure = procedure && knowledge
    ? { name: procedure.snapshot.name, serviceLabel: procedureService, knowledge }
    : null;

  async function openKnowledgeDocument(doc: KnowledgeDocument) {
    if (!procedureId) return;
    setDocumentError(null);
    try {
      const url = await documentUrl.mutateAsync({
        organizationId: orgId, socleProcedureId: procedureId, path: doc.path,
      });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : "Document indisponible.");
    }
  }

  const requesterName = requesterShortName(resolution);
  const steps: StepDef[] = [
    // L'étape 0 n'existe que s'il y a une question à poser (B4).
    ...(needsOrgStep
      ? [{ num: 0 as CreationStep, label: "Organisme", hint: destinationLabel ?? "à choisir" }]
      : []),
    { num: 1, label: "Démarche", hint: procedure ? procedure.snapshot.name : "à choisir" },
    { num: 2, label: "Usager", hint: requesterName ?? imposedName ?? "recherche & homonymes" },
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
    { key: "Organisme", value: destinationLabel ?? "à choisir", ok: Boolean(destinationLabel) },
    { key: "Demandes liées", value: linkedCount > 0 ? Object.values(linked).join(", ") : "aucune", ok: linkedCount > 0 },
    { key: "Statut à la création", value: STATUS_LABELS.a_traiter, ok: true },
  ];

  const nextDisabled = step === 0 ? destinationId === ""
    : step === 1 ? !procedure || loadingId !== null
    : step === 2 ? !resolution
    : false;
  const nextLabel = step === 0 ? "Continuer vers la démarche"
    : step === 1 ? "Continuer vers l'usager"
    : step === 2 ? "Continuer vers le formulaire"
    : "Voir le récapitulatif";
  // La puce suivante s'ouvre exactement quand le bouton s'ouvre — et jamais au
  // récapitulatif, qui n'a pas de suivante (le bouton y devient « Créer »), ni
  // sur l'écran de confirmation.
  const canAdvance = !created && step !== 5 && step !== 4 && !nextDisabled;
  // Reflet d'écran du catalogue : la garde qui compte est celle de
  // `create-request-from-procedure` (`normalizeConsents`), pas ce booléen.
  const consentsMissing = !consentsSatisfied(consents);
  const footHint = step === 0
      ? "L'organisme porte la demande : il décide de qui pourra l'instruire et la clore"
    : step === 1 ? "Choisissez la démarche Socle qui fonde la demande"
    : step === 2 ? (imposedContactId
        ? "Usager imposé par sa fiche — il n'est pas modifiable dans ce parcours"
        : "Renseignez l'usager : ses homonymes du Socle sont proposés automatiquement")
    : step === 3 ? (missing === 0 ? "Tous les champs obligatoires sont renseignés" : `${missing} champ${missing > 1 ? "s" : ""} obligatoire${missing > 1 ? "s" : ""} restant${missing > 1 ? "s" : ""}`)
    : consentsMissing
      ? "Le consentement au traitement des informations est obligatoire pour déposer la demande"
      : "Vérifiez le récapitulatif avant création";

  // Entrée « depuis la fiche usager » : pas de reprise de brouillon (il
  // porterait un autre usager, que le parcours imposé ne peut pas remplacer).
  const existingDraft = imposedContactId ? null : draft.existing;
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
    // Fournisseur au-dessus du rail : le fil doit survivre au démontage du
    // panneau Procédure. Au guichet, la cible est la DÉMARCHE seule — aucune
    // saisie en cours ne part chez le fournisseur (décision PO).
    <AssistantThreadProvider
      target={procedureId && orgId
        ? { kind: "procedure", organizationId: orgId, socleProcedureId: procedureId }
        : null}
    >
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">Nouvelle demande</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {imposedContactId
                ? `Consignée pour ${requesterName ?? imposedName ?? "l'usager de la fiche"} — usager imposé, brouillon enregistré sur ce poste`
                : "Consignée pour le compte d'un usager — brouillon enregistré en continu sur ce poste"}
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
            canAdvance={canAdvance}
            onGo={(n) => {
              // FRANCHIR depuis la puce, c'est le même geste que « Continuer » :
              // même validation du formulaire, même suivi de progression. Deux
              // chemins vers l'étape suivante, dont un sans contrôle, serait la
              // porte à côté de la serrure.
              if (n > maxReached) { next(); return; }
              setStep(n);
              setError(null);
            }}
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

          {/* Étapes 0 et 1 partagent la proposition de reprise : un brouillon
              en attente doit se voir AVANT qu'on réponde à une question qu'il
              écrasera — l'organisme repris est celui du brouillon. */}
          {step <= 1 ? (
            <div className="flex flex-col gap-4">
              {existingDraft ? (
                <div className="flex max-w-[1240px] flex-wrap items-center justify-between gap-3 rounded-[14px] border border-primary/30 bg-primary/[0.04] px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold">Un brouillon est en attente sur ce poste</span>
                    <span className="text-xs text-muted-foreground">
                      Enregistré le {draftDateLabel(existingDraft.savedAt)} — {existingDraftName ?? "démarche à recharger"},
                      étape « {steps.find((s) => s.num === existingDraft.step)?.label ?? "Démarche"} ».
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
              {step === 0 ? (
                <OrganismePicker choices={orgChoices} value={destinationId} onChange={chooseOrganisme} />
              ) : (
                <ProcedurePicker
                  rows={creatableRows}
                  loading={procRows.isLoading}
                  counts={monthlyCounts.data}
                  selectedId={procedureId}
                  loadingId={loadingId}
                  scopeLabel={needsOrgStep ? destinationLabel : null}
                  onSelect={(id) => void selectProcedure(id)}
                  onOpenFiche={setFicheRow}
                />
              )}
            </div>
          ) : null}

          {step === 2 && procedure ? (
            <RequesterIdentification
              organizationId={orgId}
              requesterConfig={procedure.snapshot.requester_config}
              resolution={resolution}
              onResolve={onResolve}
              locked={Boolean(imposedContactId)}
              lockedMessage={imposedMessage}
              lockedAction={
                // Impasse (fiche illisible, public non proposé) : on ne laisse
                // pas le parcours sans issue — l'agent peut désigner l'usager
                // lui-même, en connaissance de cause.
                imposedMessage !== null && !imposedContact.isLoading ? (
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setSearchParams({}, { replace: true })}>
                    Désigner l'usager moi-même
                  </Button>
                ) : null
              }
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
              destination={{ value: destinationId, options: destinationOptions, onChange: setDestinationId }}
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
              consents={consents}
              onToggleConsent={(kind, granted) => setConsents((c) => ({ ...c, [kind]: granted }))}
              organismName={current.organizationName}
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
          procedure={railProcedure}
          onOpenDocument={(doc) => void openKnowledgeDocument(doc)}
          openingDocument={documentUrl.isPending ? documentUrl.variables?.path ?? null : null}
          documentError={documentError}
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
            disabled={step === firstStep || create.isPending}
            className={cn(step === firstStep && "invisible")}>
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
              <Button type="button" variant="outline"
                disabled={create.isPending || destinationMissing(destinationId) || consentsMissing}
                onClick={() => void submit(true)}>
                Créer et imprimer
              </Button>
              <Button type="button"
                disabled={create.isPending || destinationMissing(destinationId) || consentsMissing}
                onClick={() => void submit(false)}>
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

      {/* Sous le fournisseur de la page : quand la démarche consultée est la
          démarche choisie, la fiche reprend le fil du rail au lieu d'en
          ouvrir un second. */}
      <FicheDemarcheDialog
        organizationId={orgId}
        row={ficheRow}
        onClose={() => setFicheRow(null)}
        chosen={ficheRow?.socle_id === procedureId}
        shareThread={ficheRow !== null && ficheRow.socle_id === procedureId}
        onChoose={(id) => {
          setFicheRow(null);
          void selectProcedure(id);
        }}
      />
    </div>
    </AssistantThreadProvider>
  );
}
