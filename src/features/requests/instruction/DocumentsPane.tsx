// Onglet « Documents » : pièces de la demande (déposées au dépôt, URL signée
// à la demande), pièces d'instruction et courriers — ces deux derniers groupes
// et leurs actions sont à venir (grisés).

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RequestAttachment } from "../useRequests";
import { Pill, SOON, Surface, SurfaceHead } from "@/components/ui/surface";
import { attachmentExt, COPY_STATUS, formatBytes, formatDayMonth } from "./instruction";

interface Props {
  attachments: RequestAttachment[];
  fieldLabels: Record<string, string>;
  onOpen: (attachment: RequestAttachment) => void;
  onDownload: (attachment: RequestAttachment) => void;
}

export function DocumentsPane({ attachments, fieldLabels, onOpen, onDownload }: Props) {
  // Les pièces d'un e-mail SORTANT (`email_id`) appartiennent à leur échange :
  // les mêler ici les ferait passer pour des pièces déposées par l'usager.
  // Elles s'affichent dans l'onglet « Échanges », sous leur message.
  const deposited = attachments.filter((a) => !a.email_id);
  const n = deposited.length;
  return (
    <div className="flex flex-col gap-3.5">
      <Surface>
        <SurfaceHead
          title="Pièces de la demande"
          sub={n === 0 ? "Aucune pièce déposée" : `${n} pièce${n > 1 ? "s" : ""} · déposée${n > 1 ? "s" : ""} avec la demande`}
          action={<Button type="button" variant="outline" size="sm" {...SOON}><Plus /> Demander une pièce</Button>}
        />
        {n > 0 ? (
          <div className="flex flex-col gap-2">
            {deposited.map((a) => {
              const ext = attachmentExt(a.file_name, a.mime_type);
              const status = COPY_STATUS[a.copy_status] ?? { label: a.copy_status, tone: "neutral" as const };
              const meta = [
                formatBytes(a.file_size),
                `déposée le ${formatDayMonth(a.created_at)}`,
                a.document_type_label ?? (a.form_field_key ? fieldLabels[a.form_field_key] : null),
              ].filter(Boolean).join(" · ");
              const available = a.copy_status === "copied";
              return (
                <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-[13px] py-[11px]">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-[10px] font-extrabold",
                      ext === "PDF" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground/80",
                    )}
                  >
                    {ext}
                  </span>
                  <span className="flex min-w-[150px] flex-1 flex-col gap-0.5">
                    <span className="break-all text-[13px] font-bold">{a.file_name}</span>
                    <span className="text-[11.5px] text-muted-foreground">{meta}</span>
                  </span>
                  <Pill tone={status.tone}>{status.label}</Pill>
                  <span className="flex gap-1.5">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                      disabled={!available} onClick={() => onOpen(a)}>
                      Voir
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                      disabled={!available} onClick={() => onDownload(a)}>
                      Télécharger
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </Surface>

      <Surface className="opacity-60" aria-disabled="true">
        <SurfaceHead
          title="Pièces d'instruction"
          sub="Internes au service — non transmises à l'usager"
          action={<Button type="button" variant="outline" size="sm" {...SOON}><Plus /> Ajouter une pièce</Button>}
        />
        <p className="text-sm text-muted-foreground">
          Le dépôt de pièces internes à l'instruction arrive dans une prochaine version.
        </p>
      </Surface>

      <Surface className="opacity-60" aria-disabled="true">
        <SurfaceHead
          title="Courriers"
          sub="Générés depuis les modèles du service"
          action={<Button type="button" variant="outline" size="sm" {...SOON}><Plus /> Générer un courrier</Button>}
        />
        <p className="text-sm text-muted-foreground">
          La génération de courriers depuis les modèles du service arrive dans une prochaine version.
        </p>
      </Surface>
    </div>
  );
}
