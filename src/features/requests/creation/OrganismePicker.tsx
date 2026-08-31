// Étape 0 du parcours guidé — « pour quel organisme consignez-vous cette
// demande ? ». Posée seulement quand l'agent détient le droit de création sur
// PLUSIEURS organisations (décision PO du 2026-08-31, backlog B4) ; un agent
// d'une commune unique ne la voit jamais.
//
// Aucune option n'est pré-sélectionnée : la question doit être répondue, pas
// entérinée. Un défaut, ici, se validerait sans être lu — c'est précisément ce
// que faisait le pré-remplissage silencieux par l'organisation de la démarche.
//
// ⚠️ Cet écran ne PROTÈGE rien : la liste vient de `rights.ts` (miroir de
// `permission_pairs_of`) et le serveur revérifie le couple (organisme,
// démarche) — `user_has_request_right`, dans `create-request-from-procedure`.

import { Building2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrganizationChoice } from "./organismes";

interface Props {
  choices: OrganizationChoice[];
  value: string;
  onChange: (socleOrgId: string) => void;
}

export function OrganismePicker({ choices, value, onChange }: Props) {
  return (
    <div className="flex max-w-[1240px] flex-col gap-4">
      {/* La prose reste étroite : une ligne de 1240px ne se lit pas. */}
      <div className="flex max-w-[760px] flex-col gap-1">
        <h3 className="text-base font-semibold">Pour quel organisme créez-vous cette demande ?</h3>
        <small className="text-[13px] leading-relaxed text-muted-foreground">
          L'organisme retenu <strong>porte</strong> la demande : il détermine qui pourra
          l'instruire et la clore, et c'est lui que l'usager lira sur ses courriels. Vous
          pouvez créer pour {choices.length} organismes — la démarche sera ensuite choisie
          parmi celles que vos droits vous ouvrent pour celui-ci.
        </small>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 min-[1400px]:grid-cols-3" role="radiogroup"
        aria-label="Organisme porteur de la demande">
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(choice.value)}
              className={cn(
                "flex items-start gap-3 rounded-[14px] border bg-card p-3.5 text-left transition-shadow",
                selected
                  ? "border-primary bg-primary/[0.04] shadow-airbnb-md"
                  : "border-border shadow-airbnb-sm hover:shadow-airbnb-md",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {selected ? <Check className="size-4" strokeWidth={3} /> : <Building2 className="size-4" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] font-bold leading-tight">{choice.label}</span>
                {choice.context ? (
                  <span className="truncate text-xs text-muted-foreground">{choice.context}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
