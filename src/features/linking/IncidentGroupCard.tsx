// Fiche d'une demande — carte « Même incident » (lot L2 de docs/demandes-liees.md).
//
// Deux choses, dans cet ordre :
//  1. les demandes déjà liées à celle-ci (le GROUPE, tel que le RLS le laisse
//     lire — aucun compteur de demandes invisibles) ;
//  2. sur geste de l'agent seulement, la recherche des demandes APPROCHANTES —
//     rien n'est calculé à la simple consultation (décision PO 2026-10-16).
// Affichée uniquement pour une démarche MUTUALISABLE : ailleurs, elle n'a pas
// de sens (une carte de déchetterie n'en résout pas une autre).

import * as React from "react";
import { Link } from "react-router-dom";
import { Link2, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface, SurfaceHead } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { rankSimilar, type ScoredSimilar } from "./similaires";
import {
  useLinkToGroup, useProcedureLinkable, useRequestGroup, useSimilarityAssistant, useSimilarRequests,
  useUnlinkFromGroup, type AssistantOpinion,
} from "./useLinking";

interface Props {
  orgId: string;
  requestId: string;
  procedureId: string | null;
  /** Droit d'écriture (création, instruction ou clôture) sur la demande — reflet, la RPC décide. */
  canWrite: boolean;
}

/** Jumeau de `MAX_CANDIDATES` (_shared/ai/similarity.ts) : le serveur refuse au-delà. */
const MAX_ASSISTANT_CANDIDATES = 10;

const TONE_TEXT = {
  haute: "text-destructive",
  moyenne: "text-secondary-foreground",
  faible: "text-muted-foreground",
} as const;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Opération refusée.";
}

export function IncidentGroupCard({ orgId, requestId, procedureId, canWrite }: Props) {
  const linkable = useProcedureLinkable(orgId, procedureId);
  const group = useRequestGroup(requestId, linkable === true);
  const [searching, setSearching] = React.useState(false);
  const similar = useSimilarRequests(requestId, searching && linkable === true);
  const link = useLinkToGroup();
  const unlink = useUnlinkFromGroup();
  const assistant = useSimilarityAssistant();
  const now = React.useMemo(() => new Date(), [similar.dataUpdatedAt]);
  // Avis de l'assistant, valables pour la liste de propositions qui les a reçus.
  const opinions = React.useMemo(
    () => new Map((assistant.data?.verdicts ?? []).map((v) => [v.request_id, v])),
    [assistant.data],
  );
  const resetAssistant = assistant.reset;
  React.useEffect(() => resetAssistant(), [similar.dataUpdatedAt, resetAssistant]);

  const proposals = React.useMemo<ScoredSimilar[]>(
    () => (similar.data ? rankSimilar(similar.data, now) : []),
    [similar.data, now],
  );

  if (linkable !== true) return null;

  const others = (group.data?.members ?? []).filter((m) => m.id !== requestId);
  const actionError = link.isError ? errorText(link.error) : unlink.isError ? errorText(unlink.error) : null;
  const busy = link.isPending || unlink.isPending;

  return (
    <Surface aria-label="Demandes du même incident">
      <SurfaceHead
        title="Même incident"
        sub={others.length > 0
          ? `${others.length} autre${others.length > 1 ? "s" : ""} demande${others.length > 1 ? "s" : ""} liée${others.length > 1 ? "s" : ""}`
          : "Plusieurs usagers peuvent signaler le même incident : liez leurs demandes pour les résoudre ensemble."}
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => (searching ? void similar.refetch() : setSearching(true))}
            disabled={similar.isFetching}
          >
            {similar.isFetching
              ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              : <Search className="size-3.5" aria-hidden="true" />}
            Rechercher des demandes similaires
          </Button>
        }
      />

      {actionError ? <p role="alert" className="text-[13px] text-destructive">{actionError}</p> : null}

      {group.isError ? (
        <p className="text-[13px] text-destructive">Demandes liées indisponibles.</p>
      ) : others.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {others.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-[13px] py-[11px]">
              <span className="font-mono text-[11.5px] font-bold tracking-wide">{m.reference}</span>
              <span className="min-w-[120px] flex-1 text-[13px] font-semibold">{m.subject}</span>
              <StatusBadge status={m.status} />
              {m.organisme ? <span className="text-[11.5px] text-muted-foreground">{m.organisme}</span> : null}
              <Button asChild variant="ghost" size="sm" className="h-7 px-2.5 text-xs">
                <Link to={`/demandes/${m.id}`}>Ouvrir</Link>
              </Button>
              {canWrite ? (
                <Button
                  variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                  disabled={busy}
                  onClick={() => unlink.mutate(m.id)}
                >
                  Délier
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {others.length > 0 && canWrite ? (
        <div>
          <Button
            variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground"
            disabled={busy}
            onClick={() => unlink.mutate(requestId)}
          >
            Retirer cette demande du groupe
          </Button>
        </div>
      ) : null}

      {searching ? (
        <section aria-label="Demandes similaires" className="flex flex-col gap-2">
          <h4 className="text-xs font-bold">Demandes similaires</h4>
          {similar.isLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Recherche dans les demandes de votre périmètre…
            </p>
          ) : similar.isError ? (
            <p className="text-xs text-destructive" role="alert">{errorText(similar.error)}</p>
          ) : proposals.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-3.5 text-xs text-muted-foreground">
              Aucune demande approchante : rien de proche par le lieu ni par la description, dans la
              fenêtre réglée pour cette démarche.
            </p>
          ) : (
            <>
              {canWrite ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
                    disabled={assistant.isPending}
                    onClick={() => assistant.mutate({
                      requestId, candidateIds: proposals.slice(0, MAX_ASSISTANT_CANDIDATES).map((p) => p.request_id),
                    })}
                  >
                    {assistant.isPending
                      ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      : <Sparkles className="size-3.5" aria-hidden="true" />}
                    Affiner avec l'assistant
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    Aucun champ d'identité connu n'est transmis ; un nom écrit en texte libre peut passer.
                    L'assistant donne un avis, il ne lie rien.
                  </span>
                </div>
              ) : null}
              {assistant.isError ? (
                <p role="alert" className="text-xs text-destructive">{errorText(assistant.error)}</p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {proposals.map((p) => (
                  <SimilarRow
                    key={p.request_id}
                    item={p}
                    canLink={canWrite}
                    busy={busy}
                    opinion={opinions.get(p.request_id) ?? null}
                    onLink={() => link.mutate({ requestId, targetId: p.request_id })}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}
    </Surface>
  );
}

const OPINION = {
  meme: { label: "Assistant : même incident", tone: "text-primary" },
  different: { label: "Assistant : autre incident", tone: "text-muted-foreground" },
  incertain: { label: "Assistant : incertain", tone: "text-secondary-foreground" },
} as const;

export function SimilarRow({ item, canLink, busy, onLink, linked = false, compact = false, opinion = null }: {
  item: ScoredSimilar;
  canLink: boolean;
  busy: boolean;
  onLink: () => void;
  /** Avis de l'assistant, quand l'agent l'a demandé. */
  opinion?: AssistantOpinion | null;
  /** Guichet : la liaison est retenue, elle se fera à la création. */
  linked?: boolean;
  compact?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border bg-card p-3",
        linked ? "border-primary/40" : item.likely ? "border-destructive/30" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[11.5px] font-bold tracking-wide">{item.reference}</span>
          <span className="text-[13px] font-bold leading-tight">{item.subject}</span>
        </span>
        <span className={cn("shrink-0 text-xs font-extrabold tabular-nums", TONE_TEXT[item.tone])}
              title="Proximité relative, pas une probabilité">
          {item.score}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={item.status} />
        {item.organisme && !compact ? <span className="text-[11px] text-muted-foreground">{item.organisme}</span> : null}
        {item.likely ? <span className="text-[11px] font-bold text-destructive">Même incident probable</span> : null}
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">{item.reasons.join(" · ")}</p>
      {opinion ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-2 py-1.5 text-[11.5px] leading-relaxed">
          <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>
            <span className={cn("font-bold", OPINION[opinion.verdict].tone)}>{OPINION[opinion.verdict].label}</span>
            {opinion.reason ? ` — ${opinion.reason}` : null}
          </span>
        </p>
      ) : null}
      <div className="flex gap-1.5">
        {canLink ? (
          <Button
            variant={linked ? "primary" : "outline"} size="sm" className="h-7 gap-1 px-2.5 text-[11.5px]"
            aria-pressed={linked}
            disabled={busy}
            onClick={onLink}
          >
            <Link2 className="size-3" aria-hidden="true" />
            {linked ? "Liée ✓" : "Lier"}
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm" className="h-7 px-2.5 text-[11.5px]">
          <Link to={`/demandes/${item.request_id}`} target="_blank" rel="noreferrer">Ouvrir</Link>
        </Button>
      </div>
    </li>
  );
}
