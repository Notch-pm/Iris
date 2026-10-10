// « Nouvelle demande » — UN bouton pour les en-têtes de la liste, du tableau et
// de la carte des demandes : même style (pilule pleine de la liste) et même règle
// d'affichage (`useCanCreateRequest`).
//
// Il porte aussi l'action SECONDAIRE de création, la « Demande complexe »
// relayée à Clara (2026-10-10) : un chevron accolé ouvre un menu, à la manière
// de « Ajouter du courrier » de Clara. L'action principale reste la demande
// fondée sur une démarche — la complexe ne prend jamais sa place, sauf pour
// l'agent qui ne peut déposer que celle-là (bouton contour, alors).

import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Info, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { useCanCreateRequest } from "./creation/useCanCreateRequest";
import { DemandeComplexeDialog } from "./complexe/DemandeComplexeDialog";
import { useCanRelayToClara } from "./complexe/useRelayToClara";

const PILL = "rounded-full px-3.5 text-[13px] font-bold";

export function NewRequestButton() {
  const canCreate = useCanCreateRequest();
  const canRelay = useCanRelayToClara();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [complexeOpen, setComplexeOpen] = React.useState(false);

  if (!canCreate && !canRelay) return null;

  const dialog = <DemandeComplexeDialog open={complexeOpen} onOpenChange={setComplexeOpen} />;

  if (!canCreate) {
    return (
      <>
        <Button size="sm" variant="outline" className={PILL} onClick={() => setComplexeOpen(true)}>
          <Send />
          <span className="hidden lg:inline">Demande complexe</span>
          <span className="sr-only lg:hidden">Demande complexe</span>
        </Button>
        {dialog}
      </>
    );
  }

  const primary = (
    <Button asChild size="sm" className={cn(PILL, canRelay && "rounded-r-none pr-3")}>
      <Link to="/demandes/nouvelle">
        <Plus />
        <span className="hidden lg:inline">Nouvelle demande</span>
        <span className="sr-only lg:hidden">Nouvelle demande</span>
      </Link>
    </Button>
  );
  if (!canRelay) return primary;

  return (
    <div className="flex items-center">
      {primary}
      <Dropdown
        open={menuOpen}
        onOpenChange={setMenuOpen}
        align="right"
        menuClassName="w-80"
        trigger={(props) => (
          <Button
            {...props}
            size="sm"
            className="rounded-l-none rounded-r-full border-l border-primary-foreground/25 px-2"
            aria-label="Autres façons de créer une demande"
          >
            <ChevronDown />
          </Button>
        )}
      >
        <DropdownItem
          className="items-start"
          onClick={() => {
            setMenuOpen(false);
            setComplexeOpen(true);
          }}
        >
          <Send className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-bold">Demande complexe</span>
            <span className="text-[12px] font-normal text-muted-foreground">
              Sans démarche : transmise à Clara pour analyse
            </span>
          </span>
        </DropdownItem>
        <DropdownDivider />
        <p className="flex items-start gap-2 px-[9px] py-1.5 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Iris ne conserve pas les demandes complexes : elles arrivent dans Clara, canal « Relayé agent ».
        </p>
      </Dropdown>
      {dialog}
    </div>
  );
}
