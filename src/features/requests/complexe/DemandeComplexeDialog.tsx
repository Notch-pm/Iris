// « Demande complexe » — saisie relayée à Clara pour analyse (2026-10-10).
//
// Action SECONDAIRE de création, à côté de « Nouvelle demande » : l'agent a
// devant lui une demande qu'il ne sait pas rattacher à une démarche — un texte,
// des pièces. Iris ne la conserve pas (aucune demande libre, invariant) : elle
// devient un courrier de Clara, canal « Relayé agent », où l'analyse IA la
// qualifie et l'oriente.
//
// L'écran reprend le « Nouveau courrier » de Clara (`NewCourierDialog`) :
// fenêtre large en deux étapes, onglets Importer des fichiers / Coller un texte,
// zone de dépôt avec aperçu. Ce que Clara demande à l'étape 2 (titre,
// canal, tags, organisation gestionnaire…) est le métier de Clara, fait par son
// analyse à réception : Iris demande à la place l'ORGANISME destinataire,
// l'USAGER (fiche du Socle, comme au guichet) et ses CONSENTEMENTS.
//
// Pas de dictée pour l'instant (décision PO 2026-10-10 : masquée, pas grisée) —
// Clara n'affiche pas non plus l'onglet quand la dictée n'est pas ouverte. Elle
// viendrait par le guichet IA du Socle (`/v1/transcriptions`), comme dans Clara.

import * as React from "react";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, FileText, FileUp, Info, Loader2, Send, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTenant } from "@/features/tenant/TenantProvider";
import { RequesterIdentification } from "@/features/contacts/RequesterIdentification";
import type { RequesterResolution } from "@/features/contacts/rapprochement";
import { ConsentGroup } from "@/features/requests/creation/RequestSummary";
import {
  consentsSatisfied,
  defaultConsentAnswers,
  type ConsentKind,
} from "@fn/_shared/consents/catalog";
import {
  RELAY_MAX_FILE_BYTES,
  RELAY_MAX_FILES,
  RELAY_REQUESTER_CONFIG,
  relayContentError,
  type RelayRequester,
} from "@fn/_shared/clara/relay";
import { ACCEPTED_FORMATS_LABEL, acceptAttribute } from "@fn/_shared/files/magic";
import { useRelayOrganisations, useRelayToClara, type RelayResult } from "./useRelayToClara";

type Mode = "files" | "paste";
type Step = "import" | "envoi" | "transmise";

const MAX_MIB = RELAY_MAX_FILE_BYTES / 1_048_576;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} Mo`;
}

/** L'usager désigné, sous la forme que le serveur accepte (fiche du Socle relue là-bas). */
function relayRequesterOf(resolution: RequesterResolution | null): RelayRequester | null {
  if (!resolution) return null;
  if (resolution.kind === "contact") return { kind: "contact", socle_contact_id: resolution.contact.id };
  if (resolution.kind === "sans_rapprochement") {
    return { kind: "sans_rapprochement", audience: resolution.audience, declared: resolution.declared };
  }
  return null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DemandeComplexeDialog({ open, onOpenChange }: Props) {
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const { organisations } = useRelayOrganisations();
  const relay = useRelayToClara();

  const [step, setStep] = React.useState<Step>("import");
  const [mode, setMode] = React.useState<Mode>("files");
  const [files, setFiles] = React.useState<File[]>([]);
  const [text, setText] = React.useState("");
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [organisationId, setOrganisationId] = React.useState("");
  const [resolution, setResolution] = React.useState<RequesterResolution | null>(null);
  const [consents, setConsents] = React.useState<Record<ConsentKind, boolean>>(defaultConsentAnswers);
  // Tiré à l'ouverture et CONSERVÉ entre deux tentatives : un rejeu (réseau,
  // double clic) rend le même courrier dans Clara, jamais un second.
  const [submissionId, setSubmissionId] = React.useState(() => crypto.randomUUID());
  const [result, setResult] = React.useState<RelayResult | null>(null);

  const reset = React.useCallback(() => {
    setStep("import");
    setMode("files");
    setFiles([]);
    setText("");
    setFileError(null);
    setOrganisationId("");
    setResolution(null);
    setConsents(defaultConsentAnswers());
    setSubmissionId(crypto.randomUUID());
    setResult(null);
    relay.reset();
  }, [relay]);

  // Un seul organisme possible : retenu d'office, la question ne se pose pas.
  const soleOrganisation = organisations.length === 1 ? organisations[0] : null;
  const chosenOrganisationId = soleOrganisation?.id ?? organisationId;

  const contentError = relayContentError(text, files);
  const requester = relayRequesterOf(resolution);
  const missing = !chosenOrganisationId
    ? "Choisissez l'organisme destinataire."
    : !requester
      ? "Désignez l'usager."
      : !consentsSatisfied(consents)
        ? "Le consentement au traitement des informations est obligatoire."
        : null;

  function handleOpenChange(next: boolean) {
    if (relay.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  function addFiles(list: FileList | File[]) {
    // Un même fichier redéposé (glisser puis « Parcourir », double événement)
    // ne part qu'une fois.
    const keyOf = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const known = new Set(files.map(keyOf));
    const incoming = Array.from(list).filter((f) => {
      if (known.has(keyOf(f))) return false;
      known.add(keyOf(f));
      return true;
    });
    const tooBig = incoming.filter((f) => f.size > RELAY_MAX_FILE_BYTES);
    const kept = incoming.filter((f) => f.size <= RELAY_MAX_FILE_BYTES);
    const next = [...files, ...kept].slice(0, RELAY_MAX_FILES);
    const dropped = files.length + kept.length - next.length;
    setFiles(next);
    setFileError(
      tooBig.length > 0
        ? `${tooBig.length} fichier${tooBig.length > 1 ? "s dépassent" : " dépasse"} ${MAX_MIB} Mo : ${tooBig.map((f) => f.name).join(", ")}`
        : dropped > 0
          ? `${RELAY_MAX_FILES} fichiers au plus : ${dropped} non ajouté${dropped > 1 ? "s" : ""}.`
          : null,
    );
  }

  function submit() {
    if (!requester || !chosenOrganisationId || contentError) return;
    relay.mutate(
      { submissionId, socleOrganizationId: chosenOrganisationId, body: text, files, requester, consents },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep("transmise");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Demande complexe</DialogTitle>
          <DialogDescription>
            {step === "import"
              ? "Étape 1/2 — Importez un fichier ou collez le contenu de la demande."
              : step === "envoi"
                ? "Étape 2/2 — Désignez l'organisme et l'usager, puis transmettez la demande à Clara."
                : "La demande a été transmise à Clara."}
          </DialogDescription>
        </DialogHeader>

        {step === "import" ? (
          <>
            <ModeTabs mode={mode} onMode={setMode} files={files.length} hasText={text.trim() !== ""} />
            <div className="mt-3">
              {mode === "files" ? (
                <FilesPanel files={files} onAdd={addFiles} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} error={fileError} />
              ) : (
                <Textarea
                  aria-label="Contenu de la demande"
                  placeholder="Collez ici le contenu de la demande…"
                  rows={12}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-[280px] resize-y"
                />
              )}
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              Iris ne conserve pas cette demande : elle est transmise à Clara (canal « Relayé agent »), qui
              l'analyse et l'oriente. Pour une demande qui relève d'une démarche, utilisez « Nouvelle demande ».
            </p>
            <DialogFooter className="mt-4 sm:justify-between">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Annuler</Button>
              <Button onClick={() => setStep("envoi")} disabled={contentError !== null} title={contentError ?? undefined}>
                Continuer
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {step === "envoi" ? (
          <>
            <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="flex flex-col gap-4">
                <ContentRecap files={files} text={text} onEdit={() => setStep("import")} />
                {soleOrganisation ? (
                  <Field label="Organisme destinataire">
                    <p className="text-sm font-semibold">{soleOrganisation.label}</p>
                  </Field>
                ) : (
                  <Field label="Organisme destinataire" htmlFor="complexe-organisme" required>
                    <Select
                      id="complexe-organisme"
                      value={organisationId}
                      onChange={(e) => setOrganisationId(e.target.value)}
                    >
                      <option value="">Choisir un organisme…</option>
                      {organisations.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                  </Field>
                )}
                <ConsentGroup
                  consents={consents}
                  onToggle={(kind, granted) => setConsents((c) => ({ ...c, [kind]: granted }))}
                  organismName={current?.organizationName ?? null}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-sm font-bold">Usager</h3>
                <RequesterIdentification
                  organizationId={orgId}
                  requesterConfig={RELAY_REQUESTER_CONFIG}
                  resolution={resolution}
                  onResolve={setResolution}
                />
              </div>
            </div>
            {relay.error ? (
              <p role="alert" className="mt-4 text-sm font-semibold text-destructive">{relay.error.message}</p>
            ) : null}
            <DialogFooter className="mt-6 sm:justify-between">
              <Button variant="outline" onClick={() => setStep("import")} disabled={relay.isPending}>
                <ArrowLeft aria-hidden="true" /> Retour
              </Button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {missing ? <span className="text-xs text-muted-foreground">{missing}</span> : null}
                <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={relay.isPending}>
                  Annuler
                </Button>
                <Button onClick={submit} disabled={missing !== null || relay.isPending}>
                  {relay.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                  {relay.isPending ? "Transmission…" : "Transmettre à Clara"}
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}

        {step === "transmise" && result ? (
          <>
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Check className="size-6" aria-hidden="true" />
              </span>
              <p className="text-base font-bold">
                {result.duplicate ? "Cette demande avait déjà été transmise à Clara" : "Demande transmise à Clara"}
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                Elle arrive dans le courrier entrant de {result.organisme}, canal « Relayé agent ». Clara l'analyse et
                l'oriente ; Iris n'en garde pas de copie.
              </p>
              {result.reference ? (
                <p className="text-sm">
                  Référence du courrier : <span className="font-mono font-semibold">{result.reference}</span>
                </p>
              ) : null}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="outline" onClick={reset}>Saisir une autre demande complexe</Button>
              <Button onClick={() => handleOpenChange(false)}>Fermer</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ModeTabs({ mode, onMode, files, hasText }: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  files: number;
  hasText: boolean;
}) {
  const tab = (value: Mode, label: string, filled: boolean) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => onMode(value)}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] px-3 text-sm font-semibold transition-colors",
        mode === value ? "bg-card text-foreground shadow-airbnb-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {filled ? <span className="size-1.5 rounded-full bg-primary" aria-label="(rempli)" /> : null}
    </button>
  );
  return (
    <div role="tablist" aria-label="Mode de saisie" className="grid w-full grid-cols-2 gap-1 rounded-[10px] bg-muted p-1">
      {tab("files", files > 0 ? `Importer des fichiers (${files})` : "Importer des fichiers", false)}
      {tab("paste", "Coller un texte", hasText)}
    </div>
  );
}

function FilesPanel({ files, onAdd, onRemove, error }: {
  files: File[];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (index: number) => void;
  error: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const shown = files[Math.min(index, files.length - 1)];
  const url = React.useMemo(() => (shown ? URL.createObjectURL(shown) : null), [shown]);
  React.useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) onAdd(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-lg border-2 border-dashed text-center transition-colors",
          files.length === 0 ? "p-10" : "px-4 py-3",
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50",
        )}
      >
        {files.length === 0 ? (
          <Upload className="mx-auto mb-3 size-10 text-muted-foreground/50" aria-hidden="true" />
        ) : null}
        <p className="text-sm text-muted-foreground">
          {files.length === 0 ? "Glissez-déposez vos fichiers ici ou" : "Ajouter d'autres fichiers ou"}{" "}
          <Button type="button" variant="outline" size="sm" className="ml-1" onClick={() => inputRef.current?.click()}>
            <FileUp aria-hidden="true" /> Parcourir
          </Button>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {RELAY_MAX_FILES} fichiers au plus, {MAX_MIB} Mo par fichier — {ACCEPTED_FORMATS_LABEL}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptAttribute()}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onAdd(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-destructive">{error}</p> : null}

      {shown && url ? (
        <div className="relative flex h-[260px] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
          {shown.type.startsWith("image/") ? (
            <img src={url} alt={`Aperçu de ${shown.name}`} className="max-h-full max-w-full object-contain" />
          ) : shown.type === "application/pdf" ? (
            <iframe src={url} title={`Aperçu de ${shown.name}`} className="size-full" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <FileText className="size-10" aria-hidden="true" />
              <span className="text-sm">Aperçu non disponible</span>
            </div>
          )}
          {files.length > 1 ? (
            <>
              <Button
                type="button" variant="outline" size="sm"
                className="absolute left-2 top-1/2 size-8 -translate-y-1/2 rounded-full p-0"
                onClick={() => setIndex((i) => (i - 1 + files.length) % files.length)}
                aria-label="Fichier précédent"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button" variant="outline" size="sm"
                className="absolute right-2 top-1/2 size-8 -translate-y-1/2 rounded-full p-0"
                onClick={() => setIndex((i) => (i + 1) % files.length)}
                aria-label="Fichier suivant"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
              <span className="absolute bottom-2 rounded-full bg-card px-2 py-0.5 text-xs font-semibold shadow-airbnb-sm">
                {Math.min(index, files.length - 1) + 1} / {files.length}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex max-h-[160px] flex-col gap-1 overflow-y-auto">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                i === Math.min(index, files.length - 1) ? "bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setIndex(i)}>
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size)}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onRemove(i);
                  setIndex(0);
                }}
                aria-label={`Retirer ${file.name}`}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ContentRecap({ files, text, onEdit }: { files: File[]; text: string; onEdit: () => void }) {
  const trimmed = text.trim();
  return (
    <section className="flex flex-col gap-2 rounded-[14px] border border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Contenu transmis</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>Modifier</Button>
      </div>
      {files.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{f.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {trimmed ? (
        <p className="line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{trimmed}</p>
      ) : null}
    </section>
  );
}
