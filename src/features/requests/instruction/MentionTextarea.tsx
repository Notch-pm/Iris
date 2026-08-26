// Zone de saisie d'une note interne, avec menu de mentions déclenché par « @ ».
//
// Toute la décision (détecter le « @… », filtrer, insérer) vit dans
// `mentions.ts`, pur et testé. Ce composant ne fait que du clavier, du focus
// et du positionnement.
//
// Clavier : ↑ ↓ pour parcourir, Entrée ou Tab pour choisir, Échap pour fermer.
// Tant que le menu est ouvert, Entrée choisit et ne soumet PAS le formulaire —
// c'est le réflexe attendu, et l'inverse ferait envoyer des notes à moitié
// écrites.

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { useAvatarUrls } from "@/features/account/useAccount";
import {
  activeMentionQuery, filterMentionables, insertMention, mentionInitials, withoutSelf,
  type ActiveQuery, type MentionableUser,
} from "./mentions";

interface Props {
  value: string;
  onChange: (value: string) => void;
  users: MentionableUser[];
  /** Soi-même : jamais proposé dans son propre menu (se citer ne notifie rien). */
  selfId?: string | null;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

/** Au-delà, le menu devient une liste à parcourir : on affine plutôt. */
const MAX_SUGGESTIONS = 6;

export function MentionTextarea({
  value, onChange, users, selfId, placeholder, ariaLabel, className, disabled,
}: Props) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = React.useState<ActiveQuery | null>(null);
  const [index, setIndex] = React.useState(0);

  const others = React.useMemo(() => withoutSelf(users, selfId), [users, selfId]);
  const matches = React.useMemo(
    () => (active ? filterMentionables(others, active.query).slice(0, MAX_SUGGESTIONS) : []),
    [active, others],
  );
  // Un seul aller-retour pour toutes les photos du menu.
  const avatars = useAvatarUrls(others.map((u) => u.avatarPath)).data;
  const open = active !== null && matches.length > 0;

  // L'index doit rester dans la liste quand elle rétrécit à la frappe.
  React.useEffect(() => {
    setIndex((i) => (i < matches.length ? i : 0));
  }, [matches.length]);

  function refresh(text: string, caret: number) {
    setActive(activeMentionQuery(text, caret));
  }

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    refresh(e.target.value, e.target.selectionStart ?? e.target.value.length);
  }

  function choose(user: MentionableUser) {
    if (!active) return;
    const out = insertMention(value, active, user);
    onChange(out.text);
    setActive(null);
    // Le curseur doit atterrir APRÈS le jeton : on le repositionne une fois
    // React a réécrit la valeur du champ.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(out.caret, out.caret);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(matches[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActive(null);
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        className={className}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        value={value}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onClick={(e) => refresh(value, e.currentTarget.selectionStart ?? 0)}
        // Le clic sur une suggestion passe par onMouseDown (avant le blur) :
        // fermer ici est sans risque pour la sélection.
        onBlur={() => setActive(null)}
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
        aria-controls="mention-suggestions"
      />

      {open ? (
        <ul
          id="mention-suggestions"
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-[min(20rem,100%)] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-airbnb-lg"
        >
          {matches.map((u, i) => (
            <li key={u.userId} role="option" aria-selected={i === index}>
              <button
                type="button"
                // mousedown, pas click : le blur du champ arriverait avant.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(u);
                }}
                onMouseEnter={() => setIndex(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                  i === index ? "bg-primary/10" : "hover:bg-muted",
                )}
              >
                <Avatar
                  initials={mentionInitials(u)}
                  src={u.avatarPath ? avatars?.get(u.avatarPath) : null}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium">{u.displayName}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{u.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
