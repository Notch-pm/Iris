// Étape « Usager » : identification du demandeur auprès du référentiel
// Socle. L'agent renseigne l'identité ; les homonymes du Socle sont recherchés
// AUTOMATIQUEMENT au fil de la saisie (débounce) et proposés — le choix d'un
// candidat reste un geste explicite (clic sur la fiche), jamais une sélection
// automatique.
//
// ⚠️ SANS CORRESPONDANCE, C'EST UNE NOUVELLE PERSONNE — ON LA CRÉE DANS LE
// SOCLE (décision PO du 2026-08-26). « Poursuivre sans rapprochement » n'existe
// plus dans le parcours normal : une demande instruite pendant des semaines
// contre une identité qui n'est nulle part dans le référentiel n'est
// rattrapable par personne. La création rejoue l'anti-doublon juste avant
// d'écrire.
//
// La SEULE exception est une panne AVÉRÉE du Socle (`isSocleOutage`) : l'agent
// a un usager en face de lui, on ne le renvoie pas chez lui. La demande part
// alors en `non_rapprochee`, et le serveur pose l'anomalie
// `usager_a_creer_dans_socle` pour qu'elle soit réconciliée plus tard.
// Les champs proposés et l'anonymat sont gouvernés par le requester_config de
// la démarche (masqué / visible / obligatoire).

import * as React from "react";
import { ArrowLeft, Loader2, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AddressField } from "@/components/address/AddressField";
import { cn } from "@/lib/utils";
import {
  allowsAnonymous,
  parseRequesterConfig,
  sanitizeDeclared,
  selectableAudiences,
  validateRequesterSubmission,
  visibleRequesterFields,
  type Audience,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import {
  buildContactCreatePayload,
  candidateSummary,
  duplicateCheckIdentity,
  EMPTY_NEW_CONTACT,
  declaredFromNewContact,
  isNameOnlyMatch,
  isSocleOutage,
  liveSearchIdentity,
  newContactFromDeclared,
  reasonLabel,
  type MatchCandidate,
  type MatchIdentity,
  type NewContactForm,
  type RequesterResolution,
  type SocleContact,
} from "./rapprochement";
import { useCreateContact, useMatchContacts } from "./useContacts";

const AUDIENCE_LABELS: Record<Audience, string> = {
  citoyen: "Citoyen", entreprise: "Entreprise", association: "Association",
};

/** Raisons qui reposent sur un identifiant fort (jamais le seul nom). */
const STRONG_REASONS = new Set(["email_exact", "phone_exact", "siret_exact", "birth_date_match"]);

/** Délai après la dernière frappe avant d'interroger le Socle. */
const LIVE_SEARCH_DELAY_MS = 450;

interface Props {
  organizationId: string;
  /** requester_config brut de la démarche (snapshot socle-proxy). */
  requesterConfig: unknown;
  resolution: RequesterResolution | null;
  onResolve: (resolution: RequesterResolution | null) => void;
  /**
   * Usager IMPOSÉ par le point d'entrée (création depuis la fiche usager) :
   * l'identité est affichée telle quelle, sans recherche ni « Modifier ».
   * `lockedMessage` explique pourquoi rien n'est proposé quand la démarche
   * n'accepte pas ce public (ou que la fiche n'a pas pu être relue).
   */
  locked?: boolean;
  lockedMessage?: string | null;
  /** Sortie de secours proposée quand l'usager imposé est inutilisable. */
  lockedAction?: React.ReactNode;
}

function initialsOf(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
}

function CandidateRow({ candidate, maxScore, onPick }: {
  candidate: MatchCandidate;
  maxScore: number;
  onPick: () => void;
}) {
  const { contact, score, reasons } = candidate;
  const summary = candidateSummary(contact);
  const nameOnly = isNameOnlyMatch(reasons);
  const strong = !nameOnly && reasons.some((r) => STRONG_REASONS.has(r));
  // Le score Socle est un classement relatif à la réponse : la barre compare
  // les candidats entre eux, jamais à un seuil absolu.
  const ratio = maxScore > 0 ? Math.max(0.08, Math.min(1, score / maxScore)) : 0;
  const tone = strong ? "text-primary" : nameOnly ? "text-secondary-foreground" : "text-foreground";
  const bar = strong ? "bg-primary" : nameOnly ? "bg-secondary" : "bg-muted-foreground/60";

  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex w-full items-center justify-between gap-3.5 rounded-[14px] border border-border bg-card px-4 py-3 text-left shadow-airbnb-sm transition-all hover:border-primary hover:shadow-airbnb-md"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
            strong ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          )}
          aria-hidden="true"
        >
          {initialsOf(summary.title)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold leading-tight">{summary.title}</span>
            {nameOnly ? (
              <span className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[10px] font-bold leading-none text-secondary-foreground">
                Nom seul — à vérifier
              </span>
            ) : strong ? (
              <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary">
                Correspondance forte
              </span>
            ) : null}
          </span>
          {summary.details.length > 0 ? (
            <span className="text-xs text-muted-foreground">{summary.details.join(" · ")}</span>
          ) : null}
          {reasons.length > 0 ? (
            <span className="text-[11px] text-muted-foreground">{reasons.map(reasonLabel).join(" · ")}</span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-4">
        <span className="flex flex-col items-end gap-1.5">
          <span className={cn("text-[15px] font-extrabold leading-none tabular-nums", tone)}>{score}</span>
          <span className="block h-[5px] w-[88px] overflow-hidden rounded-full bg-muted">
            <span className={cn("block h-full rounded-full", bar)} style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
          <span className="text-[10px] text-muted-foreground">classement Socle</span>
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[10.5px] font-bold text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          Choisir
        </span>
      </span>
    </button>
  );
}

function CandidateList({ candidates, onPick }: {
  candidates: MatchCandidate[];
  onPick: (contact: SocleContact) => void;
}) {
  const maxScore = Math.max(0, ...candidates.map((c) => c.score));
  return (
    <div role="list" aria-label="Usagers correspondants" className="flex flex-col gap-2.5">
      {candidates.map((c) => (
        <div role="listitem" key={c.contact.id}>
          <CandidateRow candidate={c} maxScore={maxScore} onPick={() => onPick(c.contact)} />
        </div>
      ))}
    </div>
  );
}

export function RequesterIdentification({
  organizationId, requesterConfig, resolution, onResolve,
  locked = false, lockedMessage = null, lockedAction = null,
}: Props) {
  const config = React.useMemo(() => parseRequesterConfig(requesterConfig), [requesterConfig]);
  const audiences = selectableAudiences(config);
  const anonymousAllowed = allowsAnonymous(requesterConfig);

  const [audience, setAudience] = React.useState<Audience>(audiences[0]);
  const [declared, setDeclared] = React.useState<Record<string, string>>({});
  const [matches, setMatches] = React.useState<MatchCandidate[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"recherche" | "creation">("recherche");
  const [createForm, setCreateForm] = React.useState<NewContactForm>(EMPTY_NEW_CONTACT);
  const [duplicates, setDuplicates] = React.useState<MatchCandidate[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** Message d'une panne AVÉRÉE du Socle — la seule sortie de secours. */
  const [socleDown, setSocleDown] = React.useState<string | null>(null);
  const searchSeq = React.useRef(0);

  const { mutateAsync: runMatch } = useMatchContacts();
  const create = useCreateContact();

  const fields = visibleRequesterFields(config, audience);
  const setD = (key: string, value: string) => setDeclared((d) => ({ ...d, [key]: value }));
  const setC = <K extends keyof NewContactForm>(key: K, value: string) =>
    setCreateForm((f) => ({ ...f, [key]: value }));

  // Recherche d'homonymes au fil de la saisie : débounce, réponses périmées
  // ignorées (compteur), silence tant qu'aucun discriminant n'est saisi.
  const liveIdentity = liveSearchIdentity(audience, declared);
  const liveSignature = liveIdentity ? JSON.stringify(liveIdentity) : "";
  React.useEffect(() => {
    if (mode !== "recherche" || liveSignature === "") {
      searchSeq.current += 1;
      setMatches(null);
      setSearching(false);
      return;
    }
    const identity = JSON.parse(liveSignature) as MatchIdentity;
    const id = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      runMatch({ organizationId, identity })
        .then((found) => {
          if (searchSeq.current !== id) return;
          setMatches(found);
          setSearchError(null);
        })
        .catch((err) => {
          if (searchSeq.current !== id) return;
          setMatches(null);
          setSearchError(err instanceof Error ? err.message : "Recherche impossible.");
        })
        .finally(() => {
          if (searchSeq.current === id) setSearching(false);
        });
    }, LIVE_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [liveSignature, mode, organizationId, runMatch]);

  function switchAudience(next: Audience) {
    setAudience(next);
    setError(null);
  }

  function resolveContact(contact: SocleContact) {
    onResolve({ kind: "contact", audience, contact });
  }

  /**
   * Sortie de secours, atteignable UNIQUEMENT depuis le panneau de panne. On
   * repart du formulaire de CRÉATION (`declaredFromNewContact`) : c'est la
   * saisie la plus complète et la plus récente de l'agent — celle du
   * formulaire de recherche est déjà périmée à ce stade.
   */
  function proceedWithoutMatch() {
    setError(null);
    const submission = {
      kind: "sans_rapprochement" as const,
      audience,
      declared: sanitizeDeclared(audience, {
        ...declared,
        ...declaredFromNewContact(createForm),
      }),
    };
    const check = validateRequesterSubmission(requesterConfig, submission);
    if (!check.ok) { setError(check.message); return; }
    onResolve(submission);
  }

  // Panne AVÉRÉE du Socle : le message est conservé pour l'afficher tel quel,
  // et c'est la seule chose qui rouvre « Poursuivre sans rapprochement ».
  function openCreate() {
    setError(null);
    setSocleDown(null);
    setDuplicates(null);
    setCreateForm(newContactFromDeclared(declared));
    setMode("creation");
  }

  async function submitCreate(ignoreDuplicates: boolean) {
    setError(null);
    setSocleDown(null);
    const payload = buildContactCreatePayload(audience, createForm);
    if (!payload.ok) { setError(payload.message); return; }
    try {
      if (!ignoreDuplicates) {
        // Rejeu du rapprochement JUSTE avant la création : signaler un doublon
        // potentiel tant que l'agent ne l'a pas explicitement écarté.
        const check = duplicateCheckIdentity(audience, createForm);
        if (check.ok) {
          const found = await runMatch({ organizationId, identity: check.identity });
          if (found.length > 0) {
            setDuplicates(found);
            return;
          }
        }
      }
      const contact = await create.mutateAsync({ organizationId, contact: payload.payload });
      resolveContact(contact);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Création impossible.";
      // Un REFUS du Socle (SIRET déjà pris, invariant de type) se corrige dans
      // le formulaire ; une PANNE ne se corrige pas — elle seule ouvre la
      // sortie de secours.
      if (isSocleOutage(err)) { setSocleDown(message); setError(null); }
      else setError(message);
    }
  }

  if (resolution) {
    const title = resolution.kind === "anonyme"
      ? "Dépôt anonyme (assumé)"
      : resolution.kind === "contact"
        ? candidateSummary(resolution.contact).title
        : [resolution.declared.nom_naissance || resolution.declared.nom_usuel, resolution.declared.prenoms]
            .filter(Boolean).join(" ") || resolution.declared.raison_sociale || "Identité déclarée";
    const sub = resolution.kind === "contact"
      ? candidateSummary(resolution.contact).details.join(" · ") || "Usager Socle rapproché"
      : resolution.kind === "sans_rapprochement"
        ? "Sans rapprochement — identité déclarée (assumé)"
        : "Aucune identité conservée";
    return (
      <div className="flex w-full max-w-[1180px] items-center justify-between gap-3 rounded-[14px] border border-primary/30 bg-primary/[0.04] px-4 py-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground" aria-hidden="true">
            {initialsOf(title)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-bold leading-tight">{title}</span>
            <span className="truncate text-xs text-muted-foreground">{sub}</span>
          </span>
        </span>
        {locked ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
            Usager imposé
          </span>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => onResolve(null)}>
            Modifier
          </Button>
        )}
      </div>
    );
  }

  // Usager imposé mais inutilisable ici (public non proposé par la démarche,
  // fiche Socle illisible) : on l'explique, on ne rouvre pas la recherche.
  if (locked) {
    return (
      <div className="flex w-full max-w-[1180px] flex-col gap-2 rounded-[14px] border border-border bg-card px-4 py-3.5 shadow-airbnb-sm">
        <span className="text-sm font-bold">Usager imposé</span>
        <p className="text-[13px] text-muted-foreground">
          {lockedMessage ?? "Usager en cours de lecture dans le référentiel Socle…"}
        </p>
        {lockedAction ? <div className="flex pt-1">{lockedAction}</div> : null}
      </div>
    );
  }

  const pending = create.isPending;
  const hasMatches = matches !== null && matches.length > 0;
  const noMatch = matches !== null && matches.length === 0 && !searching;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-4">
      {audiences.length > 1 ? (
        <div className="flex gap-1.5" role="radiogroup" aria-label="Public demandeur">
          {audiences.map((a) => {
            const active = a === audience;
            return (
              <button key={a} type="button" role="radio" aria-checked={active}
                onClick={() => switchAudience(a)}
                className={cn(
                  "h-[30px] rounded-full border px-3 text-xs font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-secondary hover:bg-secondary",
                )}>
                {AUDIENCE_LABELS[a]}
              </button>
            );
          })}
        </div>
      ) : null}

      {mode === "recherche" ? (
        <>
          <section className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4 shadow-airbnb-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold">Identité de l'usager</h3>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {searching ? <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" /> : null}
                {searching
                  ? "Recherche d'homonymes dans le Socle…"
                  : "Les homonymes du Socle s'affichent automatiquement au fil de la saisie."}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              {fields.map(({ def, visibility }) => (
                <Field key={def.key} label={def.label} htmlFor={`req-${def.key}`}
                  required={visibility === "obligatoire"}>
                  {def.key === "civilite" ? (
                    <Select id={`req-${def.key}`} className="h-11 px-4" value={declared[def.key] ?? ""}
                      onChange={(e) => setD(def.key, e.target.value)}>
                      <option value="">—</option>
                      <option value="madame">Madame</option>
                      <option value="monsieur">Monsieur</option>
                    </Select>
                  ) : def.key === "adresse" ? (
                    // Le `requester_config` du Socle n'a qu'UNE clé d'adresse,
                    // en texte libre : on y écrit l'adresse normalisée par le
                    // référentiel (`label`), code postal et ville compris.
                    <AddressField
                      id={`req-${def.key}`}
                      label=""
                      singleLine
                      showMap={false}
                      hint="Le référentiel propose : la ligne retenue est enregistrée telle quelle."
                      value={{ line: declared[def.key] ?? "", postcode: "", city: "" }}
                      onChange={(next, suggestion) =>
                        setD(def.key, suggestion ? suggestion.label : next.line)}
                    />
                  ) : (
                    <Input id={`req-${def.key}`} value={declared[def.key] ?? ""}
                      type={def.key === "courriel" ? "email" : "text"}
                      autoComplete="off"
                      autoFocus={def.key === "nom_naissance" || def.key === "raison_sociale"}
                      onChange={(e) => setD(def.key, e.target.value)} />
                  )}
                </Field>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-base font-semibold">Correspondances dans le Socle</h3>
              <small className="text-xs text-muted-foreground">
                {matches === null
                  ? (searching ? "recherche…" : "en attente de saisie")
                  : `${matches.length} usager${matches.length > 1 ? "s" : ""} semblable${matches.length > 1 ? "s" : ""}`}
              </small>
            </div>
            <Button type="button" variant={noMatch ? "primary" : "outline"} size="sm"
              disabled={pending} onClick={openCreate}>
              <UserRoundPlus />
              Créer un nouvel usager
            </Button>
          </div>

          {searchError ? <p role="alert" className="text-sm text-destructive">{searchError}</p> : null}

          {matches === null && !searching ? (
            <p className="rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
              Renseignez au moins un nom, une raison sociale, un SIRET, un courriel ou un téléphone :
              les usagers déjà connus du Socle vous seront proposés ici.
            </p>
          ) : null}

          {matches === null && searching ? (
            <p className="flex items-center gap-2 rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Recherche dans le Socle…
            </p>
          ) : null}

          {noMatch ? (
            <div className="flex flex-col items-start gap-3 rounded-[14px] border border-border bg-card p-5 shadow-airbnb-sm">
              <div className="flex flex-col gap-1">
                <span className="font-bold">Aucun usager du Socle ne correspond à cette identité</span>
                <small className="text-sm text-muted-foreground">
                  C'est donc une nouvelle personne : créez sa fiche dans le Socle. Elle servira à
                  toute la gamme, et aux prochaines demandes de cet usager.
                </small>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={openCreate}>
                  <UserRoundPlus />
                  Créer un nouvel usager
                </Button>
              </div>
            </div>
          ) : null}

          {hasMatches ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-sm text-muted-foreground">
                Cliquez sur l'usager correspondant — une similitude de nom seule ne suffit jamais, vérifiez
                les informations distinctives.
              </p>
              <CandidateList candidates={matches!} onPick={resolveContact} />
              <p className="text-sm text-muted-foreground">
                Aucun de ces usagers ?{" "}
                <button type="button" className="font-semibold text-primary hover:underline" onClick={openCreate}>
                  Créer un nouvel usager
                </button>
              </p>
            </div>
          ) : null}

          {anonymousAllowed ? (
            <div>
              <Button type="button" variant="ghost" size="sm" disabled={pending}
                onClick={() => onResolve({ kind: "anonyme" })}>
                Dépôt anonyme (assumé)
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4 shadow-airbnb-sm">
          <div className="flex items-center gap-2">
            <UserRoundPlus className="size-4 text-primary" aria-hidden="true" />
            <h3 className="text-base font-semibold">Créer un usager dans le référentiel Socle</h3>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            {audience === "citoyen" ? (
              <>
                <Field label="Civilité" htmlFor="nc-civilite">
                  <Select id="nc-civilite" className="h-11 px-4" value={createForm.civilite}
                    onChange={(e) => setC("civilite", e.target.value)}>
                    <option value="">—</option>
                    <option value="madame">Madame</option>
                    <option value="monsieur">Monsieur</option>
                  </Select>
                </Field>
                <Field label="Nom de naissance" htmlFor="nc-lastname" required>
                  <Input id="nc-lastname" value={createForm.lastName}
                    onChange={(e) => setC("lastName", e.target.value)} />
                </Field>
                <Field label="Nom usuel" htmlFor="nc-usagename">
                  <Input id="nc-usagename" value={createForm.usageName}
                    onChange={(e) => setC("usageName", e.target.value)} />
                </Field>
                <Field label="Prénom(s)" htmlFor="nc-firstname">
                  <Input id="nc-firstname" value={createForm.firstName}
                    onChange={(e) => setC("firstName", e.target.value)} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Raison sociale" htmlFor="nc-legalname" required>
                  <Input id="nc-legalname" value={createForm.legalName}
                    onChange={(e) => setC("legalName", e.target.value)} />
                </Field>
                <Field label="SIRET" htmlFor="nc-siret">
                  <Input id="nc-siret" value={createForm.siret}
                    onChange={(e) => setC("siret", e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Courriel" htmlFor="nc-email">
              <Input id="nc-email" type="email" value={createForm.email}
                onChange={(e) => setC("email", e.target.value)} />
            </Field>
            <Field label="Téléphone portable" htmlFor="nc-mobile">
              <Input id="nc-mobile" value={createForm.mobilePhone}
                onChange={(e) => setC("mobilePhone", e.target.value)} />
            </Field>
            <Field label="Téléphone fixe" htmlFor="nc-landline">
              <Input id="nc-landline" value={createForm.landlinePhone}
                onChange={(e) => setC("landlinePhone", e.target.value)} />
            </Field>
            {/* Le contrat de création n'a ni complément ni pays : trois clés,
                pas une de plus. La carte est coupée — cette étape est déjà dense. */}
            <AddressField
              id="nc-address"
              className="md:col-span-2 xl:col-span-3"
              showMap={false}
              value={{ line: createForm.addressLine1, postcode: createForm.postalCode, city: createForm.city }}
              onChange={(next) => {
                setC("addressLine1", next.line);
                setC("postalCode", next.postcode);
                setC("city", next.city);
              }}
            />
          </div>

          {duplicates !== null && duplicates.length > 0 ? (
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-secondary bg-secondary/30 p-3.5">
              <p className="text-sm font-bold text-secondary-foreground">
                Doublon potentiel : {duplicates.length} usager{duplicates.length > 1 ? "s" : ""} Socle
                ressemble{duplicates.length > 1 ? "nt" : ""} à cette identité — cliquez sur la bonne
                fiche, ou créez quand même.
              </p>
              <CandidateList candidates={duplicates} onPick={resolveContact} />
              <div>
                <Button type="button" variant="outline" disabled={pending}
                  onClick={() => submitCreate(true)}>
                  {create.isPending ? "Création…" : "Créer quand même"}
                </Button>
              </div>
            </div>
          ) : null}

          {/* SORTIE DE SECOURS — uniquement sur une panne AVÉRÉE. On ne renvoie
              pas un usager chez lui parce que le référentiel tousse ; en
              échange, la demande porte une anomalie que le serveur pose
              lui-même (il ne croit aucun drapeau du navigateur). */}
          {socleDown ? (
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-destructive/40 bg-destructive/[0.06] p-3.5">
              <p className="text-sm font-bold text-destructive">Le Socle n'a pas répondu</p>
              <p className="text-sm text-muted-foreground">{socleDown}</p>
              <p className="text-sm text-muted-foreground">
                Réessayez : c'est souvent passager. Si l'usager attend, poursuivez avec l'identité
                déclarée — la demande sera signalée comme « usager à créer dans le Socle », à
                régulariser plus tard.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={() => submitCreate(true)}>
                  {create.isPending ? "Création…" : "Réessayer"}
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={proceedWithoutMatch}>
                  Poursuivre sans rapprochement
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {(duplicates === null || duplicates.length === 0) && !socleDown ? (
              <Button type="button" disabled={pending} onClick={() => submitCreate(false)}>
                {pending ? "Vérification…" : "Vérifier et créer"}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" disabled={pending}
              onClick={() => { setMode("recherche"); setDuplicates(null); setError(null); setSocleDown(null); }}>
              <ArrowLeft />
              Retour à la recherche
            </Button>
          </div>
        </div>
      )}

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
