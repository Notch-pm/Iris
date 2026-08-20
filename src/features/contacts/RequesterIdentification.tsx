// Étape « Demandeur » : identification de l'usager auprès du référentiel
// Socle. Aucun rapprochement automatique — chaque issue (contact choisi, usager
// créé, poursuite sans rapprochement, dépôt anonyme) est un geste explicite.
// Les champs proposés et l'anonymat sont gouvernés par le requester_config de
// la démarche (masqué / visible / obligatoire).

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  buildMatchIdentity,
  candidateSummary,
  duplicateCheckIdentity,
  EMPTY_NEW_CONTACT,
  isNameOnlyMatch,
  newContactFromDeclared,
  reasonLabel,
  resolutionSummary,
  type MatchCandidate,
  type NewContactForm,
  type RequesterResolution,
  type SocleContact,
} from "./rapprochement";
import { useCreateContact, useMatchContacts } from "./useContacts";

const AUDIENCE_LABELS: Record<Audience, string> = {
  citoyen: "Citoyen", entreprise: "Entreprise", association: "Association",
};

interface Props {
  organizationId: string;
  /** requester_config brut de la démarche (snapshot socle-proxy). */
  requesterConfig: unknown;
  resolution: RequesterResolution | null;
  onResolve: (resolution: RequesterResolution | null) => void;
}

function CandidateList({ candidates, selectedId, onSelect, name }: {
  candidates: MatchCandidate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  name: string;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {candidates.map(({ contact, score, reasons }) => {
        const summary = candidateSummary(contact);
        return (
          <li key={contact.id}>
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
              selectedId === contact.id ? "border-primary bg-secondary/40" : "border-border"
            }`}>
              <input type="radio" name={name} className="mt-1" checked={selectedId === contact.id}
                onChange={() => onSelect(contact.id)} />
              <span className="flex flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{summary.title}</span>
                  <Badge variant="secondary">Score {score}</Badge>
                  {reasons.map((r) => <Badge key={r} variant="muted">{reasonLabel(r)}</Badge>)}
                </span>
                {summary.details.length > 0 ? (
                  <span className="text-sm text-muted-foreground">{summary.details.join(" · ")}</span>
                ) : null}
                {isNameOnlyMatch(reasons) ? (
                  <span className="text-xs text-muted-foreground">
                    Similitude de nom uniquement — vérifiez avant de choisir.
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function RequesterIdentification({ organizationId, requesterConfig, resolution, onResolve }: Props) {
  const config = React.useMemo(() => parseRequesterConfig(requesterConfig), [requesterConfig]);
  const audiences = selectableAudiences(config);
  const anonymousAllowed = allowsAnonymous(requesterConfig);

  const [audience, setAudience] = React.useState<Audience>(audiences[0]);
  const [declared, setDeclared] = React.useState<Record<string, string>>({});
  const [matches, setMatches] = React.useState<MatchCandidate[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [assumeNoMatch, setAssumeNoMatch] = React.useState(false);
  const [mode, setMode] = React.useState<"recherche" | "creation">("recherche");
  const [createForm, setCreateForm] = React.useState<NewContactForm>(EMPTY_NEW_CONTACT);
  const [duplicates, setDuplicates] = React.useState<MatchCandidate[] | null>(null);
  const [dupSelectedId, setDupSelectedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const match = useMatchContacts();
  const create = useCreateContact();

  const fields = visibleRequesterFields(config, audience);
  const setD = (key: string, value: string) => setDeclared((d) => ({ ...d, [key]: value }));
  const setC = <K extends keyof NewContactForm>(key: K, value: string) =>
    setCreateForm((f) => ({ ...f, [key]: value }));

  function switchAudience(next: Audience) {
    setAudience(next);
    setMatches(null);
    setSelectedId(null);
    setError(null);
  }

  async function runSearch() {
    setError(null);
    setSelectedId(null);
    const built = buildMatchIdentity(audience, declared, declared.date_naissance);
    if (!built.ok) { setError(built.message); return; }
    try {
      setMatches(await match.mutateAsync({ organizationId, identity: built.identity }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recherche impossible.");
    }
  }

  function resolveContact(contact: SocleContact) {
    onResolve({ kind: "contact", audience, contact });
  }

  function useSelected(from: MatchCandidate[], id: string | null) {
    const candidate = from.find((c) => c.contact.id === id);
    if (candidate) resolveContact(candidate.contact);
  }

  function proceedWithoutMatch() {
    setError(null);
    const submission = {
      kind: "sans_rapprochement" as const,
      audience,
      declared: sanitizeDeclared(audience, declared),
    };
    const check = validateRequesterSubmission(requesterConfig, submission);
    if (!check.ok) { setError(check.message); return; }
    onResolve(submission);
  }

  function openCreate() {
    setError(null);
    setDuplicates(null);
    setDupSelectedId(null);
    setCreateForm(newContactFromDeclared(declared, declared.date_naissance));
    setMode("creation");
  }

  async function submitCreate(ignoreDuplicates: boolean) {
    setError(null);
    const payload = buildContactCreatePayload(audience, createForm);
    if (!payload.ok) { setError(payload.message); return; }
    try {
      if (!ignoreDuplicates) {
        // Rejeu du rapprochement JUSTE avant la création : signaler un doublon
        // potentiel tant que l'agent ne l'a pas explicitement écarté.
        const check = duplicateCheckIdentity(audience, createForm);
        if (check.ok) {
          const found = await match.mutateAsync({ organizationId, identity: check.identity });
          if (found.length > 0) {
            setDuplicates(found);
            setDupSelectedId(null);
            return;
          }
        }
      }
      const contact = await create.mutateAsync({ organizationId, contact: payload.payload });
      resolveContact(contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    }
  }

  if (resolution) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 p-3">
        <p className="text-sm font-medium">{resolutionSummary(resolution)}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onResolve(null)}>
          Modifier
        </Button>
      </div>
    );
  }

  const pending = match.isPending || create.isPending;

  return (
    <div className="flex flex-col gap-4">
      {audiences.length > 1 ? (
        <div className="flex gap-2" role="radiogroup" aria-label="Public demandeur">
          {audiences.map((a) => (
            <Button key={a} type="button" size="sm"
              variant={a === audience ? "primary" : "outline"}
              onClick={() => switchAudience(a)}>
              {AUDIENCE_LABELS[a]}
            </Button>
          ))}
        </div>
      ) : null}

      {mode === "recherche" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {fields.map(({ def, visibility }) => (
              <Field key={def.key} label={def.label} htmlFor={`req-${def.key}`}
                required={visibility === "obligatoire"}>
                {def.key === "civilite" ? (
                  <Select id={`req-${def.key}`} value={declared[def.key] ?? ""}
                    onChange={(e) => setD(def.key, e.target.value)}>
                    <option value="">—</option>
                    <option value="madame">Madame</option>
                    <option value="monsieur">Monsieur</option>
                  </Select>
                ) : (
                  <Input id={`req-${def.key}`} value={declared[def.key] ?? ""}
                    type={def.key === "courriel" ? "email" : "text"}
                    onChange={(e) => setD(def.key, e.target.value)} />
                )}
              </Field>
            ))}
            {audience === "citoyen" ? (
              <Field label="Date de naissance" htmlFor="req-date_naissance"
                hint="Sert au rapprochement — conservée dans l'identité déclarée.">
                <Input id="req-date_naissance" type="date" value={declared.date_naissance ?? ""}
                  onChange={(e) => setD("date_naissance", e.target.value)} />
              </Field>
            ) : null}
          </div>

          <div>
            <Button type="button" onClick={runSearch} disabled={pending}>
              {match.isPending ? "Recherche…" : "Rechercher dans le Socle"}
            </Button>
          </div>

          {matches !== null ? (
            matches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun usager correspondant dans le Socle.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">
                  {matches.length} candidat{matches.length > 1 ? "s" : ""} — sélectionnez
                  explicitement le bon usager, ou créez-en un nouveau.
                </p>
                <CandidateList candidates={matches} selectedId={selectedId}
                  onSelect={setSelectedId} name="req-candidate" />
                <div>
                  <Button type="button" disabled={!selectedId || pending}
                    onClick={() => useSelected(matches, selectedId)}>
                    Utiliser ce contact
                  </Button>
                </div>
              </div>
            )
          ) : null}

          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={pending} onClick={openCreate}>
                Créer un nouvel usager dans le Socle
              </Button>
              {anonymousAllowed ? (
                <Button type="button" variant="outline" disabled={pending}
                  onClick={() => onResolve({ kind: "anonyme" })}>
                  Dépôt anonyme (assumé)
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Dépôt anonyme non permis : cette démarche rend une identité obligatoire.
                </p>
              )}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={assumeNoMatch}
                onChange={(e) => setAssumeNoMatch(e.target.checked)} />
              J'assume de poursuivre sans rapprochement : la demande portera la seule
              identité déclarée, sans usager Socle rattaché.
            </label>
            <div>
              <Button type="button" variant="outline" disabled={!assumeNoMatch || pending}
                onClick={proceedWithoutMatch}>
                Poursuivre sans rapprochement
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Créer un usager dans le référentiel Socle</p>
          <div className="grid grid-cols-2 gap-3">
            {audience === "citoyen" ? (
              <>
                <Field label="Civilité" htmlFor="nc-civilite">
                  <Select id="nc-civilite" value={createForm.civilite}
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
                <Field label="Date de naissance" htmlFor="nc-birthdate">
                  <Input id="nc-birthdate" type="date" value={createForm.birthDate}
                    onChange={(e) => setC("birthDate", e.target.value)} />
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
            <Field label="Adresse" htmlFor="nc-address">
              <Input id="nc-address" value={createForm.addressLine1}
                onChange={(e) => setC("addressLine1", e.target.value)} />
            </Field>
            <Field label="Code postal" htmlFor="nc-postal">
              <Input id="nc-postal" value={createForm.postalCode}
                onChange={(e) => setC("postalCode", e.target.value)} />
            </Field>
            <Field label="Ville" htmlFor="nc-city">
              <Input id="nc-city" value={createForm.city}
                onChange={(e) => setC("city", e.target.value)} />
            </Field>
          </div>

          {duplicates !== null && duplicates.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm font-semibold">
                Doublon potentiel : {duplicates.length} usager{duplicates.length > 1 ? "s" : ""} Socle
                ressemble{duplicates.length > 1 ? "nt" : ""} à cette identité.
              </p>
              <CandidateList candidates={duplicates} selectedId={dupSelectedId}
                onSelect={setDupSelectedId} name="dup-candidate" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={!dupSelectedId || pending}
                  onClick={() => useSelected(duplicates, dupSelectedId)}>
                  Utiliser ce contact
                </Button>
                <Button type="button" variant="outline" disabled={pending}
                  onClick={() => submitCreate(true)}>
                  {create.isPending ? "Création…" : "Créer quand même"}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {duplicates === null || duplicates.length === 0 ? (
              <Button type="button" disabled={pending} onClick={() => submitCreate(false)}>
                {pending ? "Vérification…" : "Vérifier et créer"}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" disabled={pending}
              onClick={() => { setMode("recherche"); setDuplicates(null); setError(null); }}>
              Retour à la recherche
            </Button>
          </div>
        </div>
      )}

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
