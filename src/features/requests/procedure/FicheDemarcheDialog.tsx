// « Fiche démarche » — la fenêtre qu'ouvre le bouton « i » d'une carte, à
// l'étape Démarche du parcours de création (maquette Claude Design « Écran
// agent — fiche démarche », 2026-09-18).
//
// Les rubriques elles-mêmes vivent dans `FicheSections.tsx`, partagées avec
// l'écran « Base de connaissances ».
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
import { EyeOff, Loader2, X } from "lucide-react";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SocleProcedureRow } from "@/features/socle/useSocleCatalog";
import { portalAbsenceLabel, publicationPeriodLabel } from "@fn/_shared/procedures/publication";
import { AssistantPane } from "../assistant/AssistantPane";
import { AssistantThreadProvider } from "../assistant/AssistantThreadProvider";
import { procedureTypeLabel } from "../creation/procedureSearch";
import { DEMARCHE_STARTERS, internalNav, resolveTab, type FicheTab } from "./ficheDemarche";
import { FicheTabContent, NavButton, NavGroup } from "./FicheSections";
import { useProcedureFiche } from "./useProcedureKnowledge";


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
          ) : (
            <FicheTabContent
              tab={tab}
              fiche={data}
              organizationId={organizationId}
              socleProcedureId={row.socle_id}
              portalVisible={row.publication.portalVisible}
              size="dialog"
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
        starters={DEMARCHE_STARTERS}
        emptyHint="L'assistant n'est pas disponible pour cette démarche."
      />
    </div>
  );
}
