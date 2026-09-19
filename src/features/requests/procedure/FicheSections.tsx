// Les rubriques d'une fiche de démarche — PARTAGÉES par deux écrans :
//  - la « Fiche démarche » du guichet (`FicheDemarcheDialog`, taille `dialog`) ;
//  - la « Base de connaissances » (`features/knowledge`, taille `page`,
//    maquette Claude Design « Base de connaissance », 2026-09-18).
// Même contenu, même vocabulaire, deux typographies : une fenêtre de 1 080 px
// et une colonne de lecture de 820 px.
//
// ⚠️ LES PIÈGES DU CONTRAT SOCLE 1.24.0, TENUS ICI POUR LES DEUX ÉCRANS :
//  - trois durées : « Temps de saisie du formulaire » et « Délai d'instruction
//    annoncé » sont nommés pour ne pas se confondre, et une valeur absente ne
//    produit AUCUNE carte ni aucun texte de remplacement ;
//  - `audience.note` ne filtre rien : les publics ADMIS sont posés à côté, et
//    font foi ;
//  - pièces ANNONCÉES et pièces du FORMULAIRE : deux listes, jamais fusionnées ;
//  - deux FAQ : « FAQ usager » côté usager, « FAQ agent » côté interne.

import * as React from "react";
import {
  ExternalLink, Eye, FileText, Link2, Loader2, MessageSquare, Minus, Plus,
  Sparkles, SquareCheckBig, TriangleAlert, Workflow,
} from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import type { KnowledgeDocument } from "@fn/socle-proxy/_shared/knowledge";
import {
  hasUserContent,
  inputDurationLabel,
  type FicheTab,
  type ProcedureFiche,
} from "./ficheDemarche";
import { useProcedureDocumentUrl } from "./useProcedureKnowledge";

export type FicheSize = "dialog" | "page";

/** Typographie des deux écrans — le seul endroit où ils diffèrent. */
const T = {
  dialog: {
    heading: "text-[17px] font-extrabold",
    caption: "mb-5 text-[13px] text-muted-foreground",
    body: "text-sm leading-[1.65]",
    item: "text-sm",
    section: "mb-2 mt-[22px] text-base font-bold",
    measure: "max-w-[72ch]",
  },
  page: {
    heading: "text-[22px] font-extrabold tracking-tight",
    caption: "mb-[22px] mt-1 text-sm text-muted-foreground",
    body: "text-[15px] leading-[1.65]",
    item: "text-sm",
    section: "mb-2.5 mt-6 text-base font-bold",
    measure: "max-w-[820px]",
  },
} as const;

export const TAB_ICON: Record<FicheTab, React.ComponentType<{ className?: string }>> = {
  usager: Eye,
  consignes: SquareCheckBig,
  vigilance: TriangleAlert,
  procedure: Workflow,
  faq: MessageSquare,
  liens: Link2,
  assistant: Sparkles,
};

// ---- Navigation -------------------------------------------------------------------

export function NavGroup({ label, first = false }: { label: string; first?: boolean }) {
  return (
    <p className={cn(
      "mx-2 mb-2 text-[11px] font-extrabold uppercase tracking-[0.04em] text-muted-foreground",
      first ? "mt-1.5" : "mt-[18px]",
    )}>
      {label}
    </p>
  );
}

/**
 * Générique sur l'onglet : la Base de connaissances y ajoute une rubrique qui
 * n'appartient à aucune démarche (« Recommandations générales ») — elle passe
 * alors son `icon`, `TAB_ICON` ne connaissant que les rubriques d'une fiche.
 */
export function NavButton<T extends string = FicheTab>({ tab, label, count, current, onSelect, icon }: {
  tab: T;
  label: string;
  count?: number;
  current: T;
  onSelect: (tab: T) => void;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const Icon = icon ?? TAB_ICON[tab as FicheTab];
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

export function UsagerSection({ fiche, portalVisible, size, organismes }: {
  fiche: ProcedureFiche;
  portalVisible: boolean;
  size: FicheSize;
  /** Organismes qui proposent la démarche — la base de connaissances les connaît. */
  organismes?: string[];
}) {
  const t = T[size];
  const uc = fiche.userCommunication;
  const saisie = inputDurationLabel(fiche.inputDurationMinutes);
  const note = uc?.audience.note ?? "";
  const announced = uc?.attachments.items ?? [];
  const userFaq = uc?.faq.items ?? [];
  const pieces = fiche.formPieces;
  const requiredCount = pieces?.filter((p) => p.required).length ?? 0;
  const written = hasUserContent(fiche);
  const publishedLine = portalVisible
    ? "Contenu publié sur le portail — vous pouvez le lire tel quel à l'usager."
    : "Textes écrits pour l'usager — vous pouvez les lui lire tels quels. Cette démarche n'est pas visible sur le portail.";
  const emptyLine = fiche.userCommunicationRelayed
    ? "La collectivité n'a encore rien écrit pour les usagers sur cette démarche. Cela se renseigne dans le Référentiel, à l'étape « Communication usager » de la démarche."
    : "Les textes destinés à l'usager n'ont pas pu être lus : la passerelle vers le référentiel n'est pas encore à jour.";

  return (
    <div className={cn("flex min-w-0 flex-col", t.measure)}>
      {size === "page" ? (
        <>
          <h2 className={t.heading}>Ce que voit l'usager</h2>
          <p className={t.caption}>{written ? publishedLine : emptyLine}</p>
        </>
      ) : written ? (
        <div className="mb-5 flex items-center gap-2.5 rounded-[10px] border border-primary/20 bg-primary/[0.07] px-3.5 py-2.5">
          <Eye className="size-[17px] shrink-0 text-primary" aria-hidden="true" />
          <p className="text-[13px] font-semibold">{publishedLine}</p>
        </div>
      ) : (
        <p className="mb-5 rounded-[10px] border border-dashed border-border p-3.5 text-[13px] leading-relaxed text-muted-foreground">
          {emptyLine}
        </p>
      )}

      {saisie || fiche.processingTime || fiche.admittedAudiences.length > 0 || (organismes && organismes.length > 0) ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-3">
          {/* ⚠️ Deux durées côte à côte : c'est là qu'on les confond. Les
              libellés disent laquelle est laquelle. */}
          {saisie ? <Kpi label="Temps de saisie du formulaire" value={saisie} numeric /> : null}
          {fiche.processingTime ? (
            <Kpi label="Délai d'instruction annoncé" value={fiche.processingTime} numeric />
          ) : null}
          {organismes && organismes.length > 0 ? (
            <Kpi label={organismes.length > 1 ? "Organismes" : "Organisme"} value={organismes.join(" · ")} />
          ) : null}
          {fiche.admittedAudiences.length > 0 ? (
            <Kpi label="Publics admis au dépôt" value={fiche.admittedAudiences.join(" · ")} />
          ) : null}
        </div>
      ) : null}

      {fiche.description ? (
        <>
          <h3 className={t.section}>Descriptif</h3>
          <Markdown source={fiche.description} className={t.body} />
        </>
      ) : null}

      {note ? (
        <>
          <h3 className={t.section}>Public concerné</h3>
          <p className={t.body}>{note}</p>
          {fiche.admittedAudiences.length > 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Précision rédigée pour l'usager : elle ne restreint pas le dépôt. En cas de doute,
              les publics admis au dépôt font foi.
            </p>
          ) : null}
        </>
      ) : null}

      {announced.length > 0 || (pieces && pieces.length > 0) ? (
        <>
          <h3 className={t.section}>
            Documents à fournir
            {pieces ? (
              <span className="text-[13px] font-semibold text-muted-foreground">
                {" "}— {requiredCount === 0
                  ? "aucun obligatoire au dépôt en ligne"
                  : `${requiredCount} obligatoire${requiredCount > 1 ? "s" : ""} au dépôt en ligne`}
              </span>
            ) : null}
          </h3>
          {announced.length > 0 ? (
            <ul className="grid gap-2">
              {announced.map((piece, i) => (
                <li key={i} className={cn("flex flex-wrap gap-x-2.5 rounded-[10px] bg-muted/60 px-3.5 py-3", t.item)}>
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
            <div className="mt-3 rounded-[10px] border border-border p-3.5">
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
          <h3 className={t.section}>FAQ usager</h3>
          <div className={cn("border-t border-border", t.item)}>
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

function InternalHeading({ title, caption, size }: { title: string; caption: string; size: FicheSize }) {
  const t = T[size];
  return size === "page" ? (
    <>
      <h2 className={t.heading}>{title}</h2>
      <p className={t.caption}>{caption}</p>
    </>
  ) : (
    <>
      <h3 className={cn("mb-1.5", t.heading)}>{title}</h3>
      <p className={t.caption}>{caption}</p>
    </>
  );
}

export function InternalTextSection({ title, caption = "Interne — ne pas lire tel quel à l'usager.", source, size }: {
  title: string;
  caption?: string;
  source: string;
  size: FicheSize;
}) {
  const t = T[size];
  return (
    <div className={cn("min-w-0", t.measure)}>
      <InternalHeading title={title} caption={caption} size={size} />
      <Markdown source={source} className={t.body} />
    </div>
  );
}

export function VigilanceSection({ rules, size }: { rules: string[]; size: FicheSize }) {
  const t = T[size];
  return (
    <div className={cn("min-w-0", t.measure)}>
      <InternalHeading
        title="Points de vigilance"
        caption={`Garde-fous — ${rules.length} règle${rules.length > 1 ? "s" : ""} à ne pas franchir sur cette démarche.`}
        size={size}
      />
      <ol className="grid gap-2.5">
        {rules.map((rule, i) => (
          <li
            key={i}
            className="flex gap-3 rounded-[10px] border border-secondary bg-secondary/[0.18] px-4 py-3.5"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-extrabold text-secondary-foreground">
              {i + 1}
            </span>
            <p className={cn("leading-relaxed", size === "page" ? "text-[15px]" : "text-sm")}>{rule}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AgentFaqSection({ items, size }: { items: { question: string; answer: string }[]; size: FicheSize }) {
  const t = T[size];
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div className={cn("min-w-0", t.measure)}>
      <InternalHeading title="FAQ agent" caption="Les cas que le service a documentés pour le guichet." size={size} />
      <div className="border-t border-border">
        {items.map((item, i) => {
          const expanded = open === i;
          return (
            <div key={i}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : i)}
                className={cn(
                  "flex w-full items-center justify-between gap-4 border-b border-border px-0.5 text-left font-bold transition-colors hover:text-primary",
                  size === "page" ? "py-4 text-[15px]" : "py-[15px] text-sm",
                )}
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

export function LinksSection({ organizationId, socleProcedureId, fiche, size }: {
  organizationId: string;
  socleProcedureId: string;
  fiche: ProcedureFiche;
  size: FicheSize;
}) {
  const t = T[size];
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
    <div className={cn("min-w-0", t.measure)}>
      <InternalHeading
        title="Liens et documents"
        caption="Ouverture dans un nouvel onglet — l'écran en cours reste ouvert."
        size={size}
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))] gap-3">
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

/**
 * Le contenu d'une rubrique INTERNE ou « usager » — l'aiguillage commun aux
 * deux écrans. L'assistant n'y est pas : chaque écran le pose à sa façon.
 */
export function FicheTabContent({ tab, fiche, organizationId, socleProcedureId, portalVisible, size, organismes }: {
  tab: Exclude<FicheTab, "assistant">;
  fiche: ProcedureFiche;
  organizationId: string;
  socleProcedureId: string;
  portalVisible: boolean;
  size: FicheSize;
  organismes?: string[];
}) {
  switch (tab) {
    case "usager":
      return <UsagerSection fiche={fiche} portalVisible={portalVisible} size={size} organismes={organismes} />;
    case "consignes":
      return <InternalTextSection title="Consignes pour l'agent" source={fiche.knowledge.agentHelpText} size={size} />;
    case "procedure":
      return (
        <InternalTextSection
          title="Procédure de traitement"
          caption="Interne — le circuit du service, du guichet à la clôture."
          source={fiche.knowledge.proceduresText}
          size={size}
        />
      );
    case "vigilance":
      return <VigilanceSection rules={fiche.knowledge.guardrails} size={size} />;
    case "faq":
      return <AgentFaqSection items={fiche.knowledge.faq} size={size} />;
    case "liens":
      return (
        <LinksSection
          organizationId={organizationId}
          socleProcedureId={socleProcedureId}
          fiche={fiche}
          size={size}
        />
      );
  }
}
