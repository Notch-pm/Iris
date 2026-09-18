// Tuile d'une démarche — PARTAGÉE par l'étape « Démarche » du guichet
// (`ProcedurePicker`, avec ses boutons « i » et « Choisir ») et par la base de
// connaissances (`features/knowledge`, lien vers la fiche, avec en plus le
// public concerné et les organismes qui proposent la démarche). Une seule
// grammaire : une démarche se reconnaît au même dessin sur les deux écrans.
//
// Ce module ne pose que le CONTENU et le style de la tuile ; son conteneur
// (un `<li>` cliquable au guichet, un `<Link>` dans la base) appartient à
// l'écran. ⚠️ Le conteneur doit porter `procedureTileClass`, qui le rend
// `relative` : sans ancêtre positionné, un libellé `sr-only` (position
// absolue) se placerait par rapport à la PAGE et l'allongerait sous la zone
// qui défile — un second ascenseur, vécu le 2026-09-18.

import * as React from "react";
import { Building2, CalendarRange, EyeOff, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  portalAbsenceLabel,
  publicationPeriodLabel,
  type ProcedurePublication,
} from "@fn/_shared/procedures/publication";
import { procedureTypeLabel } from "./procedureSearch";

export function procedureTileClass(selected = false): string {
  return cn(
    "relative flex w-full flex-col gap-1.5 rounded-[14px] border bg-card p-3.5 text-left transition-shadow",
    selected
      ? "border-primary bg-primary/[0.04] shadow-airbnb-md"
      : "border-border shadow-airbnb-sm hover:shadow-airbnb-md",
  );
}

interface Props {
  name: string;
  category: string | null;
  type: string | null;
  publication: ProcedurePublication;
  /** « 3 demandes ce mois » — absent tant que le compte n'est pas chargé. */
  volume: string | null;
  /** Boutons de l'écran hôte, à droite du nom (« i », « Choisir »). */
  actions?: React.ReactNode;
  /** Publics admis au dépôt, libellés — la base de connaissances les affiche. */
  audiences?: string[];
  /** Organismes qui proposent la démarche, déjà abrégés. `null` = aucun. */
  organismes?: string | null;
}

export function ProcedureTileBody({
  name, category, type, publication, volume, actions, audiences, organismes,
}: Props) {
  const meta = [category, procedureTypeLabel(type)].filter(Boolean);
  const horsPortail = portalAbsenceLabel(publication);
  const periode = publicationPeriodLabel(publication);
  return (
    <>
      <span className="flex items-start justify-between gap-2.5">
        <span className="text-[15px] font-bold leading-tight">{name}</span>
        {actions ? <span className="flex shrink-0 items-center gap-1.5">{actions}</span> : null}
      </span>
      <span className="text-xs text-muted-foreground">
        {meta.length > 0 ? meta.join(" · ") : "Sans catégorie"}
      </span>
      {horsPortail || periode ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {horsPortail ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground">
              <EyeOff className="size-3" aria-hidden="true" />
              {horsPortail}
            </span>
          ) : null}
          {periode ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <CalendarRange className="size-3" aria-hidden="true" />
              {periode}
            </span>
          ) : null}
        </span>
      ) : null}
      {audiences && audiences.length > 0 ? (
        <span className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Users className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>
            <span className="sr-only">Public concerné : </span>
            {audiences.join(" · ")}
          </span>
        </span>
      ) : null}
      {organismes !== undefined ? (
        <span className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Building2 className="mt-px size-3 shrink-0" aria-hidden="true" />
          {organismes ? (
            <span>
              <span className="sr-only">Proposée par : </span>
              {organismes}
            </span>
          ) : (
            <span className="italic">Proposée par aucun organisme</span>
          )}
        </span>
      ) : null}
      {volume ? (
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
          {volume}
        </span>
      ) : null}
    </>
  );
}
