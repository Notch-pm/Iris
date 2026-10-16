// Demandes liées — RÉSOLUTION COMMUNE dans le dialogue de transition de la
// fiche (lot L3 de docs/demandes-liees.md).
//
// Quand l'agent résout une demande d'un groupe « même incident », le dialogue
// propose de résoudre avec elle les autres demandes ouvertes du groupe — toutes
// cochées, chacune avec ce qui lui arrivera (passage par l'instruction,
// affectation, absence d'avis pour Clara) — et de PRÉVENIR leurs usagers, au
// choix de l'agent (décision PO 2026-10-16 ; décoché par défaut : un courriel
// qui part ne se reprend pas).
//
// Ordre : la demande courante par le chemin ordinaire d'abord (la fiche, son
// avis de clôture) ; puis `resolve_linked_requests` pour les autres, une
// transition par demande côté serveur ; puis, si l'agent l'a demandé, l'avis de
// chacune par `send-request-email` — qui revérifie le droit de clôture et refuse
// déjà les demandes Clara. Le résultat est PARTIEL quand il l'est.

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { EdgeError } from "@/lib/edge";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { useSendClosureEmail } from "@/features/requests/instruction/useSendRequestEmail";
import type { TransitionInput } from "@/features/requests/TransitionActions";
import type { TransitionSpec } from "@/features/requests/statuts";
import { closureNoticeApplies } from "@fn/_shared/email/cloture";
import {
  memberNotes, notifiableCount, propagatesToGroup, resolutionSummary, resolvableMembers,
  type LinkedResolutionResult,
} from "./resolution";
import { useProcedureLinkable, useRequestGroup, type GroupMember } from "./useLinking";

function useResolveLinkedRequests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceId: string; ids: string[]; status: string; motif?: string; closureText?: string;
    }): Promise<LinkedResolutionResult[]> => {
      const { data, error } = await supabase.rpc("resolve_linked_requests", {
        p_source_request_id: input.sourceId,
        p_request_ids: input.ids,
        p_status: input.status,
        p_motif: input.motif,
        p_closure_text: input.closureText,
      });
      if (error) throw error;
      return (data ?? []) as LinkedResolutionResult[];
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["requests"] });
      void qc.invalidateQueries({ queryKey: ["request-group"] });
      void qc.invalidateQueries({ queryKey: ["request_events", vars.sourceId] });
      for (const id of vars.ids) void qc.invalidateQueries({ queryKey: ["request", id] });
    },
  });
}

export interface GroupResolution {
  /** Section à monter dans le dialogue pour cette transition — `null` si rien ne se propage. */
  section: (spec: TransitionSpec) => React.ReactNode;
  /** À appeler APRÈS la transition réussie de la demande courante. */
  after: (spec: TransitionSpec, input: TransitionInput) => Promise<void>;
  /** À l'ouverture du dialogue : tout recocher, ne prévenir personne. */
  reset: () => void;
}

export function useGroupResolution(opts: {
  orgId: string;
  requestId: string;
  procedureId: string | null;
  flash: (text: string) => void;
  onFailure: (message: string) => void;
}): GroupResolution {
  const { orgId, requestId, procedureId, flash, onFailure } = opts;
  const linkable = useProcedureLinkable(orgId, procedureId);
  const group = useRequestGroup(requestId, linkable === true);
  const resolve = useResolveLinkedRequests();
  const sendClosure = useSendClosureEmail().mutateAsync;

  const candidates = React.useMemo(
    () => resolvableMembers(group.data?.members ?? [], requestId),
    [group.data, requestId],
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [notify, setNotify] = React.useState(false);
  // Lus par `after`, appelé depuis le rappel de fin de transition : jamais une
  // valeur figée au moment où le rappel a été créé.
  const state = React.useRef({ selected, notify, candidates });
  state.current = { selected, notify, candidates };

  const candidateKey = candidates.map((c) => c.id).join(",");
  const reset = React.useCallback(() => {
    setSelected(new Set(candidateKey === "" ? [] : candidateKey.split(",")));
    setNotify(false);
  }, [candidateKey]);

  const section = (spec: TransitionSpec): React.ReactNode => {
    if (!propagatesToGroup(spec.to) || candidates.length === 0) return null;
    return (
      <GroupResolutionSection
        members={candidates}
        selected={selected}
        onToggle={(id) => setSelected((s) => {
          const next = new Set(s);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        })}
        notify={notify}
        onNotify={setNotify}
      />
    );
  };

  const after = React.useCallback(async (spec: TransitionSpec, input: TransitionInput) => {
    const { selected: sel, notify: shouldNotify, candidates: members } = state.current;
    if (!propagatesToGroup(spec.to)) return;
    const ids = members.filter((m) => sel.has(m.id)).map((m) => m.id);
    if (ids.length === 0) return;
    let results: LinkedResolutionResult[];
    try {
      results = await resolve.mutateAsync({
        sourceId: requestId, ids, status: spec.to, motif: input.motif, closureText: input.closureText,
      });
    } catch (err) {
      onFailure(`La demande est bien résolue, mais la résolution des demandes liées a échoué : ${
        err instanceof Error ? err.message : "erreur inconnue"}`);
      return;
    }
    const summary = resolutionSummary(results);
    flash(summary.headline);
    if (summary.failures) onFailure(summary.failures);
    if (!shouldNotify) return;

    const targets = members.filter((m) => summary.okIds.includes(m.id) && closureNoticeApplies(m.source));
    let sent = 0; let noAddress = 0; const failed: string[] = [];
    for (const m of targets) {
      try {
        await sendClosure({ requestId: m.id });
        sent++;
      } catch (err) {
        if ((err as EdgeError | null)?.code === "no_recipient") noAddress++;
        else failed.push(m.reference);
      }
    }
    flash(`${summary.headline} — ${sent} usager${sent > 1 ? "s" : ""} prévenu${sent > 1 ? "s" : ""}`
      + (noAddress > 0 ? `, ${noAddress} sans adresse` : ""));
    if (failed.length > 0) {
      onFailure(`Avis non parti${failed.length > 1 ? "s" : ""} (la demande est bien résolue) : ${failed.join(", ")}`);
    }
  }, [flash, onFailure, requestId, resolve, sendClosure]);

  return { section, after, reset };
}

function GroupResolutionSection({ members, selected, onToggle, notify, onNotify }: {
  members: GroupMember[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  notify: boolean;
  onNotify: (v: boolean) => void;
}) {
  const count = members.filter((m) => selected.has(m.id)).length;
  const notifiable = notifiableCount(members, selected);
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
      <legend className="px-1 text-[13px] font-bold">Résoudre aussi les demandes liées</legend>
      <p className="text-[12px] text-muted-foreground">
        Même incident : elles seront résolues avec le même motif et le même commentaire. Celles qui
        ne peuvent pas l'être restent ouvertes, et vous le saurez.
      </p>
      <ul className="flex flex-col gap-1.5">
        {members.map((m) => {
          const notes = memberNotes(m);
          const id = `grp-${m.id}`;
          return (
            <li key={m.id}>
              <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-muted/60">
                <input
                  id={id} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
                  checked={selected.has(m.id)} onChange={() => onToggle(m.id)}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11.5px] font-bold">{m.reference}</span>
                    <span className="text-[13px] font-semibold">{m.subject}</span>
                    <StatusBadge status={m.status} />
                  </span>
                  {notes.length > 0 ? (
                    <span className="text-[11.5px] text-muted-foreground">{notes.join(" · ")}</span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <label htmlFor="grp-notify" className="mt-1 flex cursor-pointer items-start gap-2.5 px-1.5">
        <input
          id="grp-notify" type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
          checked={notify} onChange={(e) => onNotify(e.target.checked)} disabled={notifiable === 0}
        />
        <span className="flex flex-col">
          <span className="text-[13px] font-semibold">Prévenir les usagers des demandes liées</span>
          <span className="text-[11.5px] text-muted-foreground">
            {notifiable === 0
              ? "Aucun avis possible pour les demandes cochées."
              : `${notifiable} avis de clôture ${notifiable > 1 ? "partiront" : "partira"}, avec votre commentaire.`}
          </span>
        </span>
      </label>
      <p className="text-[11.5px] text-muted-foreground">
        {count === 0 ? "Aucune demande liée ne sera résolue." : `${count} demande${count > 1 ? "s" : ""} liée${count > 1 ? "s" : ""} sur ${members.length}.`}
      </p>
    </fieldset>
  );
}
