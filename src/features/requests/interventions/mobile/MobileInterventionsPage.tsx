// « Mes interventions » — page MOBILE (`/interventions`), maquette
// « Iris mobile — v2 » écran 7 : les sollicitations de l'intervenant, dans le
// tenant courant, regroupées par échéance (`mobileInterventions.ts`) plutôt
// que présentées en tableau — un relevé de tâches du jour, au pouce. Même
// source et mêmes gardes que la page de bureau (`MesInterventionsPage`) :
// c'est le RLS qui borne la liste, `canComplete` qui ouvre le geste.

import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Navigation } from "lucide-react";
import {
  MobileCard, MobileCardButton, MobileChip, MobileEmpty, MobileGroupLabel, MobileHeader, MobileNotice,
} from "@/components/layout/mobile/MobilePage";
import { Button } from "@/components/ui/button";
import { Pill, type PillTone } from "@/components/ui/surface";
import { useAuth } from "@/features/auth/AuthProvider";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { useTenant } from "@/features/tenant/TenantProvider";
import { googleMapsDirectionsUrl } from "@/lib/carto";
import { cn } from "@/lib/utils";
import { memberName } from "../../instruction/instruction";
import { directionsTarget, interventionLocation } from "../../instruction/lieu";
import { useTenantMembers } from "../../useRequests";
import {
  canComplete, formatDay, interventionTone, isLate, isoDay, type CompletionDraft,
} from "../interventions";
import { useCompleteIntervention, useMyInterventionsWithPlace, type MyInterventionPlaceRow } from "../useInterventions";
import { counts, filterByStatus, groupInterventions, requestedByLine, type MobileFilter } from "./mobileInterventions";
import { DeclarerInterventionSheet } from "./DeclarerInterventionSheet";

const FILTER_PARAM = "filtre";

function isMobileFilter(value: string | null): value is MobileFilter {
  return value === "a_faire" || value === "realisees";
}

interface CardProps {
  row: MyInterventionPlaceRow;
  today: string;
  userId: string | null;
  nameOf: (userId: string | null) => string;
  onOpen: () => void;
  onDeclare: () => void;
}

/** Carte « à faire » (statut `demandee`) : adresse, ce qui est attendu, geste. */
function TodoCard({ row, today, userId, nameOf, onOpen, onDeclare }: CardProps) {
  const request = row.request;
  const location = request ? interventionLocation(request.procedure_snapshot, request.form_data) : null;
  const hasLocation = Boolean(location && !location.empty && location.query !== "");
  const addressLine = hasLocation ? location!.query : (request?.socle_organization_label ?? "—");
  const tone: PillTone = interventionTone(row, today);
  const late = isLate(row, today);
  const directionsUrl = hasLocation ? googleMapsDirectionsUrl(directionsTarget(location!)) : null;
  const canFinish = canComplete(row, userId);
  const comment = (row.request_comment ?? "").trim();

  return (
    <MobileCard>
      <button type="button" onClick={onOpen} className="flex items-start gap-2.5 text-left">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[17px] font-bold leading-tight">{request?.subject ?? "Demande inaccessible"}</span>
          <span className="truncate text-[13px] leading-snug text-muted-foreground">
            {addressLine}
            {request ? ` · ${request.reference}` : ""}
          </span>
        </div>
        <Pill tone={tone} className="mt-0.5 shrink-0">{late ? "En retard" : "À faire"}</Pill>
      </button>

      <p className="text-sm leading-snug text-foreground">
        {comment ? `${comment}${comment.endsWith(".") ? "" : "."} ` : ""}
        {requestedByLine(row, nameOf, today)}.
      </p>

      {canFinish || directionsUrl ? (
        <div className="flex gap-2.5">
          {canFinish ? (
            <Button
              type="button"
              size="lg"
              className={cn("h-12 rounded-[14px] text-base", directionsUrl ? "flex-1" : "w-full")}
              onClick={onDeclare}
            >
              Déclarer réalisée
            </Button>
          ) : null}
          {directionsUrl ? (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Itinéraire vers le lieu d'intervention"
              className="flex size-12 shrink-0 items-center justify-center rounded-[14px] border border-border bg-card text-foreground shadow-airbnb-sm transition-colors hover:bg-muted/40 active:scale-[0.98]"
            >
              <Navigation className="size-[22px]" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
    </MobileCard>
  );
}

/** Carte compacte « réalisée » : rappel + accès à la fiche. */
function DoneCard({ row, onOpen }: { row: MyInterventionPlaceRow; onOpen: () => void }) {
  return (
    <MobileCardButton onClick={onOpen}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[16px] font-bold leading-tight">{row.request?.subject ?? "Demande inaccessible"}</span>
        <Pill tone="ok" className="shrink-0">Réalisée</Pill>
      </div>
      <span className="text-[13px] text-muted-foreground">
        Réalisée le {formatDay(row.completed_on)}
        {row.completion_comment ? " · compte rendu envoyé" : ""}
      </span>
    </MobileCardButton>
  );
}

export function MobileInterventionsPage() {
  const { current } = useTenant();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const orgId = current?.organizationId ?? "";
  const userId = session?.user.id ?? null;

  const list = useMyInterventionsWithPlace(orgId);
  const members = useTenantMembers(orgId);
  const complete = useCompleteIntervention();
  const [declaring, setDeclaring] = React.useState<MyInterventionPlaceRow | null>(null);
  const [completeError, setCompleteError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const today = isoDay(new Date());
  const filter: MobileFilter = isMobileFilter(searchParams.get(FILTER_PARAM))
    ? (searchParams.get(FILTER_PARAM) as MobileFilter)
    : "a_faire";
  const nameOf = React.useCallback(
    (id: string | null) => memberName(members.data ?? [], id),
    [members.data],
  );

  function setFilter(next: MobileFilter) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(FILTER_PARAM, next);
        return params;
      },
      { replace: true },
    );
  }

  async function submitCompletion(draft: CompletionDraft) {
    if (!declaring) return;
    setCompleteError(null);
    try {
      const result = await complete.mutateAsync({
        interventionId: declaring.id,
        requestId: declaring.request_id,
        organizationId: declaring.organization_id,
        completedOn: draft.completedOn,
        comment: draft.comment,
        files: draft.files,
      });
      setDeclaring(null);
      setNotice(
        result.attachments > 0
          ? `Intervention déclarée réalisée le ${formatDay(draft.completedOn)} — ${result.attachments} justificatif${result.attachments > 1 ? "s" : ""} joint${result.attachments > 1 ? "s" : ""}.`
          : `Intervention déclarée réalisée le ${formatDay(draft.completedOn)}.`,
      );
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "Enregistrement refusé.");
    }
  }

  if (!current) return null;

  const rows = list.data ?? [];
  const tally = counts(rows);
  const filtered = filterByStatus(rows, filter);
  const groups = groupInterventions(filtered, today);

  return (
    <div className="flex min-h-full flex-col">
      <MobileHeader
        title="Mes interventions"
        subtitle={`${current.organizationName} · ${rows.length} sollicitation${rows.length > 1 ? "s" : ""}`}
        trailing={<NotificationBell />}
      >
        <div className="flex gap-2">
          <MobileChip active={filter === "a_faire"} onClick={() => setFilter("a_faire")}>
            À faire {tally.aFaire}
          </MobileChip>
          <MobileChip active={filter === "realisees"} onClick={() => setFilter("realisees")}>
            Réalisées {tally.realisees}
          </MobileChip>
        </div>
      </MobileHeader>

      <div className="flex flex-1 flex-col gap-4 p-4">
        {notice ? <MobileNotice tone="ok">{notice}</MobileNotice> : null}

        {list.isLoading ? (
          <MobileEmpty>Chargement…</MobileEmpty>
        ) : list.isError ? (
          <MobileEmpty tone="error">Les interventions n'ont pas pu être lues.</MobileEmpty>
        ) : filtered.length === 0 ? (
          <MobileEmpty>
            {filter === "a_faire" ? "Aucune intervention à réaliser." : "Aucune intervention réalisée."}
          </MobileEmpty>
        ) : (
          groups.map((group) => (
            <div key={group.bucket} className="flex flex-col gap-2">
              <MobileGroupLabel>{group.label}</MobileGroupLabel>
              {group.items.map((row) =>
                row.status === "realisee" ? (
                  <DoneCard key={row.id} row={row} onOpen={() => navigate(`/demandes/${row.request_id}`)} />
                ) : (
                  <TodoCard
                    key={row.id}
                    row={row}
                    today={today}
                    userId={userId}
                    nameOf={nameOf}
                    onOpen={() => navigate(`/demandes/${row.request_id}`)}
                    onDeclare={() => { setCompleteError(null); setNotice(null); setDeclaring(row); }}
                  />
                ),
              )}
            </div>
          ))
        )}

        {!list.isLoading ? (
          <button
            type="button"
            onClick={() => void list.refetch()}
            className="self-center px-3 py-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Actualiser
          </button>
        ) : null}
      </div>

      <DeclarerInterventionSheet
        intervention={declaring}
        requestLabel={declaring?.request ? `${declaring.request.reference} — ${declaring.request.subject}` : null}
        pending={complete.isPending}
        progress={complete.progress}
        error={completeError}
        onClose={() => { setDeclaring(null); setCompleteError(null); }}
        onSubmit={(draft) => void submitCompletion(draft)}
      />
    </div>
  );
}
