// Onglet « Résumé » : clôture (le cas échéant), informations saisies
// (étiquetées par le snapshot de démarche), lieu d'intervention (quand la
// démarche pose la question) et demandes liées.

import { Link } from "react-router-dom";
import { Check, ExternalLink, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "../StatusBadge";
import { MOTIF_LABELS, type ClosureMotif } from "../statuts";
import type { RequestLink, RequestRow, RequestSummary } from "../useRequests";
import { InfoCell, Surface, SurfaceHead } from "@/components/ui/surface";
import { channelLabel, linkReason, originResource, type AnswerRow } from "./instruction";
import { LieuIntervention } from "./LieuIntervention";
import type { InterventionLocation } from "./lieu";
import { parseConsentRecords } from "@fn/_shared/consents/catalog";
import { cn } from "@/lib/utils";

interface Props {
  request: RequestRow;
  answers: AnswerRow[];
  formVersion: number | null;
  /** Adresse d'intervention de la démarche — `null` si elle ne la demande pas. */
  lieu: InterventionLocation | null;
  links: RequestLink[];
  linkedSummaries: RequestSummary[];
  /**
   * Modifier les RÉPONSES de cette demande (jamais la définition de la
   * démarche, qui vit dans le Socle). `null` = geste indisponible : sans droit
   * d'instruction, sur une demande close, ou sans formulaire exploitable.
   */
  onEditAnswers: (() => void) | null;
}

export function ResumePane({
  request: r, answers, formVersion, lieu, links, linkedSummaries, onEditAnswers,
}: Props) {
  const channel = channelLabel(r.channel);
  const internalLinks = links.filter((l) => l.target_request_id);
  const externalLinks = links.filter((l) => !l.target_request_id);
  // La ressource d'origine (external_ref) ne double jamais un lien externe qui
  // mène au même endroit — Clara envoie action + courrier, un seul courrier.
  const origin = originResource(r, links);
  const hasLinks = internalLinks.length > 0 || externalLinks.length > 0 || origin !== null;

  return (
    <div className="flex flex-col gap-4">
      {r.closure_motif || r.closure_text ? (
        <Surface className="border-primary/30 bg-primary/[0.03]">
          <SurfaceHead
            title="Clôture"
            sub={r.closure_motif ? `Motif : ${MOTIF_LABELS[r.closure_motif as ClosureMotif] ?? r.closure_motif}` : "Texte destiné à l'usager"}
          />
          {r.closure_text ? (
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">« {r.closure_text} »</p>
          ) : null}
        </Surface>
      ) : null}

      <Surface>
        <SurfaceHead
          title="Informations saisies"
          action={
            <span className="flex items-center gap-2">
              {formVersion !== null ? (
                <Badge variant="outline" className="h-6 font-mono text-[11px]">formulaire v{formVersion}</Badge>
              ) : (
                <Badge variant="muted" className="h-6 text-[11px]">sans formulaire</Badge>
              )}
              {onEditAnswers ? (
                <Button type="button" variant="outline" size="sm" onClick={onEditAnswers}>
                  <Pencil /> Modifier
                </Button>
              ) : null}
            </span>
          }
        />
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-5 gap-y-3">
          <InfoCell label="Démarche" value={r.socle_procedure_label ?? "Demande historique sans démarche"} />
          {r.socle_category_label ? <InfoCell label="Catégorie de démarche" value={r.socle_category_label} /> : null}
          <InfoCell label="Organisme" value={r.socle_organization_label ?? "À affecter"} />
          {channel ? <InfoCell label="Canal de dépôt" value={channel} /> : null}
          {r.source !== "iris" ? (
            <InfoCell label="Source" value={r.external_ref ? `${r.source} · réf. ${r.external_ref}` : r.source} />
          ) : null}
          {answers.map((a) => (
            <InfoCell key={a.key} label={a.label} full={a.full}
              value={a.full ? <span className="whitespace-pre-wrap font-medium">{a.value}</span> : a.value} />
          ))}
          {r.body ? (
            <InfoCell label="Description" full value={<span className="whitespace-pre-wrap font-medium">{r.body}</span>} />
          ) : null}
        </dl>
        {answers.length === 0 && !r.body ? (
          <p className="text-sm text-muted-foreground">Aucune réponse de formulaire ni description.</p>
        ) : null}
      </Surface>

      {lieu ? <LieuIntervention lieu={lieu} /> : null}

      <ConsentementsDepot request={r} />

      <Surface>
        <SurfaceHead title="Demandes liées" sub={hasLinks ? undefined : "Aucune demande liée"} />
        {internalLinks.map((l) => {
          const target = linkedSummaries.find((s) => s.id === l.target_request_id);
          return (
            <LinkRow
              key={l.id}
              reference={target?.reference ?? "Hors périmètre"}
              label={target ? (target.socle_procedure_label ?? target.subject) : "Demande non consultable"}
              status={target?.status ?? null}
              why={linkReason(l)}
              action={target ? (
                <Button asChild variant="ghost" size="sm" className="h-7 px-2.5 text-xs">
                  <Link to={`/demandes/${target.id}`}>Ouvrir</Link>
                </Button>
              ) : null}
            />
          );
        })}
        {externalLinks.map((l) => (
          <LinkRow
            key={l.id}
            reference={l.external_id ?? "—"}
            label={l.external_type ?? "Référence externe"}
            status={null}
            why={linkReason(l)}
            action={l.external_url ? (
              <Button asChild variant="ghost" size="sm" className="h-7 px-2.5 text-xs">
                <a href={l.external_url} target="_blank" rel="noreferrer">
                  Ouvrir <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          />
        ))}
        {origin ? (
          <LinkRow
            reference={origin.reference}
            label={`Ressource d'origine (${origin.source})`}
            status={null}
            why="référence d'origine"
            action={origin.url ? (
              <Button asChild variant="ghost" size="sm" className="h-7 px-2.5 text-xs">
                <a href={origin.url} target="_blank" rel="noreferrer">
                  Ouvrir <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          />
        ) : null}
      </Surface>
    </div>
  );
}

function LinkRow({ reference, label, status, why, action }: {
  reference: string;
  label: string;
  status: string | null;
  why: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-[13px] py-[11px]">
      <span className="font-mono text-[11.5px] font-bold tracking-wide">{reference}</span>
      <span className="min-w-[120px] flex-1 text-[13px] font-semibold">{label}</span>
      {status ? <StatusBadge status={status} /> : null}
      <span className="text-[11.5px] text-muted-foreground">{why}</span>
      {action}
    </div>
  );
}

/**
 * Consentements RGPD recueillis AU DÉPÔT — la trace immuable de la demande,
 * distincte de l'état courant du référentiel (fiche usager).
 *
 * Sa raison d'être tient dans un cas : un dépôt **anonyme** ou une identité
 * **non rapprochée** n'a aucune fiche au référentiel. Sans ce bloc, la preuve
 * existerait en base sans que personne ne puisse la lire — exactement pour les
 * dossiers où elle est la seule.
 *
 * La phrase affichée est celle qui a été SOUMISE ce jour-là, jamais recomposée
 * avec le nom d'organisme d'aujourd'hui.
 */
function ConsentementsDepot({ request }: { request: RequestRow }) {
  // Les demandes antérieures à la migration portent `[]` (défaut de la
  // colonne) : le bloc ne s'affiche alors pas du tout, plutôt que d'annoncer
  // une absence de consentement qui n'a jamais été une réponse.
  const consents = parseConsentRecords(request.consents);
  if (consents.length === 0) return null;

  return (
    <Surface>
      <SurfaceHead
        title="Consentements au dépôt"
        sub="Ce que l'usager a accepté ce jour-là — trace du dossier, non modifiable"
      />
      <ul className="flex flex-col gap-2">
        {consents.map((c) => (
          <li key={c.kind} className="flex items-start gap-2.5 text-[13px]">
            {c.granted ? (
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold leading-relaxed">« {c.statement} »</span>
              <span className={cn("text-xs font-semibold", c.granted ? "text-primary" : "text-muted-foreground")}>
                {c.granted ? "Accepté" : "Refusé"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
