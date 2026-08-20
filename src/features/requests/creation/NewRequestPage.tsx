// Parcours de création d'une demande — piloté EXCLUSIVEMENT par une démarche
// Socle active du tenant (règle non négociable : aucune demande libre).
// Étapes : démarche → destinataire → demandeur (feature contacts) →
// formulaire (form_schema + requester_config) → récapitulatif → création via
// l'edge function create-request-from-procedure (revalidation + écriture
// atomique côté serveur — le navigateur ne fournit jamais de snapshot).

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTenant } from "@/features/tenant/TenantProvider";
import {
  fetchProcedureSnapshot,
  useSocleOrganizationsCatalog,
  useSocleProceduresCatalog,
  type ProcedureSnapshot,
} from "@/features/socle/useSocleCatalog";
import { RequesterIdentification } from "@/features/contacts/RequesterIdentification";
import { resolutionSummary, type RequesterResolution } from "@/features/contacts/rapprochement";
import { PRIORITY_LABELS } from "../statuts";
import { ProcedureFormFields } from "./ProcedureFormFields";
import { useCreateFromProcedure } from "./useCreateFromProcedure";
import type { EdgeError } from "@/lib/edge";
import {
  dataKey,
  fieldIsVisible,
  flatFields,
  parseFormSchema,
  validateFormSubmission,
  type Field as SchemaField,
  type FormSchema,
  type FormValues,
  type RequesterSubmission,
} from "@fn/create-request-from-procedure/_shared/procedureForm";

const STEPS = ["Démarche", "Destinataire", "Demandeur", "Formulaire", "Récapitulatif"] as const;

interface LoadedProcedure {
  snapshot: ProcedureSnapshot;
  schema: FormSchema;
}

function displayValue(field: SchemaField, value: unknown): string {
  if (field.type === "boolean") return value === true ? "Oui" : "Non";
  if (field.type === "select" || field.type === "radio") {
    return field.options.find((o) => o.value === value)?.label ?? String(value);
  }
  if (field.type === "checkboxes" && Array.isArray(value)) {
    return value
      .map((v) => field.options.find((o) => o.value === v)?.label ?? String(v))
      .join(", ");
  }
  return String(value);
}

export function NewRequestPage() {
  const { current } = useTenant();
  const navigate = useNavigate();
  const orgId = current?.organizationId ?? "";
  const procCatalog = useSocleProceduresCatalog(orgId);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const create = useCreateFromProcedure();

  const [step, setStep] = React.useState(0);
  const [procedureId, setProcedureId] = React.useState("");
  const [procedure, setProcedure] = React.useState<LoadedProcedure | null>(null);
  const [loadingProcedure, setLoadingProcedure] = React.useState(false);
  const [destinationId, setDestinationId] = React.useState("");
  const [resolution, setResolution] = React.useState<RequesterResolution | null>(null);
  const [subject, setSubject] = React.useState("");
  const [bodyText, setBodyText] = React.useState("");
  const [priority, setPriority] = React.useState("normale");
  const [values, setValues] = React.useState<FormValues>({});
  const [files, setFiles] = React.useState<Record<string, File[]>>({});
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const draftIdRef = React.useRef<string>(crypto.randomUUID());

  if (!current) return null;

  const setValue = (fieldId: string, value: unknown) =>
    setValues((v) => ({ ...v, [fieldId]: value }));
  const setFieldFiles = (fieldId: string, next: File[]) =>
    setFiles((f) => ({ ...f, [fieldId]: next }));

  /** Déclarations de pièces pour la validation de confort (chemins fictifs). */
  function draftAttachmentDeclarations(schema: FormSchema) {
    const out = [];
    for (const entry of flatFields(schema)) {
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

  async function nextFromProcedure() {
    setError(null);
    if (procedureId === "") {
      setError("Sélectionnez une démarche Socle — toute demande en exige une.");
      return;
    }
    setLoadingProcedure(true);
    try {
      const snapshot = await fetchProcedureSnapshot(orgId, procedureId);
      if (!snapshot) {
        setError("La démarche n'a pas pu être chargée depuis le Socle — réessayez dans un instant.");
        return;
      }
      const schema = parseFormSchema(snapshot.form_schema);
      setProcedure({ snapshot, schema });
      if (subject.trim() === "") setSubject(snapshot.name);
      // Destinataire pré-rempli quand la démarche désigne une organisation du miroir.
      if (destinationId === "" && snapshot.organization_id
          && (orgCatalog.data ?? []).some((o) => o.value === snapshot.organization_id)) {
        setDestinationId(snapshot.organization_id);
      }
      setStep(1);
    } finally {
      setLoadingProcedure(false);
    }
  }

  function nextFromForm() {
    if (!procedure) return;
    setError(null);
    if (subject.trim() === "") {
      setError("L'objet de la demande est obligatoire.");
      return;
    }
    const result = validateFormSubmission(procedure.schema, values, draftAttachmentDeclarations(procedure.schema));
    setFieldErrors(result.errors);
    if (!result.ok) {
      setError("Corrigez les champs signalés avant de poursuivre.");
      return;
    }
    setStep(4);
  }

  async function submit() {
    if (!procedure || !resolution) return;
    setError(null);
    const requester: RequesterSubmission = resolution.kind === "contact"
      ? { kind: "contact", audience: resolution.audience, socle_contact_id: resolution.contact.id }
      : resolution.kind === "sans_rapprochement"
        ? { kind: "sans_rapprochement", audience: resolution.audience, declared: resolution.declared }
        : { kind: "anonyme" };
    try {
      const created = await create.mutateAsync({
        organizationId: orgId,
        draftRequestId: draftIdRef.current,
        procedureId,
        subject,
        body: bodyText,
        priority,
        destinationId: destinationId === "" ? null : destinationId,
        requester,
        schema: procedure.schema,
        values,
        files,
      });
      navigate(`/demandes/${created.id}`);
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

  const visibleAnswers = procedure
    ? flatFields(procedure.schema)
        .filter((entry) => entry.field.type !== "attachment" && fieldIsVisible(entry, values))
        .map((entry) => ({ field: entry.field, value: values[entry.field.id] }))
        .filter(({ value }) => value !== undefined && value !== "" && value !== null)
    : [];
  const chosenFiles = procedure
    ? flatFields(procedure.schema)
        .filter((entry) => entry.field.type === "attachment")
        .flatMap((entry) => (files[entry.field.id] ?? []).map((f) => ({
          label: entry.field.label, name: f.name,
        })))
    : [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/demandes"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Demandes
        </Link>
        <h1 className="text-2xl font-bold">Nouvelle demande</h1>
        <p className="text-sm text-muted-foreground">
          Toute demande est fondée sur une démarche Socle active du tenant.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2" aria-label="Étapes">
        {STEPS.map((title, i) => (
          <li key={title}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              i === step ? "border-primary bg-primary text-primary-foreground"
              : i < step ? "border-primary/40 text-primary"
              : "border-border text-muted-foreground"}`}
            aria-current={i === step ? "step" : undefined}>
            {i + 1}. {title}
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-border bg-card p-4 shadow-iris-sm">
        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <Field label="Démarche Socle" htmlFor="nw-procedure" required
              hint={(procCatalog.data ?? []).length === 0
                ? "Aucune démarche active pour ce tenant — le référentiel Socle doit être synchronisé."
                : "Le formulaire et les informations demandeur découlent de la démarche."}>
              <Select id="nw-procedure" value={procedureId}
                disabled={(procCatalog.data ?? []).length === 0}
                onChange={(e) => { setProcedureId(e.target.value); setProcedure(null); }}>
                <option value="">— Sélectionner une démarche —</option>
                {(procCatalog.data ?? []).map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
            </Field>
            <div>
              <Button type="button" onClick={nextFromProcedure}
                disabled={loadingProcedure || (procCatalog.data ?? []).length === 0}>
                {loadingProcedure ? "Chargement de la démarche…" : "Continuer"}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <Field label="Organisation Socle destinataire" htmlFor="nw-destination"
              hint="Pré-remplie lorsque la démarche désigne une organisation ; sinon « À affecter ».">
              <Select id="nw-destination" value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}>
                <option value="">— À affecter —</option>
                {(orgCatalog.data ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>Retour</Button>
              <Button type="button" onClick={() => setStep(2)}>Continuer</Button>
            </div>
          </div>
        ) : null}

        {step === 2 && procedure ? (
          <div className="flex flex-col gap-4">
            <RequesterIdentification
              organizationId={orgId}
              requesterConfig={procedure.snapshot.requester_config}
              resolution={resolution}
              onResolve={setResolution}
            />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>Retour</Button>
              <Button type="button" disabled={!resolution} onClick={() => setStep(3)}>
                Continuer
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 && procedure ? (
          <div className="flex flex-col gap-4">
            <Field label="Objet" htmlFor="nw-subject" required>
              <Input id="nw-subject" value={subject}
                onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priorité" htmlFor="nw-priority">
                <Select id="nw-priority" value={priority}
                  onChange={(e) => setPriority(e.target.value)}>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description" htmlFor="nw-body">
              <Textarea id="nw-body" value={bodyText}
                onChange={(e) => setBodyText(e.target.value)} />
            </Field>
            <ProcedureFormFields schema={procedure.schema} values={values} onChange={setValue}
              files={files} onFilesChange={setFieldFiles} errors={fieldErrors} />
            {fieldErrors["_attachments"] ? (
              <p className="text-sm text-destructive">{fieldErrors["_attachments"]}</p>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep(2)}>Retour</Button>
              <Button type="button" onClick={nextFromForm}>Continuer</Button>
            </div>
          </div>
        ) : null}

        {step === 4 && procedure && resolution ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Récapitulatif</h2>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Démarche</dt>
              <dd className="font-medium">{procedure.snapshot.name}</dd>
              <dt className="text-muted-foreground">Destinataire</dt>
              <dd>{(orgCatalog.data ?? []).find((o) => o.value === destinationId)?.label ?? "À affecter"}</dd>
              <dt className="text-muted-foreground">Demandeur</dt>
              <dd>{resolutionSummary(resolution)}</dd>
              <dt className="text-muted-foreground">Objet</dt>
              <dd>{subject}</dd>
              <dt className="text-muted-foreground">Priorité</dt>
              <dd>{PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] ?? priority}</dd>
              {bodyText.trim() !== "" ? (
                <>
                  <dt className="text-muted-foreground">Description</dt>
                  <dd className="whitespace-pre-wrap">{bodyText}</dd>
                </>
              ) : null}
            </dl>
            {visibleAnswers.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Réponses au formulaire</h3>
                <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
                  {visibleAnswers.map(({ field, value }) => (
                    <React.Fragment key={field.id}>
                      <dt className="text-muted-foreground">{field.label}</dt>
                      <dd>{displayValue(field, value)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            ) : null}
            {chosenFiles.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Pièces justificatives</h3>
                <ul className="text-sm">
                  {chosenFiles.map((f, i) => (
                    <li key={i}>{f.label} — {f.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" disabled={create.isPending}
                onClick={() => setStep(3)}>
                Retour
              </Button>
              <Button type="button" disabled={create.isPending} onClick={submit}>
                {create.isPending ? "Création…" : "Créer la demande"}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
