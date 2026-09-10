// Feuille « compte » du shell mobile : qui je suis, mes profils, Mon compte,
// la bascule vers la version BUREAU (le commutateur, mémorisé sur l'appareil)
// et la déconnexion. Miroir du menu compte d'`AppShell`, en plein écran.

import { Link } from "react-router-dom";
import { LogOut, Monitor, RotateCcw, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/AuthProvider";
import { useDevice } from "@/features/device/DeviceProvider";
import { useTenant } from "@/features/tenant/TenantProvider";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileAccountSheet({ open, onOpenChange }: Props) {
  const { session, profile, signOut } = useAuth();
  const { isAdmin, rights } = useTenant();
  const { override, viewportNarrow, setOverride } = useDevice();
  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
    : (session?.user.email ?? "Utilisateur");
  const activeProfiles = rights.profiles.filter((p) => p.status === "active");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>{displayName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            {isAdmin ? <Badge variant="secondary" className="self-start">Administrateur</Badge> : null}
            <p className="text-[11px] font-semibold text-muted-foreground">Profils attribués</p>
            <p className="text-sm text-muted-foreground">
              {rights.is_platform_admin
                ? "Administrateur de la plateforme"
                : activeProfiles.length > 0 ? activeProfiles.map((p) => p.name).join(", ") : "Aucun"}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button asChild variant="outline" className="justify-start">
              <Link to="/mon-compte" onClick={() => onOpenChange(false)}>
                <User /> Mon compte
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() => { setOverride("desktop"); onOpenChange(false); }}
            >
              <Monitor /> Version bureau
            </Button>
            {/* Le commutateur a forcé le mobile sur un grand écran : proposer de rendre la main. */}
            {override === "mobile" && !viewportNarrow ? (
              <Button
                type="button"
                variant="ghost"
                className="justify-start"
                onClick={() => { setOverride(null); onOpenChange(false); }}
              >
                <RotateCcw /> Détection automatique
              </Button>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void signOut()}
          >
            <LogOut /> Déconnexion
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
