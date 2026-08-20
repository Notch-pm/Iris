import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  allowedTransitions, MOTIF_LABELS, type ClosureMotif, type MemberRole,
  type RequestStatus, type TransitionSpec,
} from "./statuts";
import { useApplyTransition, type TenantMember } from "./useRequests";

interface Props {
  requestId: string;
  status: RequestStatus;
  role: MemberRole;
  assignedTo: string | null;
  members: TenantMember[];
}

/** Boutons de transition — reflet de la garde SQL, qui reste la seule autorité. */
export function TransitionActions({ requestId, status, role, assignedTo, members }: Props) {
  const { session } = useAuth();
  const apply = useApplyTransition();
  const [active, setActive] = React.useState<TransitionSpec | null>(null);
  const [motif, setMotif] = React.useState<ClosureMotif | "">("");
  const [closureText, setClosureText] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const specs = allowedTransitions(status, role);
  if (specs.length === 0) return null;

  const needsDialog = (spec: TransitionSpec) =>
    Boolean(spec.needsClosureText || (spec.motifChoices && spec.motifChoices.length > 0) ||
      (spec.needsAssignee && !assignedTo && !session));

  async function run(spec: TransitionSpec, input: {
    closureText?: string; motif?: ClosureMotif; assigneeId?: string | null;
  }) {
    setError(null);
    try {
      await apply.mutateAsync({ requestId, spec, ...input });
      setActive(null);
      setMotif("");
      setClosureText("");
      setAssigneeId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transition refusée.");
    }
  }

  function onClick(spec: TransitionSpec) {
    setError(null);
    if (needsDialog(spec)) {
      setAssigneeId(assignedTo ?? session?.user.id ?? "");
      setActive(spec);
      return;
    }
    // Prise en charge directe : l'agent courant devient l'assigné si personne ne l'est.
    void run(spec, {
      assigneeId: spec.needsAssignee ? (assignedTo ?? session?.user.id ?? null) : undefined,
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {specs.map((spec) => (
        <Button key={spec.to + spec.label} size="sm"
          variant={spec.to === "annulee" ? "destructive" : spec.to === "en_instruction" && status === "a_traiter" ? "primary" : "outline"}
          disabled={apply.isPending}
          onClick={() => onClick(spec)}>
          {spec.label}
        </Button>
      ))}
      {error && !active ? <p role="alert" className="w-full text-sm text-destructive">{error}</p> : null}

      <Dialog open={active !== null} onOpenChange={(o) => { if (!o) setActive(null); }}>
        <DialogContent>
          {active ? (
            <>
              <DialogHeader>
                <DialogTitle>{active.label}</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(active, {
                    closureText: closureText || undefined,
                    motif: motif === "" ? undefined : motif,
                    assigneeId: active.needsAssignee ? (assigneeId || null) : undefined,
                  });
                }}
              >
                {active.needsAssignee ? (
                  <Field label="Agent assigné" htmlFor="tr-assignee" required>
                    <Select id="tr-assignee" required value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}>
                      <option value="">— Choisir —</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>{m.displayName}</option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                {active.motifChoices && active.motifChoices.length > 0 ? (
                  <Field label="Motif" htmlFor="tr-motif" required={active.motifRequired}>
                    <Select id="tr-motif" required={active.motifRequired} value={motif}
                      onChange={(e) => setMotif(e.target.value as ClosureMotif | "")}>
                      <option value="">— Choisir —</option>
                      {active.motifChoices.map((m) => (
                        <option key={m} value={m}>{MOTIF_LABELS[m]}</option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                {active.needsClosureText ? (
                  <Field label="Texte de clôture (destiné à l'usager)" htmlFor="tr-closure" required
                    hint="Jamais une note interne — ce texte pourra être transmis à l'usager.">
                    <Textarea id="tr-closure" required value={closureText}
                      onChange={(e) => setClosureText(e.target.value)} />
                  </Field>
                ) : null}
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setActive(null)}>Annuler</Button>
                  <Button type="submit" disabled={apply.isPending}>
                    {apply.isPending ? "Application…" : "Confirmer"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
