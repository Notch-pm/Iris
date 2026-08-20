import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { StatusBadge } from "./StatusBadge";
import { TransitionActions } from "./TransitionActions";
import {
  canWrite, IDENTITY_LABELS, MOTIF_LABELS, PRIORITY_LABELS,
  type ClosureMotif, type RequestStatus,
} from "./statuts";
import {
  createAttachmentUrl, useAddMessage, useAssignRequest, useDeleteMessage, useRequest,
  useRequestAssignments, useRequestAttachments, useRequestEvents, useRequestLinks,
  useRequestMessages, useTenantMembers, type RequestEvent, type TenantMember,
} from "./useRequests";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function memberName(members: TenantMember[], userId: string | null): string {
  if (!userId) return "Système / intégration";
  return members.find((m) => m.userId === userId)?.displayName ?? "Utilisateur";
}

const EVENT_LABELS: Record<string, string> = {
  created: "Demande créée",
  status_changed: "Changement de statut",
  assigned: "Affectation",
};

function EventLine({ event, members }: { event: RequestEvent; members: TenantMember[] }) {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  let detail: React.ReactNode = null;
  if (event.event_type === "status_changed") {
    detail = (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={String(payload.from)} />
        <span aria-hidden="true">→</span>
        <StatusBadge status={String(payload.to)} />
        {payload.motif ? <span className="text-muted-foreground">({MOTIF_LABELS[payload.motif as ClosureMotif] ?? String(payload.motif)})</span> : null}
      </span>
    );
  } else if (event.event_type === "assigned") {
    detail = (
      <span className="text-muted-foreground">
        {payload.to ? `Affectée à ${memberName(members, String(payload.to))}` : "Désaffectée"}
      </span>
    );
  } else if (event.event_type === "created") {
    detail = <span className="text-muted-foreground">Source : {String(payload.source ?? "")}</span>;
  }
  return (
    <li className="flex flex-col gap-1 border-l-2 border-border py-2 pl-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">{EVENT_LABELS[event.event_type] ?? event.event_type}</span>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(event.created_at)} · {memberName(members, event.created_by)}
        </span>
      </div>
      {detail}
    </li>
  );
}

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { current } = useTenant();
  const { session } = useAuth();
  const request = useRequest(id);
  const events = useRequestEvents(id);
  const attachments = useRequestAttachments(id);
  const assignments = useRequestAssignments(id);
  const messages = useRequestMessages(id);
  const links = useRequestLinks(id);
  const members = useTenantMembers(current?.organizationId ?? "");
  const assignRequest = useAssignRequest();
  const addMessage = useAddMessage();
  const deleteMessage = useDeleteMessage();

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignee, setAssignee] = React.useState("");
  const [newMessage, setNewMessage] = React.useState("");
  const [actionError, setActionError] = React.useState<string | null>(null);

  if (!current) return null;
  if (request.isLoading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }
  if (!request.data) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Demande introuvable ou hors de votre périmètre.</p>
        <Link to="/demandes" className="text-sm text-primary hover:underline">← Retour aux demandes</Link>
      </div>
    );
  }

  const r = request.data;
  const role = current.role;
  const writer = canWrite(role);
  const memberList = members.data ?? [];
  const snapshot = (r.snapshot ?? {}) as Record<string, unknown>;
  const declared = (snapshot.requester_declared ?? null) as Record<string, unknown> | null;
  const formData = (r.form_data ?? {}) as Record<string, unknown>;
  const archived = r.status === "archivee";

  async function openAttachment(path: string) {
    const url = await createAttachmentUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  }

  async function submitAssign(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      await assignRequest.mutateAsync({ requestId: r.id, assigneeId: assignee === "" ? null : assignee });
      setAssignOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Affectation refusée.");
    }
  }

  async function submitMessage(e: React.FormEvent) {
    e.preventDefault();
    if (newMessage.trim() === "" || !session) return;
    await addMessage.mutateAsync({
      requestId: r.id,
      organizationId: r.organization_id,
      authorId: session.user.id,
      body: newMessage.trim(),
    });
    setNewMessage("");
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to="/demandes" className="mb-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Demandes
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{r.reference}</h1>
          <StatusBadge status={r.status} />
          <Badge variant="outline">{PRIORITY_LABELS[r.priority] ?? r.priority}</Badge>
          <Badge variant="muted">{r.source}</Badge>
        </div>
        <p className="mt-1 text-lg">{r.subject}</p>
        <p className="text-sm text-muted-foreground">
          Reçue le {formatDateTime(r.received_at)} · créée le {formatDateTime(r.created_at)}
          {r.closed_at ? ` · close le ${formatDateTime(r.closed_at)}` : ""}
        </p>
      </div>

      {writer ? (
        <TransitionActions
          requestId={r.id}
          status={r.status as RequestStatus}
          role={role}
          assignedTo={r.assigned_to}
          members={memberList}
        />
      ) : null}
      {r.closure_motif || r.closure_text ? (
        <Card>
          <CardHeader><CardTitle>Clôture</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {r.closure_motif ? <p>Motif : {MOTIF_LABELS[r.closure_motif as ClosureMotif] ?? r.closure_motif}</p> : null}
            {r.closure_text ? <p className="text-muted-foreground">« {r.closure_text} »</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle>Demande</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p><span className="text-muted-foreground">Démarche :</span> {r.socle_procedure_label ?? "Demande libre"}</p>
              <p><span className="text-muted-foreground">Destinataire :</span> {r.socle_organization_label ?? "—"}</p>
              {r.channel ? <p><span className="text-muted-foreground">Canal :</span> {r.channel}</p> : null}
              {r.body ? <p className="whitespace-pre-wrap border-t border-border pt-3">{r.body}</p> : null}
              {Object.keys(formData).length > 0 ? (
                <div className="border-t border-border pt-3">
                  <p className="mb-1 font-medium">Formulaire</p>
                  <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
                    {Object.entries(formData).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </div>
              ) : null}
              {r.external_url ? (
                <a href={r.external_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  Voir la ressource d'origine ({r.source})
                </a>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="size-4" /> Demandeur
                <Badge variant="muted">{IDENTITY_LABELS[r.identity_status] ?? r.identity_status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {declared && Object.keys(declared).length > 0 && declared.anonymous !== true ? (
                <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
                  {Object.entries(declared).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd>{String(v)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              ) : declared?.anonymous === true ? (
                <p className="text-muted-foreground">Dépôt anonyme assumé — aucune notification possible.</p>
              ) : (
                <p className="text-muted-foreground">Aucune identité déclarée.</p>
              )}
              {r.socle_contact_id ? (
                <p className="mt-2 text-xs text-muted-foreground">Contact Socle : {r.socle_contact_id}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Pièces ({(attachments.data ?? []).length})</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {(attachments.data ?? []).length === 0 ? (
                <p className="text-muted-foreground">Aucune pièce.</p>
              ) : (
                (attachments.data ?? []).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{a.file_name}</span>
                    {a.copy_status === "copied" ? (
                      <Button variant="ghost" size="sm" onClick={() => void openAttachment(a.storage_path)}>
                        <Download /> Ouvrir
                      </Button>
                    ) : (
                      <Badge variant="muted">
                        {a.copy_status === "pending" ? "Copie en attente" : "Erreur de copie"}
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Liens externes</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {r.external_ref ? (
                <p>
                  <Badge variant="outline">{r.source}</Badge>{" "}
                  <span className="text-muted-foreground">réf. d'origine :</span> {r.external_ref}
                </p>
              ) : null}
              {(links.data ?? []).length === 0 && !r.external_ref ? (
                <p className="text-muted-foreground">Aucun lien.</p>
              ) : (
                (links.data ?? []).map((l) => (
                  <p key={l.id}>
                    <Badge variant="outline">{l.link_type === "externe" ? l.external_type : l.link_type}</Badge>{" "}
                    {l.external_url ? (
                      <a href={l.external_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {l.external_id ?? l.target_request_id}
                      </a>
                    ) : (
                      <span>{l.external_id ?? l.target_request_id}</span>
                    )}
                  </p>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Affectation
                {writer && !archived ? (
                  <Button variant="outline" size="sm"
                    onClick={() => { setAssignee(r.assigned_to ?? ""); setAssignOpen(true); }}>
                    Affecter
                  </Button>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                <span className="text-muted-foreground">Agent :</span>{" "}
                {r.assigned_to ? memberName(memberList, r.assigned_to) : "Non affectée"}
              </p>
              {(assignments.data ?? []).length > 0 ? (
                <div className="border-t border-border pt-2">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Historique</p>
                  <ul className="flex flex-col gap-1">
                    {[...(assignments.data ?? [])].reverse().map((a) => (
                      <li key={a.id} className="text-xs text-muted-foreground">
                        {formatDateTime(a.created_at)} —{" "}
                        {a.assigned_to ? memberName(memberList, a.assigned_to) : "désaffectée"}
                        {" "}par {memberName(memberList, a.assigned_by)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Messages internes</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Visibles des seuls agents — ne quittent jamais Iris.
              </p>
              {(messages.data ?? []).map((m) => (
                <div key={m.id} className="rounded-lg bg-muted/60 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {memberName(memberList, m.author_id)} · {formatDateTime(m.created_at)}
                    </span>
                    {writer && (m.author_id === session?.user.id || role === "administrateur") ? (
                      <Button variant="ghost" size="icon" aria-label="Supprimer la note"
                        onClick={() => void deleteMessage.mutateAsync({ messageId: m.id, requestId: r.id })}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
              {writer && !archived ? (
                <form onSubmit={submitMessage} className="flex flex-col gap-2">
                  <Textarea placeholder="Ajouter une note interne…" value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)} />
                  <Button type="submit" size="sm" className="self-end"
                    disabled={addMessage.isPending || newMessage.trim() === ""}>
                    Ajouter la note
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                Journal immuable — consultable, jamais modifiable.
              </p>
              <ul className="flex flex-col">
                {[...(events.data ?? [])].reverse().map((event) => (
                  <EventLine key={event.id} event={event} members={memberList} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Affecter la demande</DialogTitle></DialogHeader>
          <form onSubmit={submitAssign} className="flex flex-col gap-4">
            <Field label="Agent" htmlFor="assign-select">
              <Select id="assign-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">— Désaffecter —</option>
                {memberList.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName}</option>
                ))}
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAssignOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={assignRequest.isPending}>Confirmer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
