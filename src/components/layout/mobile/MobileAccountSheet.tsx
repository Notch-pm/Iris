// Feuille « Moi » du shell mobile : qui je suis, mon organisation courante (et
// son sélecteur quand j'en ai plusieurs — il vivait dans la barre haute, que
// la maquette v2 a retirée), mes profils, Mon compte, la bascule vers la
// version BUREAU (le commutateur, mémorisé sur l'appareil) et la déconnexion.
// Miroir du menu compte d'`AppShell`, en plein écran.

import { Link } from "react-router-dom";
import { LogOut, Monitor, RotateCcw, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthProvider";
import { useDevice } from "@/features/device/DeviceProvider";
import { useMyAvatarUrl } from "@/features/account/useAccount";
import { useTenant } from "@/features/tenant/TenantProvider";
import { MobileSheet } from "./MobilePage";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileAccountSheet({ open, onOpenChange }: Props) {
  const { session, profile, signOut } = useAuth();
  const { isAdmin, rights, memberships, current, setCurrentOrgId } = useTenant();
  const { override, viewportNarrow, setOverride } = useDevice();
  const avatarUrl = useMyAvatarUrl();
  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
    : (session?.user.email ?? "Utilisateur");
  const initials = profile
    ? ([profile.first_name?.[0], profile.last_name?.[0]].filter(Boolean).join("").toUpperCase()
      || profile.email[0].toUpperCase())
    : (session?.user.email?.[0]?.toUpperCase() ?? "U");
  const activeProfiles = rights.profiles.filter((p) => p.status === "active");

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Moi" subtitle={session?.user.email ?? undefined}>
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-base font-bold text-primary-foreground">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-lg font-bold leading-tight">{displayName}</span>
          {isAdmin ? <Badge variant="secondary" className="self-start">Administrateur</Badge> : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold text-muted-foreground">Organisation</p>
        {memberships.length > 1 ? (
          <Select
            aria-label="Organisation courante"
            className="h-11"
            value={current?.organizationId ?? ""}
            onChange={(e) => setCurrentOrgId(e.target.value)}
          >
            {memberships.map((m) => (
              <option key={m.organizationId} value={m.organizationId}>{m.organizationName}</option>
            ))}
          </Select>
        ) : (
          <p className="text-sm font-semibold">{current?.organizationName ?? "—"}</p>
        )}
        <p className="text-[11px] font-semibold text-muted-foreground">Profils attribués</p>
        <p className="text-sm text-muted-foreground">
          {rights.is_platform_admin
            ? "Administrateur de la plateforme"
            : activeProfiles.length > 0 ? activeProfiles.map((p) => p.name).join(", ") : "Aucun"}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button asChild variant="outline" size="lg" className="justify-start">
          <Link to="/mon-compte" onClick={() => onOpenChange(false)}>
            <User /> Mon compte
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
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
            size="lg"
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
        size="lg"
        className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => void signOut()}
      >
        <LogOut /> Déconnexion
      </Button>
    </MobileSheet>
  );
}
