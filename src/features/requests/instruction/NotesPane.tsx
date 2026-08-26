// Onglet « Notes internes » : notes des agents (request_messages) — visibles
// des seuls membres du tenant, jamais transmises à l'usager, jamais hors Iris.

import * as React from "react";
import { Lock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RequestMessage, TenantMember } from "../useRequests";
import { Avatar, Pill, Surface, SurfaceHead } from "@/components/ui/surface";
import { formatTimeline, initials, memberName } from "./instruction";
import { MentionTextarea } from "./MentionTextarea";
import { bodySegments, mentionInitials, type MentionableUser } from "./mentions";
import { useAvatarUrls } from "@/features/account/useAccount";

interface Props {
  messages: RequestMessage[];
  members: TenantMember[];
  canWrite: boolean;
  archived: boolean;
  currentUserId: string | null;
  isAdmin: boolean;
  pending: boolean;
  /** Personnes pouvant CONSULTER la demande — seules mentionnables (RPC
   *  `mentionable_users`). L'écran n'est qu'un reflet : la garde SQL
   *  `t03_request_messages_guard_mentions` reste l'autorité. */
  mentionables: MentionableUser[];
  onAdd: (body: string) => Promise<void>;
  onDelete: (messageId: string) => void;
}

export function NotesPane({ messages, members, canWrite, archived, currentUserId, isAdmin, pending, mentionables, onAdd, onDelete }: Props) {
  const [draft, setDraft] = React.useState("");
  // Noms VIVANTS : à l'affichage on ne fait jamais confiance au nom figé
  // dans le jeton, qu'un agent aurait pu écrire à la main.
  const liveNames = React.useMemo(
    () => new Map(mentionables.map((u) => [u.userId, u.displayName])),
    [mentionables],
  );
  // Annuaire complet (soi-même compris) pour rendre les pastilles : photo,
  // initiales, nom vivant.
  const byId = React.useMemo(
    () => new Map(mentionables.map((u) => [u.userId, u])),
    [mentionables],
  );
  const avatars = useAvatarUrls(mentionables.map((u) => u.avatarPath)).data;
  const ordered = [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (body === "") return;
    await onAdd(body);
    setDraft("");
  }

  return (
    <Surface>
      <SurfaceHead
        title="Notes internes"
        sub="Jamais transmises à l'usager"
        action={<Pill tone="dark" className="px-[9px] py-1 text-[11px]"><Lock className="size-3" aria-hidden="true" /> Interne</Pill>}
      />
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune note pour l'instant.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {ordered.map((m) => {
            const who = memberName(members, m.author_id);
            const deletable = canWrite && !archived && (m.author_id === currentUserId || isAdmin);
            // La photo de l'auteur, s'il fait partie des personnes connues de
            // cette demande. Sinon les initiales, comme avant.
            const authorPath = m.author_id ? byId.get(m.author_id)?.avatarPath : null;
            return (
              <li key={m.id} className="flex gap-[11px] rounded-xl border border-secondary/50 bg-secondary/15 p-[13px]">
                <Avatar
                  initials={initials(who)}
                  src={authorPath ? avatars?.get(authorPath) : null}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[12.5px] font-bold">{who}</span>
                      <span className="text-[11px] text-muted-foreground">{formatTimeline(m.created_at)}</span>
                    </span>
                    {deletable ? (
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"
                        aria-label="Supprimer la note" onClick={() => onDelete(m.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                    {bodySegments(m.body, liveNames).map((seg, i) =>
                      seg.kind === "text" ? (
                        <React.Fragment key={i}>{seg.text}</React.Fragment>
                      ) : (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded bg-primary/10 px-1 align-middle font-semibold text-primary"
                        >
                          {byId.has(seg.userId) ? (
                            <Avatar
                              size="sm"
                              className="h-[15px] w-[15px] text-[7px]"
                              initials={mentionInitials(byId.get(seg.userId)!)}
                              src={
                                byId.get(seg.userId)!.avatarPath
                                  ? avatars?.get(byId.get(seg.userId)!.avatarPath!)
                                  : null
                              }
                            />
                          ) : null}
                          @{seg.label}
                        </span>
                      ),
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && !archived ? (
        <form onSubmit={submit} className="flex flex-col gap-2.5 border-t border-border pt-3">
          <MentionTextarea
            className="min-h-[76px]"
            placeholder="Ajouter une note interne… (« @ » pour mentionner un collègue)"
            ariaLabel="Nouvelle note interne"
            value={draft}
            onChange={setDraft}
            users={mentionables}
            selfId={currentUserId}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="min-w-[180px] flex-1 text-[11.5px] text-muted-foreground">
              Visible des seuls agents du tenant — ne quitte jamais Iris.
              Tapez « @ » pour mentionner quelqu'un : seuls les agents pouvant
              consulter cette demande sont proposés.
            </span>
            <Button type="submit" size="sm" disabled={pending || draft.trim() === ""}>
              {pending ? "Enregistrement…" : "Ajouter la note"}
            </Button>
          </div>
        </form>
      ) : archived ? (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">Demande archivée — notes en lecture seule.</p>
      ) : null}
    </Surface>
  );
}
