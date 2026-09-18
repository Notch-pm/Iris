// « Fiche démarche » — la fenêtre qu'ouvre le bouton « i » d'une carte, à
// l'étape Démarche du parcours de création (maquette Claude Design « Écran
// agent — fiche démarche », 2026-09-18).
//
// Trois familles, dans l'ordre où l'agent en a besoin au guichet :
//  - CÔTÉ USAGER — ce que la collectivité écrit POUR SES USAGERS (contrat
//    public-api 1.24.0) : descriptif, délai d'instruction annoncé, public,
//    pièces annoncées, FAQ usager. Publié : l'agent peut le lire tel quel.
//  - INTERNE — AGENT — la part agent de la base de connaissances : consignes,
//    garde-fous, procédure, FAQ du service, liens et documents d'aide. Jamais à
//    lire tel quel à l'usager.
//  - AIDE — l'assistant, en mode « démarche seule » : aucune saisie en cours ne
//    part chez le fournisseur (décision PO D5).
//
// ⚠️ LES PIÈGES DU CONTRAT, TENUS À L'ÉCRAN :
//  - trois durées : « Temps de saisie » (minutes, formulaire) et « Délai
//    d'instruction annoncé » sont nommés pour ne pas se confondre, et une
//    valeur absente ne produit AUCUNE carte ni aucun texte de remplacement ;
//  - `audience.note` ne filtre rien : les publics ADMIS sont posés à côté, et
//    font foi ;
//  - pièces ANNONCÉES et pièces du FORMULAIRE : deux listes, jamais fusionnées ;
//  - deux FAQ : « FAQ usager » ici, « FAQ agent » dans la famille interne.
//
// Tout est relu dans le Socle à l'ouverture ; rien n'est conservé dans Iris.
//
// Ce qui n'a PAS été repris de la maquette, faute de donnée qui le porte : la
// version et la date de mise à jour de la fiche, le bouton « Vue usager »
// (Iris ne connaît pas l'adresse du portail), les « sources » cliquables sous
// les réponses de l'assistant (il n'en renvoie pas de structurées), et le
// contact du service qui maintient la fiche.

import * as React from "react";
import {
  ExternalLink, Eye, EyeOff, FileText, Link2, Loader2, MessageSquare, Minus, Plus,
  Sparkles, SquareCheckBig, TriangleAlert, Workflow, X,
} from "lucide-react";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import type { SocleProcedureRow } from "@/features/socle/useSocleCatalog";
import { portalAbsenceLabel, publicationPeriodLabel } from "@fn/_shared/procedures/publication";
import type { KnowledgeDocument } from "@fn/socle-proxy/_shared/knowledge";
import { AssistantPane } from "../assistant/AssistantPane";
import { AssistantThreadProvider } from "../assistant/AssistantThreadProvider";
import { procedureTypeLabel } from "../creation/procedureSearch";
import {
  hasUserContent,
  inputDurationLabel,
  internalNav,
  resolveTab,
  type FicheTab,
  type ProcedureFiche,
} from "./ficheDemarche";
import { useProcedureDocumentUrl, useProcedureFiche } from "./useProcedureKnowledge";

/** Amorces du guichet : la démarche seule, avant tout dossier. */
const GUICHET_STARTERS = [
  "Quelles pièces demander ?",
  "Quel délai annoncer à l'usager ?",
  "Y a-t-il un cas particulier à surveiller ?",
] as const;

const TAB_ICON: Record<FicheTab, React.ComponentType<{ className?: string }>> = {
  usager: Eye,
  consignes: SquareCheckBig,
  vigilance: TriangleAlert,
  procedure: Workflow,
  faq: MessageSquare,
  liens: Link2,
  assistant: Sparkles,
};

interface Props {
  organizationId: string;
  /** La démarche consultée — `null` ferme la fenêtre. */
  row: SocleProcedureRow | null;
  /** Rubrique d'ouverture (« Ce que voit l'usager » par défaut). */
  initialTab?: FicheTab;
  onClose: () => void;
  /** Absent ⇒ pas de bouton « Choisir » (consultation seule). */
  onChoose?: (socleProcedureId: string) => void;
  /** Vrai quand la démarche consultée est déjà celle de la demande en cours. */
  chosen: boolean;
  /**
   * Vrai quand la page porte DÉJÀ un fil d'assistant sur cette démarche
   * (c'est la démarche choisie) : la fenêtre le reprend au lieu d'en ouvrir un
   * second. Sinon, elle ouvre le sien, qui disparaît à sa fermeture.
   */
  shareThread: boolean;
}

export function FicheDemarcheDialog({
  organizationId, row, initialTab = "usager", onClose, onChoose, chosen, shareThread,
}: Props) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {row ? (
        <DialogContent
          hideClose
          className="flex h-[min(780px,calc(100dvh-56px))] max-h-none w-[calc(100vw-56px)] max-w-[1080px] flex-col overflow-hidden rounded-[14px] border-0 p-0"
        >
          {shareThread ? (
            <FicheBody
              organizationId={organizationId} row={row} initialTab={initialTab}
              onClose={onClose} onChoose={onChoose} chosen={chosen}
            />
          ) : (
            <AssistantThreadProvider
              target={{ kind: "procedure", organizationId, socleProcedureId: row.socle_id }}
            >
              <FicheBody
                organizationId={organizationId} row={row} initialTab={initialTab}
                onClose={onClose} onChoose={onChoose} chosen={chosen}
              />
            </AssistantThreadProvider>
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

// ---- Corps ----------------------------------------------------------------------

function FicheBody({ organizationId, row, initialTab, onClose, onChoose, chosen }: {
  organizationId: string;
  row: SocleProcedureRow;
  initialTab: FicheTab;
  onClose: () => void;
  onChoose?: (socleProcedureId: string) => void;
  chosen: boolean;
}) {
  const fiche = useProcedureFiche(organizationId, row.socle_id);
  const data = fiche.data ?? null;
  const [requested, setRequested] = React.useState<FicheTab>(initialTab);
  const tab = resolveTab(requested, data);
  const nav = data ? internalNav(data.knowledge) : [];

  const typeLabel = procedureTypeLabel(row.type);
  const horsPortail = portalAbsenceLabel(row.publication);
  const periode = publicationPeriodLabel(row.publication);

  return (
    <>
      {/* ── En-tête ── */}
      <div className="flex shrink-0 items-start justify-between gap-5 border-b border-border px-[22px] pb-4 pt-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {row.category_name ? (
              <span className="inline-flex h-6 items-center rounded-full bg-primary/10 px-[11px] text-xs font-bold text-primary">
                {row.category_name}
              </span>
            ) : null}
            {typeLabel ? (
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-[11px] text-xs font-semibold text-muted-foreground">
                Démarche {typeLabel.toLowerCase()}
              </span>
            ) : null}
            {horsPortail ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-[11px] text-xs font-semibold text-muted-foreground">
                <EyeOff className="size-3" aria-hidden="true" />
                {horsPortail}
              </span>
            ) : null}
            {periode ? <span className="text-xs text-muted-foreground">{periode}</span> : null}
          </div>
          <DialogTitle className="mt-2 text-xl font-extrabold tracking-tight">{row.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Fiche de la démarche : ce que voit l'usager, consignes internes du service, et
            assistant.
          </DialogDescription>
        </div>
        <DialogClose asChild>
          <button
            type="button"
            aria-label="Fermer la fiche"
            className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground transition-colors hover:bg-border"
          >
            <X className="size-[18px]" aria-hidden="true" />
          </button>
        </DialogClose>
      </div>

      {/* ── Navigation + contenu ── */}
      <div className="flex min-h-0 flex-1">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Rubriques de la fiche"
          className="flex w-[236px] shrink-0 flex-col overflow-y-auto border-r border-border bg-muted/40 px-3 py-3.5"
        >
          <NavGroup label="Côté usager" first />
          <NavButton tab="usager" label="Ce que voit l'usager" current={tab} onSelect={setRequested} />

          <NavGroup label="Interne — agent" />
          {fiche.isLoading ? (
            <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Lecture…
            </p>
          ) : nav.length === 0 ? (
            <p className="px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
              {fiche.isError
                ? "Consignes du service indisponibles."
                : "Le service n'a rédigé aucune consigne pour cette démarche."}
            </p>
          ) : (
            nav.map((item) => (
              <NavButton
                key={item.tab} tab={item.tab} label={item.label} count={item.count}
                current={tab} onSelect={setRequested}
              />
            ))
          )}

          <NavGroup label="Aide" />
          <NavButton tab="assistant" label="Assistant" current={tab} onSelect={setRequested} />

          <p className="mx-2 mb-1 mt-auto border-t border-border pt-3.5 text-xs leading-relaxed text-muted-foreground">
            Fiche relue dans le référentiel à chaque ouverture : une consigne corrigée dans le
            Socle se lit ici aussitôt.
          </p>
        </div>

        <div
          role="tabpanel"
          aria-label={tab === "usager" ? "Ce que voit l'usager" : nav.find((i) => i.tab === tab)?.label ?? "Assistant"}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            tab === "assistant" ? "px-[26px] pb-5 pt-[22px]" : "overflow-y-auto px-[26px] pb-7 pt-[22px]",
          )}
        >
          {tab === "assistant" ? (
            <AssistantTab />
          ) : fiche.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Lecture de la fiche dans le référentiel…
            </p>
          ) : !data ? (
            <p className="max-w-[72ch] rounded-[10px] border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground">
              La fiche n'a pas pu être lue depuis le Socle. Le choix de la démarche reste possible :
              cette fiche est une aide, jamais une condition.
            </p>
          ) : tab === "usager" ? (
            <UsagerTab fiche={data} portalVisible={row.publication.portalVisible} />
          ) : tab === "consignes" ? (
            <InternalText title="Consignes pour l'agent" source={data.knowledge.agentHelpText} />
          ) : tab === "procedure" ? (
            <InternalText
              title="Procédure de traitement"
              caption="Interne — le circuit du service, du guichet à la clôture."
              source={data.knowledge.proceduresText}
            />
          ) : tab === "vigilance" ? (
            <VigilanceTab rules={data.knowledge.guardrails} />
          ) : tab === "faq" ? (
            <AgentFaqTab items={data.knowledge.faq} />
          ) : (
            <LinksTab
              organizationId={organizationId}
              socleProcedureId={row.socle_id}
              fiche={data}
            />
          )}
        </div>
      </div>

      {/* ── Pied ── */}
      <div className="flex shrink-0 items-center justify-end gap-5 border-t border-border bg-muted/40 px-[22px] py-3.5">
        <div className="flex items-center gap-2.5">
          <Button type="button" variant="outline" onClick={onClose}>Fermer</Button>
          {onChoose ? (
            <Button type="button" onClick={() => onChoose(row.socle_id)}>
              {chosen ? "Continuer avec cette démarche" : "Choisir cette démarche"}
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---- Navigation -------------------------------------------------------------------

function NavGroup({ label, first = false }: { label: string; first?: boolean }) {
  return (
    <p className={cn(
      "mx-2 mb-2 text-[11px] font-extrabold uppercase tracking-[0.04em] text-muted-foreground",
      first ? "mt-1.5" : "mt-[18px]",
    )}>
      {label}
    </p>
  );
}

function NavButton({ tab, label, count, current, onSelect }: {
  tab: FicheTab;
  label: string;
  count?: number;
  current: FicheTab;
  onSelect: (tab: FicheTab) => void;
}) {
  const Icon = TAB_ICON[tab];
  const active = current === tab;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab)}
      className={cn(
        "mb-0.5 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-[13.5px] transition-colors",
        active
          ? "bg-card font-bold text-primary shadow-airbnb-sm"
          : "font-semibold text-foreground hover:bg-card",
      )}
    >
      <Icon className="size-[17px] shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{label}</span>
      {count !== undefined ? (
        <span className="inline-flex h-5 items-center rounded-full bg-secondary px-2 text-[11px] font-extrabold text-secondary-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

// ---- Côté usager ------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-[22px] text-base font-bold first:mt-0">{children}</h3>;
}

function Kpi({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="rounded-[10px] border border-border bg-card p-3.5">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-1 font-bold",
        numeric ? "text-[17px] tabular-nums" : "text-sm leading-snug",
      )}>
        {value}
      </p>
    </div>
  );
}

function UsagerTab({ fiche, portalVisible }: { fiche: ProcedureFiche; portalVisible: boolean }) {
  const uc = fiche.userCommunication;
  const saisie = inputDurationLabel(fiche.inputDurationMinutes);
  const note = uc?.audience.note ?? "";
  const announced = uc?.attachments.items ?? [];
  const userFaq = uc?.faq.items ?? [];
  const pieces = fiche.formPieces;
  const requiredCount = pieces?.filter((p) => p.required).length ?? 0;
  const written = hasUserContent(fiche);

  return (
    <div className="flex flex-col">
      {written ? (
        <div className="mb-5 flex items-center gap-2.5 rounded-[10px] border border-primary/20 bg-primary/[0.07] px-3.5 py-2.5">
          <Eye className="size-[17px] shrink-0 text-primary" aria-hidden="true" />
          <p className="text-[13px] font-semibold">
            {portalVisible
              ? "Contenu publié sur le portail — vous pouvez le lire tel quel à l'usager."
              : "Textes écrits pour l'usager — vous pouvez les lui lire tels quels. Cette démarche n'est pas visible sur le portail."}
          </p>
        </div>
      ) : (
        <p className="mb-5 max-w-[72ch] rounded-[10px] border border-dashed border-border p-3.5 text-[13px] leading-relaxed text-muted-foreground">
          {fiche.userCommunicationRelayed
            ? "La collectivité n'a encore rien écrit pour les usagers sur cette démarche. Cela se renseigne dans le Socle, à l'étape « Communication usager » de la démarche."
            : "Les textes destinés à l'usager n'ont pas pu être lus : la passerelle vers le référentiel n'est pas encore à jour."}
        </p>
      )}

      {saisie || fiche.processingTime || fiche.admittedAudiences.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          {/* ⚠️ Deux durées côte à côte : c'est là qu'on les confond. Les
              libellés disent laquelle est laquelle. */}
          {saisie ? <Kpi label="Temps de saisie du formulaire" value={saisie} numeric /> : null}
          {fiche.processingTime ? (
            <Kpi label="Délai d'instruction annoncé" value={fiche.processingTime} numeric />
          ) : null}
          {fiche.admittedAudiences.length > 0 ? (
            <Kpi label="Publics admis au dépôt" value={fiche.admittedAudiences.join(" · ")} />
          ) : null}
        </div>
      ) : null}

      {fiche.description ? (
        <>
          <SectionTitle>Descriptif</SectionTitle>
          <Markdown source={fiche.description} className="max-w-[72ch] text-sm leading-[1.65]" />
        </>
      ) : null}

      {note ? (
        <>
          <SectionTitle>Public concerné</SectionTitle>
          <p className="max-w-[72ch] text-sm leading-[1.65]">{note}</p>
          {fiche.admittedAudiences.length > 0 ? (
            <p className="mt-1.5 max-w-[72ch] text-xs text-muted-foreground">
              Précision rédigée pour l'usager : elle ne restreint pas le dépôt. En cas de doute,
              les publics admis au dépôt font foi.
            </p>
          ) : null}
        </>
      ) : null}

      {announced.length > 0 || (pieces && pieces.length > 0) ? (
        <>
          <SectionTitle>
            Documents à fournir
            {pieces ? (
              <span className="text-[13px] font-semibold text-muted-foreground">
                {" "}— {requiredCount === 0
                  ? "aucun obligatoire au dépôt en ligne"
                  : `${requiredCount} obligatoire${requiredCount > 1 ? "s" : ""} au dépôt en ligne`}
              </span>
            ) : null}
          </SectionTitle>
          {announced.length > 0 ? (
            <ul className="grid max-w-[76ch] gap-2">
              {announced.map((piece, i) => (
                <li key={i} className="flex flex-wrap gap-x-2.5 rounded-[10px] bg-muted/60 px-3.5 py-3 text-sm">
                  <span className="font-bold">{piece.label}</span>
                  {piece.description ? (
                    <span className="text-muted-foreground">— {piece.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {/* Le contrepoids, JAMAIS fusionné avec l'annonce (contrat 1.24.0) :
              l'annonce habille, le formulaire fait foi pour le dépôt. */}
          {pieces ? (
            <div className="mt-3 max-w-[76ch] rounded-[10px] border border-border p-3.5">
              <p className="text-xs font-bold text-muted-foreground">
                Ce que le formulaire de dépôt en ligne fait téléverser
              </p>
              {pieces.length === 0 ? (
                <p className="mt-1 text-[13px]">Aucune pièce.</p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {pieces.map((piece, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                      <span className="font-semibold">{piece.label}</span>
                      <span className="text-muted-foreground">— {piece.requirement}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {userFaq.length > 0 ? (
        <>
          <SectionTitle>FAQ usager</SectionTitle>
          <div className="max-w-[76ch] border-t border-border text-sm">
            {userFaq.map((item, i) => (
              <div key={i} className="flex flex-col gap-1 border-b border-border px-0.5 py-3">
                <span className="font-semibold">{item.question}</span>
                <span className="leading-relaxed text-muted-foreground">{item.answer}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---- Interne — agent ----------------------------------------------------------------

function InternalHeading({ title, caption }: { title: string; caption: string }) {
  return (
    <>
      <h3 className="mb-1.5 text-[17px] font-extrabold">{title}</h3>
      <p className="mb-5 text-[13px] text-muted-foreground">{caption}</p>
    </>
  );
}

function InternalText({ title, caption = "Interne — ne pas lire tel quel à l'usager.", source }: {
  title: string;
  caption?: string;
  source: string;
}) {
  return (
    <div>
      <InternalHeading title={title} caption={caption} />
      <Markdown source={source} className="max-w-[72ch] text-sm leading-[1.65]" />
    </div>
  );
}

function VigilanceTab({ rules }: { rules: string[] }) {
  return (
    <div>
      <InternalHeading
        title="Points de vigilance"
        caption={`Garde-fous — ${rules.length} règle${rules.length > 1 ? "s" : ""} à ne pas franchir sur cette démarche.`}
      />
      <ol className="grid max-w-[76ch] gap-2.5">
        {rules.map((rule, i) => (
          <li
            key={i}
            className="flex gap-3 rounded-[10px] border border-secondary bg-secondary/[0.18] px-4 py-3.5"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-extrabold text-secondary-foreground">
              {i + 1}
            </span>
            <p className="text-sm leading-relaxed">{rule}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AgentFaqTab({ items }: { items: { question: string; answer: string }[] }) {
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div>
      <InternalHeading title="FAQ agent" caption="Les cas que le service a documentés pour le guichet." />
      <div className="max-w-[76ch] border-t border-border">
        {items.map((item, i) => {
          const expanded = open === i;
          return (
            <div key={i}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : i)}
                className="flex w-full items-center justify-between gap-4 border-b border-border px-0.5 py-[15px] text-left text-sm font-bold transition-colors hover:text-primary"
              >
                <span>{item.question || "Sans question"}</span>
                {expanded
                  ? <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  : <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </button>
              {expanded ? (
                <div className="border-b border-border px-0.5 pb-4 pt-3">
                  <Markdown source={item.answer} className="text-sm leading-[1.65] text-muted-foreground" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinksTab({ organizationId, socleProcedureId, fiche }: {
  organizationId: string;
  socleProcedureId: string;
  fiche: ProcedureFiche;
}) {
  const documentUrl = useProcedureDocumentUrl();
  const [opening, setOpening] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function openDocument(doc: KnowledgeDocument) {
    setError(null);
    setOpening(doc.path);
    try {
      // Le chemin est confronté côté serveur à la démarche rechargée : seul un
      // document d'aide AGENT de celle-ci peut être signé.
      const url = await documentUrl.mutateAsync({ organizationId, socleProcedureId, path: doc.path });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document indisponible.");
    } finally {
      setOpening(null);
    }
  }

  const cardClass =
    "flex items-start gap-3 rounded-[10px] border border-border bg-card p-3.5 text-left transition-shadow hover:border-primary/40 hover:shadow-airbnb-md";

  return (
    <div>
      <InternalHeading
        title="Liens et documents"
        caption="Ouverture dans un nouvel onglet — la demande en cours reste enregistrée."
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {fiche.knowledge.agentLinks.map((link, i) => (
          <a key={`l${i}`} href={link.url} target="_blank" rel="noreferrer noopener" className={cardClass}>
            <ExternalLink className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block break-words text-sm font-bold">{link.description || link.url}</span>
              {link.description ? (
                <span className="block break-all text-[13px] text-muted-foreground">{link.url}</span>
              ) : null}
            </span>
          </a>
        ))}
        {fiche.knowledge.agentDocuments.map((doc) => (
          <button
            key={doc.path}
            type="button"
            disabled={opening !== null}
            onClick={() => void openDocument(doc)}
            className={cn(cardClass, "disabled:cursor-wait")}
          >
            {opening === doc.path
              ? <Loader2 className="mt-0.5 size-[18px] shrink-0 animate-spin text-primary" aria-hidden="true" />
              : <FileText className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden="true" />}
            <span className="min-w-0">
              <span className="block break-words text-sm font-bold">{doc.name}</span>
              <span className="block text-[13px] text-muted-foreground">Document d'aide du service</span>
            </span>
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-3 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

// ---- Aide -------------------------------------------------------------------------

function AssistantTab() {
  return (
    // ⚠️ Chaîne de hauteur : ce conteneur ne défile pas, il TRANSMET la hauteur
    // pour que `AssistantPane` épingle sa zone de saisie (voir son en-tête).
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border pb-3.5">
        <div>
          <h3 className="text-[17px] font-extrabold">Assistant</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Répond à partir de la fiche de cette démarche : consignes du service et textes publiés
            pour l'usager.
          </p>
        </div>
      </div>
      <AssistantPane
        wide
        starters={GUICHET_STARTERS}
        emptyHint="L'assistant n'est pas disponible pour cette démarche."
      />
    </div>
  );
}
