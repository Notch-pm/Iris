// « Recommandations générales » — ce que la collectivité demande à ses agents
// pour toutes ses démarches (Socle 1.27.0), en page de lecture. On y arrive
// depuis la carte en tête du catalogue ; la même rubrique figure dans la fiche
// de chaque démarche.
//
// Trois états qui ne se confondent pas : rien d'écrit (la collectivité n'a pas
// rédigé de recommandations), référentiel muet (« indisponible », jamais une
// page vide), et le contenu.

import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTenant } from "@/features/tenant/TenantProvider";
import { AgentGuidanceContent } from "./AgentGuidanceContent";
import { useAgentGuidance } from "./useAgentGuidance";

export function AgentGuidancePage() {
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const guidance = useAgentGuidance(orgId);

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/base-de-connaissances"
        className="-ml-1 inline-flex w-fit items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13px] font-bold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Base de connaissances
      </Link>

      {guidance.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lecture des recommandations dans le référentiel…
        </p>
      ) : guidance.isError || !guidance.data ? (
        <p className="max-w-[72ch] rounded-[10px] border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground">
          Les recommandations générales n'ont pas pu être lues depuis le Référentiel — réessayez
          dans un instant.
        </p>
      ) : !guidance.data.configured ? (
        <div className="max-w-[72ch]">
          <h2 className="text-[22px] font-extrabold tracking-tight">Recommandations générales</h2>
          <p className="mt-3 rounded-[10px] border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground">
            {current?.organizationName ?? "La collectivité"} n'a pas encore rédigé de
            recommandations pour ses agents. Elles se rédigent dans le Référentiel, sur
            l'organisation principale (onglet « Recommandations aux agents »).
          </p>
        </div>
      ) : (
        <AgentGuidanceContent view={guidance.data} organizationName={current?.organizationName ?? null} />
      )}
    </div>
  );
}
