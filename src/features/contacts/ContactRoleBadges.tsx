// Pastilles des rôles codés d'un usager (« Élu », « Interne ») — une seule
// représentation pour la fiche, la liste, le bloc Usager d'une demande, le
// rapprochement et la recherche globale. Rien n'est rendu sans rôle reconnu.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { contactRoleNotices, contactRoles } from "./usager";
import type { SocleContact } from "./rapprochement";

export function ContactRoleBadges({ contact, className }: {
  contact: Pick<SocleContact, "roles"> | null | undefined;
  className?: string;
}) {
  const roles = contactRoles(contact);
  if (roles.length === 0) return null;
  return (
    <>
      {roles.map((role) => (
        <Badge
          key={role.code}
          variant="muted"
          className={cn("px-2 py-px text-[11px]", className)}
          title={role.notice}
        >
          {role.label}
        </Badge>
      ))}
    </>
  );
}

/** Bandeau informatif, NON bloquant, à l'identification au guichet. */
export function ContactRoleNotices({ contact }: { contact: Pick<SocleContact, "roles"> | null | undefined }) {
  const notices = contactRoleNotices(contact);
  if (notices.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-0.5 rounded-xl bg-secondary/25 px-3.5 py-2 text-[12.5px] font-medium text-secondary-foreground">
      {notices.map((text) => <p key={text}>{text}</p>)}
    </div>
  );
}
