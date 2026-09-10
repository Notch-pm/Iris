// Écran 3 « Feuille Instruire » (maquette Claude Design « Iris mobile — v2 »,
// lignes 273-305) — tiroir bas ouvert depuis le pied « Instruire » de la
// fiche. Trois gestes d'instruction toujours proposés, un quatrième
// (« Déclarer une intervention réalisée ») seulement quand une sollicitation
// attend l'agent connecté. Tout le reste (demande de pièce, note interne,
// clôture, liens entre demandes) reste sur le poste — décision PO de la
// maquette, reprise telle quelle.

import { Camera, HardHat, MessageSquare, RefreshCw } from "lucide-react";
import { MobileActionRow, MobileDrawer } from "@/components/layout/mobile/MobilePage";
import type { InterventionRow } from "../interventions/interventions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  procedureLabel: string | null;
  reference: string;
  onStatus: () => void;
  statusDisabledReason: string | null;
  /** L'intervention que l'agent connecté peut déclarer réalisée — `null` = rangée masquée. */
  completableIntervention: InterventionRow | null;
  onDeclareIntervention: (intervention: InterventionRow) => void;
  onPhoto: () => void;
  photoDisabledReason: string | null;
  onEcrire: () => void;
  ecrireDisabledReason: string | null;
}

export function MobileInstruireDrawer({
  open, onOpenChange, procedureLabel, reference,
  onStatus, statusDisabledReason,
  completableIntervention, onDeclareIntervention,
  onPhoto, photoDisabledReason,
  onEcrire, ecrireDisabledReason,
}: Props) {
  return (
    <MobileDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Instruire la demande"
      subtitle={`${procedureLabel ?? "Sans démarche"} · ${reference}`}
    >
      <MobileActionRow
        icon={<RefreshCw aria-hidden="true" />}
        title="Changer le statut"
        sub="vers l'étape suivante ou une clôture"
        disabled={Boolean(statusDisabledReason)}
        disabledReason={statusDisabledReason}
        onClick={() => { onOpenChange(false); onStatus(); }}
      />
      {completableIntervention ? (
        <MobileActionRow
          icon={<HardHat aria-hidden="true" />}
          title="Déclarer une intervention réalisée"
          sub="pour l'intervention qu'on vous a confiée"
          onClick={() => { onOpenChange(false); onDeclareIntervention(completableIntervention); }}
        />
      ) : null}
      <MobileActionRow
        icon={<Camera aria-hidden="true" />}
        title="Joindre une photo, un document"
        sub="appareil photo ou fichier"
        disabled={Boolean(photoDisabledReason)}
        disabledReason={photoDisabledReason}
        onClick={() => { onOpenChange(false); onPhoto(); }}
      />
      <MobileActionRow
        icon={<MessageSquare aria-hidden="true" />}
        title="Écrire à l'usager"
        disabled={Boolean(ecrireDisabledReason)}
        disabledReason={ecrireDisabledReason}
        onClick={() => { onOpenChange(false); onEcrire(); }}
      />
    </MobileDrawer>
  );
}
