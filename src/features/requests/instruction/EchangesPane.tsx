// Onglet « Échanges » : messagerie avec l'usager (courriel / SMS, modèles).
// Fonctionnalité à venir : la maquette est en place, tous les contrôles sont
// grisés. Rien n'est envoyé, rien n'est enregistré.

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Pill, SOON, Surface, SurfaceHead } from "@/components/ui/surface";
import type { RequesterIdentity } from "./instruction";

interface Props {
  identity: RequesterIdentity;
}

export function EchangesPane({ identity }: Props) {
  const contacts = [
    identity.email ? `Courriel ${identity.email}` : null,
    identity.phone ? `Téléphone ${identity.phone}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Surface>
      <SurfaceHead
        title="Échanges avec l'usager"
        sub={identity.anonymous ? "Dépôt anonyme — aucun canal de contact" : (contacts || "Aucun canal de contact connu")}
        action={<Pill tone="neutral" className="h-6">À venir</Pill>}
      />
      <p className="rounded-xl border border-dashed border-border p-3.5 text-[13px] leading-relaxed text-muted-foreground">
        Aucun échange enregistré. La messagerie avec l'usager (courriel, SMS, modèles du service)
        sera disponible dans une prochaine version — les échanges seront alors joints à la demande.
      </p>
      <fieldset disabled aria-disabled="true" className="flex flex-col gap-2.5 border-t border-border pt-3.5 opacity-60">
        <legend className="sr-only">Composer un message (à venir)</legend>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-[10px] bg-muted p-1" role="group" aria-label="Canal">
            <button type="button" className="h-7 rounded-lg bg-background px-3 text-xs font-bold shadow-airbnb-sm" {...SOON}>Courriel</button>
            <button type="button" className="h-7 rounded-lg px-3 text-xs font-bold text-muted-foreground" {...SOON}>SMS</button>
          </div>
          <Select className="h-9 w-auto min-w-[220px] text-[13px]" defaultValue="" title={SOON.title}>
            <option value="">Aucun modèle</option>
          </Select>
        </div>
        <Textarea className="min-h-[92px]" placeholder="Message à l'usager — il recevra la référence de la demande" />
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="min-w-[180px] flex-1 text-[11.5px] text-muted-foreground">
            L'échange sera joint à la demande et visible par le service instructeur.
          </span>
          <Button type="button" variant="outline" size="sm" {...SOON}>Joindre un document</Button>
          <Button type="button" size="sm" {...SOON}>Envoyer</Button>
        </div>
      </fieldset>
    </Surface>
  );
}
