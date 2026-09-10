import * as React from "react";
import { Check, LayoutGrid } from "lucide-react";
import { Dropdown } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { appUrl, CURRENT_APP_KEY, EDILUMEN_APPS } from "./apps";

// Bascule entre les applications de la gamme (maquette Claude Design
// « En-tête multi-applications ») : un bouton grille dans la colonne du rail
// (52 px, tuile 34 px sans bordure — alignée sur les icônes du rail), un menu
// à quatre tuiles. La tuile d'Iris est inerte et cochée ; les autres sont de
// simples liens vers `<application>.edilumen.fr` — chaque produit a son propre
// projet et sa propre session, Iris ne transmet rien.

export function AppSwitcher() {
  const [open, setOpen] = React.useState(false);
  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      align="left"
      className="flex h-full w-[52px] shrink-0 items-center justify-center"
      menuClassName="left-[9px] w-[420px] p-3"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          title="Changer d'application"
          className={cn(
            "flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-foreground transition-colors",
            "hover:bg-muted active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          )}
        >
          <LayoutGrid className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
          <span className="sr-only">Changer d'application</span>
        </button>
      )}
    >
      <p className="px-1 pb-2.5 pt-0.5 text-xs font-bold text-muted-foreground">Changer d'application</p>
      <ul className="grid grid-cols-2 gap-2">
        {EDILUMEN_APPS.map((app) => {
          const active = app.key === CURRENT_APP_KEY;
          const body = (
            <>
              <span className="flex w-full items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-extrabold",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  )}
                  aria-hidden="true"
                >
                  {app.initial}
                </span>
                <span className="min-w-0 flex-1 text-[15px] font-bold">{app.name}</span>
                {active ? <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.4} aria-hidden="true" /> : null}
              </span>
              <span className="text-xs text-muted-foreground">{app.tagline}</span>
            </>
          );
          const tile = "flex flex-col gap-1.5 rounded-xl border p-3 text-left";
          return (
            <li key={app.key}>
              {active ? (
                <div aria-current="true" className={cn(tile, "border-primary bg-primary/5")}>
                  {body}
                </div>
              ) : (
                <a
                  href={appUrl(app.key)}
                  className={cn(
                    tile,
                    "border-border bg-background transition-[background-color,box-shadow] hover:bg-muted hover:shadow-airbnb-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  )}
                >
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
        Chaque application a sa propre connexion : elle peut vous être demandée.
      </p>
    </Dropdown>
  );
}
