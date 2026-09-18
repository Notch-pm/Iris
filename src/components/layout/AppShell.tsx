import * as React from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3, BookOpen, ChevronsUpDown, Columns3, HardHat, Inbox, LogOut, Map, RotateCcw, ShieldCheck,
  Smartphone, User, Users,
} from "lucide-react";
import { useDevice } from "@/features/device/DeviceProvider";
import parametresIcon from "@/assets/icons/parametres.svg";
import notchLogo from "@/assets/logo-notch.svg";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCanBrowseUsagers } from "@/features/contacts/useUsagers";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { GlobalSearch } from "@/features/search/GlobalSearch";
import { useMyAvatarUrl } from "@/features/account/useAccount";
import { useTenant } from "@/features/tenant/TenantProvider";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useOrganisationBranding } from "@/features/socle/useOrganisationBranding";
import { CURRENT_APP } from "./apps";
import { AppSwitcher } from "./AppSwitcher";
import { isNavRouteActive, type NavRoute } from "./nav";
import { ShellLayoutContext, type ShellWidth } from "./shellLayout";

// Shell agent — réplique du shell de production Clara (AppHeader h-14, dont
// l'accès aux Paramètres en haut à droite + AppSidebar : rail vert 52px,
// premier item épinglé en haut, groupe restant centré verticalement). Design
// system Notch/Ariane. Header repris de la maquette Claude Design « En-tête
// multi-applications » (2026-09-10) : bascule de produit dans la colonne du
// rail, wordmark de la gamme, LOGO du client (charte Socle), et le nom du
// produit à droite, devant le menu compte.

// Icône « maison » du tableau de bord, tracée dans la maquette : plus simple
// que la `House` de Lucide (pas de porte), même grammaire de trait.
function HouseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

interface NavItem extends NavRoute {
  label: string;
  icon: typeof Inbox | typeof HouseIcon;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Tableau de bord", icon: HouseIcon, end: true },
  { to: "/demandes/tableau", label: "Tableau des demandes", icon: Columns3, end: false },
  // Le tableau a désormais son entrée : sans cette exception, les deux
  // s'allumeraient sur `/demandes/tableau` (voir `nav.ts`).
  { to: "/demandes", label: "Demandes", icon: Inbox, end: false, except: ["/demandes/tableau"] },
  { to: "/carte", label: "Carte des interventions", icon: Map, end: false },
];

// Ouvert à tout membre : les chiffres sont bornés par le RLS (consultation par
// couple), exactement comme la liste — pas de garde de rail.
const STATISTIQUES_NAV_ITEM: NavItem = {
  to: "/statistiques", label: "Statistiques", icon: BarChart3, end: false,
};

// « Base de connaissances » n'apparaît qu'aux titulaires d'un profil ACTIF qui
// porte l'attribut (`my_rights.knowledge_base_access`, 2026-09-18) — reflet :
// la route a sa garde (`KnowledgeBaseRoute`), l'assistant la sienne côté
// serveur. Placée avant les statistiques, comme dans la maquette.
const KNOWLEDGE_NAV_ITEM: NavItem = {
  to: "/base-de-connaissances", label: "Base de connaissances", icon: BookOpen, end: false,
};

// L'annuaire des usagers exige le même droit que « Nouvelle demande » (garde de
// socle-proxy sur /v1/contacts/*) : l'entrée n'apparaît que s'il est acquis —
// reflet de confort, l'edge function reste l'autorité.
const USAGERS_NAV_ITEM: NavItem = {
  to: "/usagers", label: "Usagers", icon: Users, end: false,
};

// « Mes interventions » n'apparaît qu'aux titulaires d'un profil « Intervenant »
// actif dans le tenant (`my_rights.is_intervenant`) — reflet de confort : la
// page elle-même ne montre que ce que le RLS laisse lire.
const INTERVENTIONS_NAV_ITEM: NavItem = {
  to: "/interventions", label: "Mes interventions", icon: HardHat, end: false,
};

// L'activation vient de `isNavRouteActive`, pas de `NavLink` : deux entrées
// partagent le préfixe `/demandes`, et `NavLink` les allumerait toutes les deux
// (jusqu'à l'`aria-current`, qu'il ne laisse pas contredire de l'extérieur).
function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const isActive = isNavRouteActive(item, pathname);
  return (
    <li>
      <Link
        to={item.to}
        title={item.label}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
          isActive
            ? "bg-primary-foreground/20 text-primary-foreground"
            : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground",
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span className="sr-only">{item.label}</span>
      </Link>
    </li>
  );
}

function AppSidebar() {
  const canBrowseUsagers = useCanBrowseUsagers();
  const { rights } = useTenant();
  const items = [
    ...BASE_NAV_ITEMS,
    ...(rights.knowledge_base_access ? [KNOWLEDGE_NAV_ITEM] : []),
    STATISTIQUES_NAV_ITEM,
    ...(canBrowseUsagers ? [USAGERS_NAV_ITEM] : []),
    ...(rights.is_intervenant ? [INTERVENTIONS_NAV_ITEM] : []),
  ];
  const [first, ...rest] = items;
  return (
    <nav
      aria-label="Navigation principale"
      className="relative flex h-full w-[52px] shrink-0 flex-col items-center bg-primary py-3"
    >
      <ul className="contents">
        <SidebarItem item={first} />
      </ul>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <ul className="pointer-events-auto flex flex-col items-center gap-0.5">
          {rest.map((item) => (
            <SidebarItem key={item.to} item={item} />
          ))}
        </ul>
      </div>
    </nav>
  );
}

// Le client dans le header : son LOGO quand le Socle en sert un (charte
// graphique, résolue avec l'héritage par le référentiel), son nom sinon. Rien
// n'est écrit tant que la réponse n'est pas là — un nom qui s'efface au profit
// d'un logo une seconde plus tard sauterait sous les yeux de l'agent. Une image
// cassée retombe sur le nom.
function ClientIdentity({ name, organizationId }: { name: string; organizationId: string }) {
  const { logoUrl, pending } = useOrganisationBranding(organizationId);
  const [broken, setBroken] = React.useState<string | null>(null);
  if (pending) return <span className="h-8 w-8" aria-hidden="true" />;
  if (logoUrl && broken !== logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        title={name}
        onError={() => setBroken(logoUrl)}
        className="h-8 max-w-[160px] object-contain"
      />
    );
  }
  return <span className="text-sm font-semibold">{name}</span>;
}

function UserMenu() {
  const { session, profile, signOut } = useAuth();
  const { isAdmin, rights } = useTenant();
  const { override, viewportNarrow, setOverride } = useDevice();
  const avatarUrl = useMyAvatarUrl();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
    : (session?.user.email ?? "Utilisateur");
  const initials = profile
    ? ([profile.first_name?.[0], profile.last_name?.[0]].filter(Boolean).join("").toUpperCase() ||
      profile.email[0].toUpperCase())
    : "U";
  // RM-46 : le badge de rôle est remplacé par les profils de droits attribués
  // sur ce tenant — c'est la seule réponse fiable à « pourquoi ne puis-je pas
  // faire ceci ? », le rôle binaire n'existant plus dans le modèle de droits.
  const activeProfiles = rights.profiles.filter((p) => p.status === "active");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted focus:outline-none"
      >
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary font-bold text-primary-foreground">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </span>
        <ChevronsUpDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 min-w-[240px] rounded-xl border border-border bg-popover p-1.5 shadow-airbnb-lg"
        >
          <div className="px-2.5 py-2">
            <p className="text-[13px] font-semibold">{displayName}</p>
            {isAdmin ? (
              <Badge variant="secondary" className="mt-1.5">
                Administrateur
              </Badge>
            ) : null}
            <p className="mt-1.5 text-[11px] font-semibold text-muted-foreground">Profils attribués</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {rights.is_platform_admin
                ? "Administrateur de la plateforme"
                : activeProfiles.length > 0
                  ? activeProfiles.map((p) => p.name).join(", ")
                  : "Aucun"}
            </p>
          </div>
          <div className="my-1 h-px bg-border" />
          <NavLink
            role="menuitem"
            to="/mon-compte"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-muted"
          >
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            Mon compte
          </NavLink>
          {/* Le commutateur d'appareil (2026-09-14) : forcer la version mobile,
              ou rendre la main à la détection quand un choix a été forcé —
              typiquement un téléphone sur lequel on a ouvert le bureau. */}
          <button
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); setOverride("mobile"); }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-muted"
          >
            <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
            Version mobile
          </button>
          {override === "desktop" && viewportNarrow ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); setOverride(null); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Détection automatique
            </button>
          ) : null}
          <div className="my-1 h-px bg-border" />
          <button
            role="menuitem"
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Déconnexion
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { profile } = useAuth();
  const { memberships, current, setCurrentOrgId, loading, isAdmin } = useTenant();
  const [width, setWidth] = React.useState<ShellWidth>("default");
  const layoutValue = React.useMemo(() => ({ setWidth }), []);

  return (
    <ShellLayoutContext.Provider value={layoutValue}>
    <div className="flex h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background pl-0 pr-4">
        {/* Gauche (maquette « En-tête multi-applications ») : la bascule de
            produit occupe la colonne du rail (52 px, tuile alignée sur ses
            icônes), puis le wordmark de la gamme, un séparateur, et le CLIENT
            — son logo, lu chez le Socle ; son nom tant qu'il n'y en a pas ; le
            sélecteur d'organisation quand on appartient à plusieurs. */}
        <div className="flex shrink-0 items-center gap-3">
          <AppSwitcher />
          <Link to="/" className="shrink-0">
            <img src={notchLogo} alt="Edilumen" className="h-6 object-contain" />
          </Link>
          {current ? (
            <>
              <span className="h-6 w-px bg-border" aria-hidden="true" />
              <ClientIdentity name={current.organizationName} organizationId={current.organizationId} />
            </>
          ) : null}
          {memberships.length > 1 ? (
            <Select
              aria-label="Organisation courante"
              className="h-[34px] w-auto min-w-[180px] rounded-full border-transparent bg-muted px-3 text-sm font-semibold"
              value={current?.organizationId ?? ""}
              onChange={(e) => setCurrentOrgId(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {m.organizationName}
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        {/* Centre : recherche globale (demandes et usagers), au motif des
            barres de recherche de header — elle ne garde aucune porte, le RLS
            et `socle-proxy` bornent ce qu'elle trouve. */}
        <div className="flex min-w-0 flex-1 justify-center px-4">
          <GlobalSearch />
        </div>

        {/* Droite : nom du produit (maquette : pastille + « Iris », juste
            avant le compte), chip administrateur + superadmin (plateforme
            uniquement) + menu utilisateur */}
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/"
            className="mr-1 flex items-center gap-2"
            title={`${CURRENT_APP.name} — ${CURRENT_APP.tagline}`}
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-primary/10 text-xs font-extrabold text-primary"
              aria-hidden="true"
            >
              {CURRENT_APP.initial}
            </span>
            <span className="text-[17px] font-bold tracking-[-0.01em] text-primary">{CURRENT_APP.name}</span>
          </Link>
          <span className="mr-1 h-6 w-px bg-border" aria-hidden="true" />
          {isAdmin ? (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Administrateur
            </Badge>
          ) : null}
          {profile?.is_platform_admin ? (
            <Link
              to="/superadmin"
              title="Superadmin"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">Superadmin</span>
            </Link>
          ) : null}
          {/* Notifications : cloche du tenant courant, à gauche des
              Paramètres. Le RLS ne montre que les siennes. */}
          <NotificationBell />
          {/* Accès aux Paramètres : en haut à droite, avec l'icône de Clara
              (`assets/icons/parametres.svg`, recopiée telle quelle) — RM-20,
              l'accès réel reste gardé par le RLS et `AdminRoute`. */}
          {isAdmin ? (
            <NavLink
              to="/parametres"
              title="Paramètres"
              className={({ isActive }) =>
                cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <img src={parametresIcon} alt="" aria-hidden="true" className="h-5 w-5" />
              <span className="sr-only">Paramètres</span>
            </NavLink>
          ) : null}
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        {width === "full" ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <Outlet />
            )}
          </main>
        ) : (
          <main className="min-w-0 flex-1 overflow-auto px-6 py-5 pb-10">
            <div className={cn("mx-auto", width === "wide" ? "w-full" : "max-w-[1240px]")}>
              {loading ? (
                <p className="text-sm text-muted-foreground">Chargement…</p>
              ) : (
                <Outlet />
              )}
            </div>
          </main>
        )}
      </div>
    </div>
    </ShellLayoutContext.Provider>
  );
}
