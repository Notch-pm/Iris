// Rail latéral de la fiche d'instruction : prise en charge (urgence, agent
// instructeur, organisme responsable), avancement (étapes du cycle de vie +
// action principale) et usager (identité RELUE dans le Socle quand elle est
// disponible, écarts avec le dépôt, correction sur place, autres demandes du
// même usager Socle). Les droits restent portés par le RLS / la garde SQL :
// `editable` ne fait que refléter.

import * as React from "react";
import { Link } from "react-router-dom";
import { Building2, Check, ChevronDown, ChevronUp, ChevronsUp, History, Loader2, Minus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownDivider, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import type { TransferOption } from "./transfert";
import type { TransitionSpec } from "../statuts";
import type { RequestSummary, TenantMember } from "../useRequests";
import { Avatar, SOON, Surface } from "@/components/ui/surface";
import {
  initials,
  memberName,
  PRIORITY_OPTIONS,
  priorityOption,
  type IdentityChange,
  type PriorityTone,
  type RequesterIdentity,
  type StageView,
} from "./instruction";

// ---- Prise en charge ----------------------------------------------------------

const PRIORITY_ICON: Record<string, typeof Minus> = {
  basse: ChevronDown,
  normale: Minus,
  haute: ChevronUp,
  urgente: ChevronsUp,
};

const TONE_TEXT: Record<PriorityTone, string> = {
  muted: "text-muted-foreground",
  warn: "text-secondary-foreground",
  danger: "text-destructive",
};

const TONE_BG: Record<PriorityTone, string> = {
  muted: "bg-background",
  warn: "bg-secondary/20",
  danger: "bg-destructive/5",
};

interface PriseEnChargeProps {
  priority: string;
  assignedTo: string | null;
  /** Libellé de l'organisme qui porte la demande aujourd'hui. */
  serviceLabel: string | null;
  members: TenantMember[];
  /** Organismes qui assurent cette démarche — seuls transferts possibles. */
  organismes: TransferOption[];
  editable: boolean;
  pending: boolean;
  onPriority: (priority: string) => void;
  onAssign: (userId: string | null) => void;
  /** Ouvre la confirmation de transfert : rien n'est écrit avant elle. */
  onTransfer: (socleOrgId: string) => void;
}

export function PriseEnChargeCard({
  priority, assignedTo, serviceLabel, members, organismes, editable, pending,
  onPriority, onAssign, onTransfer,
}: PriseEnChargeProps) {
  const [menu, setMenu] = React.useState<"urgence" | "agent" | null>(null);
  const option = priorityOption(priority);
  const Icon = PRIORITY_ICON[option.key] ?? Minus;
  const agentName = assignedTo ? memberName(members, assignedTo) : null;

  return (
    <Surface className="gap-2.5 px-3.5 py-[13px]">
      <span className="text-[12.5px] font-bold">Prise en charge</span>
      <div className="flex flex-col gap-2">
        <Dropdown
          open={menu === "urgence"}
          onOpenChange={(o) => setMenu(o ? "urgence" : null)}
          trigger={(p) => (
            <button
              type="button"
              {...p}
              disabled={!editable || pending}
              className={cn(
                "flex h-[38px] w-full items-center gap-2 rounded-[10px] border px-3 text-left text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                menu === "urgence" ? "border-primary" : "border-border",
                TONE_BG[option.tone],
              )}
            >
              <Icon className={cn("size-3.5 shrink-0", TONE_TEXT[option.tone])} strokeWidth={2.6} aria-hidden="true" />
              <span className="flex-1">Urgence {option.label.toLowerCase()}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" aria-hidden="true" />
            </button>
          )}
        >
          {PRIORITY_OPTIONS.map((o) => {
            const ItemIcon = PRIORITY_ICON[o.key] ?? Minus;
            return (
              <DropdownItem
                key={o.key}
                active={o.key === priority}
                onClick={() => { setMenu(null); if (o.key !== priority) onPriority(o.key); }}
              >
                <ItemIcon className={cn("size-[13px] shrink-0", TONE_TEXT[o.tone])} strokeWidth={2.6} aria-hidden="true" />
                <span className="flex min-w-0 flex-col items-start gap-px">
                  <span className="font-bold">{o.label}</span>
                  <span className="text-[11px] font-normal leading-snug text-muted-foreground">{o.hint}</span>
                </span>
              </DropdownItem>
            );
          })}
        </Dropdown>

        <Dropdown
          open={menu === "agent"}
          onOpenChange={(o) => setMenu(o ? "agent" : null)}
          // Détaché dans le `body` et borné en hauteur : le rail est une
          // colonne défilante (`lg:overflow-y-auto`), qui rognerait un menu
          // long — agents du tenant PLUS organismes du sous-arbre.
          portal
          menuClassName="max-h-[min(70vh,420px)] overflow-y-auto"
          trigger={(p) => (
            <button
              type="button"
              {...p}
              disabled={!editable || pending}
              title={`Affectation — ${agentName ?? "non affectée"}`}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-[9px] rounded-[10px] border bg-background py-[5px] pl-[5px] pr-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                menu === "agent" ? "border-primary" : "border-border",
              )}
            >
              <Avatar initials={agentName ? initials(agentName) : "?"} muted={!agentName} className="h-7 w-7 text-[10.5px]" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12.5px] font-bold">{agentName ?? "Non affectée"}</span>
                <span className="truncate text-[10.5px] font-semibold text-muted-foreground">
                  {serviceLabel ?? "Aucun organisme désigné"}
                </span>
              </span>
              <ChevronDown className="size-3 shrink-0 opacity-50" aria-hidden="true" />
            </button>
          )}
        >
          <DropdownLabel>Agent instructeur</DropdownLabel>
          {members.map((m) => (
            <DropdownItem
              key={m.userId}
              active={m.userId === assignedTo}
              onClick={() => { setMenu(null); if (m.userId !== assignedTo) onAssign(m.userId); }}
            >
              <Avatar initials={initials(m.displayName)} size="sm" className="bg-primary/10 text-primary" />
              <span className="flex-1 truncate font-bold">{m.displayName}</span>
              {m.userId === assignedTo ? <Check className="size-[13px] shrink-0 text-primary" strokeWidth={2.6} aria-hidden="true" /> : null}
            </DropdownItem>
          ))}
          <DropdownItem
            active={assignedTo === null}
            onClick={() => { setMenu(null); if (assignedTo !== null) onAssign(null); }}
          >
            <Avatar initials="?" size="sm" muted />
            <span className="flex-1 font-bold">Non affectée</span>
            {assignedTo === null ? <Check className="size-[13px] shrink-0 text-primary" strokeWidth={2.6} aria-hidden="true" /> : null}
          </DropdownItem>
          <DropdownDivider />
          <DropdownLabel>Organisme responsable</DropdownLabel>
          {organismes.length === 0 ? (
            <p className="px-[9px] py-2 text-[11.5px] leading-snug text-muted-foreground">
              Aucun autre organisme du territoire n'assure cette démarche.
            </p>
          ) : (
            organismes.map((o) => (
              <DropdownItem
                key={o.value}
                active={o.current}
                onClick={() => { setMenu(null); if (!o.current) onTransfer(o.value); }}
              >
                <Building2 className="size-[13px] shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 truncate font-bold">{o.label}</span>
                {o.current ? <Check className="size-[13px] shrink-0 text-primary" strokeWidth={2.6} aria-hidden="true" /> : null}
              </DropdownItem>
            ))
          )}
        </Dropdown>
      </div>
    </Surface>
  );
}

// ---- Avancement ---------------------------------------------------------------

interface AvancementProps {
  reference: string;
  stages: StageView[];
  /** Action principale (transition « vers l'avant ») — null si aucune. */
  primary: TransitionSpec | null;
  /** Libellé inerte quand aucune action principale n'existe (archivée, clôturée…). */
  fallbackLabel: string | null;
  /**
   * Pourquoi l'action principale est fermée alors qu'elle existe — aujourd'hui :
   * des pièces obligatoires ne sont pas conformes. Miroir de la garde SQL t17,
   * qui reste l'autorité ; ici on explique, on ne protège pas. Un bouton grisé
   * sans motif est le pire des deux mondes.
   */
  blockedReason?: string | null;
  showAction: boolean;
  pending: boolean;
  onPrimary: () => void;
}

export function AvancementCard({
  reference, stages, primary, fallbackLabel, blockedReason, showAction, pending, onPrimary,
}: AvancementProps) {
  return (
    <Surface className="gap-[13px] px-4 py-[15px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-bold">Avancement</span>
        <span className="font-mono text-[11px] font-bold text-muted-foreground">{reference}</span>
      </div>
      <ol className="flex flex-col" aria-label="Étapes de la demande">
        {stages.map((s, i) => {
          const lit = s.state === "done" || s.state === "current";
          return (
            <li key={s.key} className="flex items-stretch gap-[11px]" aria-current={s.state === "current" ? "step" : undefined}>
              <span className="flex shrink-0 flex-col items-center" aria-hidden="true">
                <span
                  className={cn(
                    "mt-[3px] h-[11px] w-[11px] shrink-0 rounded-full",
                    lit ? "bg-primary" : s.state === "skipped" ? "border-2 border-border bg-background" : "bg-border",
                    s.state === "current" && "ring-4 ring-primary/15",
                  )}
                />
                {i < stages.length - 1 ? (
                  <span className={cn("my-[3px] w-0.5 flex-1", s.state === "done" ? "bg-primary" : "bg-border")} />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col gap-px pb-[11px]">
                <span
                  className={cn(
                    "text-[12.5px]",
                    s.state === "current" ? "font-extrabold" : "font-semibold",
                    lit ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
                <span className="text-[11px] text-muted-foreground">{s.hint}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {showAction ? (
        primary ? (
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              className="w-full"
              disabled={pending || Boolean(blockedReason)}
              title={blockedReason ?? undefined}
              onClick={onPrimary}
            >
              {pending ? "Application…" : primary.label}
            </Button>
            {blockedReason ? (
              <p className="text-[11.5px] text-muted-foreground">{blockedReason}</p>
            ) : null}
          </div>
        ) : fallbackLabel ? (
          <Button type="button" className="w-full" disabled>{fallbackLabel}</Button>
        ) : null
      ) : null}
    </Surface>
  );
}

// ---- Usager -------------------------------------------------------------------

interface UsagerProps {
  /** Identité AFFICHÉE : la fiche Socle relue si elle l'a été, sinon le dépôt. */
  identity: RequesterIdentity;
  /** Écarts entre l'identité du dépôt et celle d'aujourd'hui (vide si aucun). */
  changes: IdentityChange[];
  socleContactId: string | null;
  /** La relecture de la fiche Socle a échoué : on n'affiche que le dépôt. */
  identityError: boolean;
  /** Relecture EN COURS : on attend plutôt que de montrer le dépôt puis basculer. */
  identityPending: boolean;
  otherRequests: RequestSummary[];
  otherLoading: boolean;
  /** Reflet du droit de création dans le tenant (garde réelle : socle-proxy).
   *  Le bouton est POSÉ dès le départ et seulement désactivé tant que la fiche
   *  n'est pas là : le voir surgir en cours de chargement déplacerait l'en-tête. */
  canEdit: boolean;
  onEdit: () => void;
}

export function UsagerCard({
  identity, changes, socleContactId, identityError, identityPending,
  otherRequests, otherLoading, canEdit, onEdit,
}: UsagerProps) {
  const [open, setOpen] = React.useState(false);
  const [showDeposited, setShowDeposited] = React.useState(false);
  const n = otherRequests.length;

  return (
    <Surface className="gap-3 px-4 py-[15px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-bold">Usager</span>
        <span className="flex items-center gap-0.5">
          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-[26px] gap-1 px-2 text-[11.5px]"
              onClick={onEdit}
              disabled={identityPending || identityError}
              aria-disabled={identityPending || identityError}
              title={
                identityPending ? "Lecture de la fiche dans le Socle…"
                  : identityError ? "Fiche du Socle illisible — modification impossible"
                    : "Corriger la fiche de l'usager dans le Socle"
              }
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Modifier
            </Button>
          ) : null}
          {socleContactId ? (
            <Button asChild variant="ghost" size="sm" className="h-[26px] px-2 text-[11.5px]">
              <Link to={`/usagers/${socleContactId}`}>Voir la fiche</Link>
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-[26px] px-2 text-[11.5px]"
              disabled
              aria-disabled="true"
              title="Aucun usager rapproché — identité déclarée au dépôt"
            >
              Voir la fiche
            </Button>
          )}
        </span>
      </div>
      {/* Pendant la relecture on ATTEND explicitement : afficher le dépôt puis
          basculer sur la fiche du jour faisait clignoter les champs qui ont
          justement changé — c'est-à-dire les seuls qui comptent ici. */}
      {identityPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <div className="flex items-center gap-[11px]">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="h-3 w-2/3 animate-pulse rounded bg-muted" aria-hidden="true" />
              <span className="h-2.5 w-1/2 animate-pulse rounded bg-muted" aria-hidden="true" />
            </span>
          </div>
          <div className="flex flex-col gap-2" aria-hidden="true">
            <span className="h-2.5 w-full animate-pulse rounded bg-muted" />
            <span className="h-2.5 w-5/6 animate-pulse rounded bg-muted" />
            <span className="h-2.5 w-3/4 animate-pulse rounded bg-muted" />
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Lecture de la fiche dans le Socle…
          </p>
        </div>
      ) : (
        <>
      <div className="flex items-center gap-[11px]">
        <Avatar initials={identity.initials} size="lg" muted={identity.anonymous || !identity.known} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-bold">{identity.name}</span>
          {identity.subtitle ? <span className="text-[11.5px] text-muted-foreground">{identity.subtitle}</span> : null}
        </span>
      </div>
      {identity.rows.length > 0 ? (
        <dl className="flex flex-col gap-2">
          {identity.rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-3 text-[12.5px]">
              <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words text-right font-semibold">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : identity.anonymous ? (
        <p className="text-xs text-muted-foreground">Aucune notification possible — dépôt anonyme assumé par l'agent.</p>
      ) : null}
      {/* L'identité affichée est celle du Socle AUJOURD'HUI ; celle retenue au
          dépôt reste la pièce du dossier et se relit ici, avec ses écarts. */}
      {changes.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl bg-secondary/25 p-2.5">
          <button
            type="button"
            className="flex items-center gap-1.5 text-left text-[11.5px] font-semibold text-secondary-foreground"
            onClick={() => setShowDeposited((v) => !v)}
            aria-expanded={showDeposited}
          >
            <History className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {changes.length} champ{changes.length > 1 ? "s" : ""} modifié{changes.length > 1 ? "s" : ""} depuis le dépôt
            </span>
            {showDeposited
              ? <ChevronUp className="size-3.5 shrink-0" aria-hidden="true" />
              : <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />}
          </button>
          {showDeposited ? (
            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Identité retenue au dépôt
              </p>
              <dl className="flex flex-col gap-1.5">
                {changes.map((c) => (
                  <div key={c.label} className="flex justify-between gap-3 text-[12px]">
                    <dt className="shrink-0 text-muted-foreground">{c.label}</dt>
                    <dd className="min-w-0 break-words text-right font-semibold">
                      {c.before ?? <span className="font-normal italic text-muted-foreground">non renseigné</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}
      {identityError ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Identité retenue au dépôt : la fiche du Socle n'a pas pu être relue.
        </p>
      ) : null}
        </>
      )}
      {socleContactId ? (
        <p className="truncate font-mono text-[10.5px] text-muted-foreground" title={socleContactId}>Socle · {socleContactId}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-2.5">
        <Button type="button" variant="outline" size="sm" className="h-[30px] text-xs" {...SOON}>Contacter</Button>
        {socleContactId ? (
          <Dropdown
            open={open}
            onOpenChange={setOpen}
            align="right"
            side="top"
            menuClassName="min-w-[300px] max-w-[340px]"
            trigger={(p) => (
              <Button type="button" variant="ghost" size="sm" className="h-[30px] text-xs" {...p}
                disabled={otherLoading || n === 0}>
                {otherLoading ? "Demandes…" : n === 0 ? "Aucune autre demande" : `${n} autre${n > 1 ? "s" : ""} demande${n > 1 ? "s" : ""}`}
              </Button>
            )}
          >
            <DropdownLabel>Autres demandes de cet usager</DropdownLabel>
            {otherRequests.map((r) => (
              <Link
                key={r.id}
                to={`/demandes/${r.id}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-[9px] px-[9px] py-2 text-[12.5px] transition-colors hover:bg-secondary/50"
              >
                <span className="font-mono text-[11px] font-bold">{r.reference}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.socle_procedure_label ?? r.subject}</span>
                <StatusBadge status={r.status} />
              </Link>
            ))}
          </Dropdown>
        ) : null}
      </div>
    </Surface>
  );
}
