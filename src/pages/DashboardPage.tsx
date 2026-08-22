import { Link } from "react-router-dom";
import { Inbox, PlusCircle, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { useSocleProceduresCatalog } from "@/features/socle/useSocleCatalog";
import { creatableProcedures } from "@/features/rights/rights";

export function DashboardPage() {
  const { profile } = useAuth();
  const { current, rights, rightsLoading, hasAnyProfile, isAdmin } = useTenant();
  const procCatalog = useSocleProceduresCatalog(current?.organizationId ?? "");
  if (!current) return null;
  // Évite un flash de la carte « aucun droit » pendant le premier chargement
  // de my_rights (repli emptyRights le temps que la requête résolve).
  if (rightsLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const isPlatformAdmin = profile?.is_platform_admin ?? false;

  // RM-45 : un membre nouvellement rattaché n'a aucun profil, donc aucun
  // droit — jamais d'erreur brute ni de page vide, un message explicite.
  if (!hasAnyProfile && !isPlatformAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Aucun droit attribué</CardTitle>
            <CardDescription>
              Aucun droit ne vous a encore été attribué sur {current.organizationName} —
              contactez votre administrateur.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const activeProfiles = rights.profiles.filter((p) => p.status === "active");
  // Repère de confort (démarches créables, défaut du profil compris via le
  // cache réel du tenant) — la garde d'autorité reste dans NewRequestPage/le
  // serveur, cette carte n'affiche le lien que pour éviter un aller-retour
  // inutile vers une page bloquée.
  const cacheIds = (procCatalog.data ?? []).map((o) => o.value);
  const canCreateSomething = creatableProcedures(rights, cacheIds).size > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        {isPlatformAdmin ? <Badge variant="secondary">Admin plateforme</Badge> : null}
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Bienvenue dans Iris</CardTitle>
          <CardDescription>
            {isPlatformAdmin
              ? "Vous accédez à ce tenant en tant qu'administrateur de la plateforme — vos droits contournent les profils."
              : activeProfiles.length > 0
                ? `Profil${activeProfiles.length > 1 ? "s" : ""} attribué${activeProfiles.length > 1 ? "s" : ""} sur ${current.organizationName} : ${activeProfiles.map((p) => p.name).join(", ")}.`
                : "Aucun profil de droits ne vous est attribué sur ce tenant."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/demandes">
              <Inbox /> Demandes
            </Link>
          </Button>
          {canCreateSomething || isPlatformAdmin ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/demandes/nouvelle">
                <PlusCircle /> Nouvelle demande
              </Link>
            </Button>
          ) : null}
          {isAdmin ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/parametres/droits">
                <Settings /> Paramètres
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
