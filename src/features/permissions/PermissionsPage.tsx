// Paramètres : accueil en blocs cliquables (motif Clara `SettingsPage`) puis une
// section à la fois — profils de droits, utilisateurs, couverture (RM-62),
// référentiel Socle, journal (RM-57). Réservée aux administrateurs
// (`AdminRoute`) ; les gardes réelles restent côté serveur (RM-09, RM-38 à
// RM-42) — cette page ne fait que refléter et confirmer.

import * as React from "react";
import {
  AlertTriangle, ArrowLeft, Building2, ClipboardList, Copy, KeyRound, Layers, Mail, Pencil,
  Plus, Power, RefreshCw, Settings, Sparkles, Trash2, UserPlus, Users, X,
} from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthProvider";
import { syncSummary, useTriggerSocleSync } from "@/features/socle/useSocleSync";
import { useTenant } from "@/features/tenant/TenantProvider";
import { cn } from "@/lib/utils";
import {
  PROFILE_TEMPLATES, draftForDuplicate, draftFromProfileRow, draftFromTemplate, emptyDraft, matrixSummary,
  type ProfileRow,
} from "./profileRows";
import type { ProfileDraft } from "./profileValidation";
import { ProfileDialog } from "./ProfileDialog";
import { EmailTemplatesPanel } from "@/features/templates/EmailTemplatesPanel";
import { OrganisationsPanel } from "@/features/templates/OrganisationsPanel";
import { AiUsagePanel } from "@/features/ai/AiUsagePanel";
import { useInviteMember, useSendMemberPasswordReset } from "./useComptes";
import {
  useAllProcedureRows, useAssignProfile, useAuditLog, useCoverageReport, useDeleteProfile,
  useMembersWithoutProfile, useRevokeProfile, useSetProfileStatus, useSocleOrgRows, useTenantMemberRows,
  useTenantProfiles, type AuditLogRow, type MemberProfileChip, type MemberRow,
} from "./usePermissions";

type SectionId =
  | "profils" | "utilisateurs" | "couverture" | "modeles" | "referentiel" | "journal" | "ia";
type Section = "menu" | SectionId;

// Motif Clara (`SettingsPage`) : une page d'accueil « Paramètres » faite de blocs
// cliquables, une seule section affichée à la fois, retour par la flèche du titre.
const SECTIONS: { id: SectionId; title: string; description: string; icon: typeof Layers }[] = [
  {
    id: "profils",
    title: "Profils de droits",
    description: "Périmètre d'organisations et matrice démarche × droits, attribuables aux utilisateurs.",
    icon: Layers,
  },
  {
    id: "utilisateurs",
    title: "Utilisateurs",
    description: "Membres du tenant : invitation, attribution des profils, lien de mot de passe.",
    icon: Users,
  },
  {
    id: "couverture",
    title: "Couverture des démarches",
    description: "Couples organisation × démarche qu'aucun profil ne couvre au niveau instruction.",
    icon: AlertTriangle,
  },
  {
    id: "modeles",
    title: "Modèles d'e-mail",
    description: "Textes réutilisables pour répondre à un usager, avec variables de la demande.",
    icon: Mail,
  },
  {
    id: "referentiel",
    title: "Organisations",
    description: "Arbre des organisations que vous administrez, et modèles d'e-mail actifs sur chacune.",
    icon: Building2,
  },
  {
    id: "journal",
    title: "Journal des modifications",
    description: "Historique des créations, modifications et attributions de profils.",
    icon: ClipboardList,
  },
  {
    id: "ia",
    title: "Assistant IA",
    description: "Consommation de jetons du mois et plafond fixé par l'éditeur.",
    icon: Sparkles,
  },
];

// Codes exacts émis par les RPC (supabase/migrations/20260822100400_profils_droits_rpc.sql) —
// vérifié contre la source, pas deviné (E2E-1 : `assignment_granted` manquait).
const ACTION_LABELS: Record<string, string> = {
  profile_created: "Profil créé",
  profile_updated: "Profil modifié",
  profile_activated: "Profil réactivé",
  profile_deactivated: "Profil désactivé",
  profile_deleted: "Profil supprimé",
  assignment_granted: "Profil attribué",
  assignment_revoked: "Profil retiré",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function orgSummary(ids: string[], nameById: Map<string, string>): string {
  if (ids.length === 0) return "—";
  const names = ids.map((id) => nameById.get(id) ?? id);
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

interface ProfileDialogState {
  key: string;
  title: string;
  initialDraft: ProfileDraft;
  profileId?: string;
  expectedVersion?: number;
  assignedCount?: number;
}

export function PermissionsPage() {
  const { session } = useAuth();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const userId = session?.user.id ?? null;

  const [section, setSection] = React.useState<Section>("menu");

  const profiles = useTenantProfiles(orgId);
  const members = useTenantMemberRows(orgId);
  const membersWithoutProfile = useMembersWithoutProfile(orgId);
  const coverage = useCoverageReport(orgId);
  const audit = useAuditLog(orgId);
  const orgRows = useSocleOrgRows(orgId);
  const procedureRows = useAllProcedureRows(orgId);

  const setStatus = useSetProfileStatus(orgId);
  const deleteProfile = useDeleteProfile(orgId);
  const assignProfile = useAssignProfile(orgId);
  const revokeProfile = useRevokeProfile(orgId);
  const inviteMember = useInviteMember(orgId);
  const sendPasswordReset = useSendMemberPasswordReset();
  // Une seule instance de la mutation pour les deux boutons (en-tête des
  // paramètres et section Référentiel) : même état « en cours » des deux côtés.
  const sync = useTriggerSocleSync(orgId);

  // ---- Invitation d'un membre ----------------------------------------------
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [memberNotice, setMemberNotice] = React.useState<string | null>(null);
  const [iEmail, setIEmail] = React.useState("");
  const [iFirst, setIFirst] = React.useState("");
  const [iLast, setILast] = React.useState("");

  const orgNameById = React.useMemo(
    () => new Map((orgRows.data ?? []).map((r) => [r.socle_id, r.name])),
    [orgRows.data],
  );

  // ---- Dialogue profil (création / édition / duplication) -------------------
  const [dialogState, setDialogState] = React.useState<ProfileDialogState | null>(null);
  function openCreate(initialDraft: ProfileDraft) {
    setDialogState({ key: `create-${Date.now()}`, title: "Nouveau profil", initialDraft });
  }
  function openEdit(row: ProfileRow) {
    setDialogState({
      key: `edit-${row.id}-${row.version}`,
      title: `Modifier « ${row.name} »`,
      initialDraft: draftFromProfileRow(row),
      profileId: row.id,
      expectedVersion: row.version,
      assignedCount: row.assignedUserIds.length,
    });
  }
  function openDuplicate(row: ProfileRow) {
    setDialogState({ key: `dup-${row.id}`, title: `Dupliquer « ${row.name} »`, initialDraft: draftForDuplicate(row) });
  }

  // ---- Désactivation / réactivation ------------------------------------------
  const [statusTarget, setStatusTarget] = React.useState<ProfileRow | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  async function confirmStatusToggle() {
    if (!statusTarget) return;
    setStatusError(null);
    try {
      await setStatus.mutateAsync({
        profileId: statusTarget.id,
        status: statusTarget.status === "active" ? "inactive" : "active",
        expectedVersion: statusTarget.version,
      });
      setStatusTarget(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Opération impossible.");
    }
  }

  // ---- Suppression ------------------------------------------------------------
  const [deleteTarget, setDeleteTarget] = React.useState<ProfileRow | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deleteProfile.mutateAsync({ profileId: deleteTarget.id, expectedVersion: deleteTarget.version });
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  // ---- Attribution --------------------------------------------------------------
  const [assignTarget, setAssignTarget] = React.useState<MemberRow | null>(null);
  const [assignProfileId, setAssignProfileId] = React.useState("");
  const [assignError, setAssignError] = React.useState<string | null>(null);
  function openAssign(member: MemberRow) {
    setAssignTarget(member);
    setAssignProfileId("");
    setAssignError(null);
  }
  async function confirmAssign() {
    if (!assignTarget || assignProfileId === "") return;
    setAssignError(null);
    try {
      await assignProfile.mutateAsync({ profileId: assignProfileId, userId: assignTarget.userId });
      setAssignTarget(null);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Attribution impossible.");
    }
  }
  const eligibleProfiles = (profiles.data ?? []).filter(
    (p) => p.status === "active" && !assignTarget?.assignedProfiles.some((ap) => ap.id === p.id),
  );

  // ---- Retrait d'un profil attribué (B1 : TOUJOURS confirmé, pas seulement l'auto-retrait) --
  const [revokeTarget, setRevokeTarget] = React.useState<{ member: MemberRow; chip: MemberProfileChip } | null>(null);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);
  function requestRevoke(member: MemberRow, chip: MemberProfileChip) {
    setRevokeError(null);
    setRevokeTarget({ member, chip });
  }
  const revokeIsSelfAdmin = revokeTarget
    ? revokeTarget.member.userId === userId
      && Boolean((profiles.data ?? []).find((p) => p.id === revokeTarget.chip.id)?.isAdmin)
    : false;
  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevokeError(null);
    try {
      await revokeProfile.mutateAsync({ profileId: revokeTarget.chip.id, userId: revokeTarget.member.userId });
      setRevokeTarget(null);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Retrait impossible.");
    }
  }

  // ---- Invitation d'un membre (RM-20 : geste d'administrateur de tenant) ----
  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    try {
      const result = await inviteMember.mutateAsync({
        email: iEmail,
        firstName: iFirst,
        lastName: iLast,
      });
      setInviteOpen(false);
      setIEmail(""); setIFirst(""); setILast("");
      if (!result.invited) {
        setMemberNotice(`${result.email} avait déjà un compte Iris : il a simplement reçu l'accès à ce tenant.`);
      } else if (result.email_sent) {
        setMemberNotice(`Invitation envoyée à ${result.email}. Attribuez-lui un profil de droits : sans profil, il ne verra aucune demande.`);
      } else {
        setInviteError(result.email_error ?? "Compte créé, mais l'invitation n'est pas partie.");
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Invitation impossible.");
    }
  }

  async function onSendPasswordReset(m: MemberRow) {
    setMemberNotice(null);
    setInviteError(null);
    try {
      await sendPasswordReset.mutateAsync(m.userId);
      setMemberNotice(`${m.email} vient de recevoir un lien pour choisir un nouveau mot de passe.`);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Envoi impossible.");
    }
  }

  // `undefined` = accueil des paramètres (les blocs cliquables).
  const activeSection = SECTIONS.find((s) => s.id === section);

  if (!current) return null;

  return (
    <div className="flex flex-col gap-5">
      {activeSection ? (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Retour aux paramètres"
            onClick={() => setSection("menu")}
          >
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
            <p className="text-sm text-muted-foreground">{activeSection.title}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Settings className="size-6 text-primary" aria-hidden="true" />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
                <p className="text-sm text-muted-foreground">
                  Droits, utilisateurs, organisations et modèles de {current.organizationName}.
                </p>
              </div>
            </div>
            {/* Motif Clara : la synchronisation du référentiel est l'action de tête des
                paramètres, pas un bouton enfoui dans une section. */}
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              aria-busy={sync.isPending}
            >
              <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} aria-hidden="true" />
              {sync.isPending ? "Synchronisation…" : "Synchroniser le référentiel"}
            </Button>
          </div>

          {sync.isError ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              {sync.error instanceof Error ? sync.error.message : "Synchronisation en échec."}
            </p>
          ) : sync.isSuccess ? (
            <p role="status" className="text-sm text-muted-foreground">
              Synchronisation réussie — {syncSummary(sync.data.counters)}.
            </p>
          ) : null}

          {membersWithoutProfile.data && membersWithoutProfile.data.length > 0 ? (
            <button
              type="button"
              onClick={() => setSection("utilisateurs")}
              className="flex flex-col gap-1.5 rounded-[14px] border border-secondary bg-secondary/20 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
            >
              <p className="text-sm font-bold text-secondary-foreground">
                {membersWithoutProfile.data.length} membre{membersWithoutProfile.data.length > 1 ? "s" : ""} sans
                profil de droits
              </p>
              <p className="text-xs text-secondary-foreground">
                {membersWithoutProfile.data.map((m) => m.display_name || m.email).join(", ")} — ces personnes ne
                voient aucune demande tant qu'aucun profil ne leur est attribué. Voir la section
                Utilisateurs →
              </p>
            </button>
          ) : null}

          {coverage.data && coverage.data.length > 0 ? (() => {
            const openTotal = coverage.data.reduce((sum, c) => sum + c.open_requests, 0);
            const destructive = openTotal > 0;
            return (
              <button
                type="button"
                onClick={() => setSection("couverture")}
                className={cn(
                  "flex flex-col gap-1 rounded-[14px] border px-4 py-3 text-left transition-colors",
                  destructive
                    ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
                    : "border-border bg-muted/40 hover:bg-muted",
                )}
              >
                <p className={cn("text-sm font-bold", destructive ? "text-destructive" : "text-foreground")}>
                  {coverage.data.length} couple{coverage.data.length > 1 ? "s" : ""} organisation × démarche non
                  couvert{coverage.data.length > 1 ? "s" : ""}
                  {destructive
                    ? `, dont ${openTotal} demande${openTotal > 1 ? "s" : ""} ouverte${openTotal > 1 ? "s" : ""}`
                    : ""}
                </p>
                <p className={cn("text-xs", destructive ? "text-destructive" : "text-muted-foreground")}>
                  Voir le rapport de couverture →
                </p>
              </button>
            );
          })() : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "flex items-start gap-4 rounded-lg border border-border bg-card p-4 text-left shadow-iris-sm",
                    "transition-all hover:border-primary/30 hover:shadow-airbnb-md",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-base font-semibold">{s.title}</span>
                    <span className="text-sm text-muted-foreground">{s.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {section === "profils" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => openCreate(emptyDraft())}>
              <Plus /> Nouveau profil
            </Button>
            <Select
              aria-label="Nouveau profil depuis un modèle"
              className="h-10 w-auto text-sm"
              value=""
              onChange={(e) => {
                if (e.target.value) openCreate(draftFromTemplate(e.target.value));
                e.target.value = "";
              }}
            >
              <option value="">Depuis un modèle…</option>
              {PROFILE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Nom</th>
                      <th className="px-4 py-3">Organisations</th>
                      <th className="px-4 py-3">Droits</th>
                      <th className="px-4 py-3">Utilisateurs</th>
                      <th className="px-4 py-3">État</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.isLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>
                    ) : (profiles.data ?? []).length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Aucun profil pour l'instant.</td></tr>
                    ) : (
                      (profiles.data ?? []).map((row) => (
                        <tr key={row.id} className="border-b border-border/60 align-top last:border-0">
                          <td className="px-4 py-3">
                            <p className="font-medium">{row.name}</p>
                            {row.description ? <p className="text-xs text-muted-foreground">{row.description}</p> : null}
                            {row.isAdmin ? <Badge variant="secondary" className="mt-1">Administration</Badge> : null}
                            {row.isIntervenant ? <Badge variant="outline" className="mt-1 ml-1">Intervenant</Badge> : null}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{orgSummary(row.organizationIds, orgNameById)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{matrixSummary(row)}</td>
                          <td className="px-4 py-3">{row.assignedUserIds.length}</td>
                          <td className="px-4 py-3">
                            <Badge variant={row.status === "active" ? "outline" : "muted"}>
                              {row.status === "active" ? "Actif" : "Inactif"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" title="Modifier" aria-label={`Modifier ${row.name}`} onClick={() => openEdit(row)}>
                                <Pencil />
                              </Button>
                              <Button variant="ghost" size="icon" title="Dupliquer" aria-label={`Dupliquer ${row.name}`} onClick={() => openDuplicate(row)}>
                                <Copy />
                              </Button>
                              <Button variant="ghost" size="icon" title={row.status === "active" ? "Désactiver" : "Réactiver"}
                                aria-label={`${row.status === "active" ? "Désactiver" : "Réactiver"} ${row.name}`}
                                onClick={() => { setStatusError(null); setStatusTarget(row); }}>
                                <Power />
                              </Button>
                              <Button variant="ghost" size="icon" title={row.assignedUserIds.length > 0 ? "Attribué : désactivez-le plutôt" : "Supprimer"}
                                disabled={row.assignedUserIds.length > 0}
                                aria-label={`Supprimer ${row.name}`}
                                onClick={() => { setDeleteError(null); setDeleteTarget(row); }}>
                                <Trash2 />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {section === "utilisateurs" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-[640px] text-sm text-muted-foreground">
              Invitez un agent : il reçoit un lien d'activation et choisit son mot de passe. Tant
              qu'aucun profil ne lui est attribué, il ne voit aucune demande.
            </p>
            <Button onClick={() => { setInviteError(null); setMemberNotice(null); setInviteOpen(true); }}>
              <UserPlus className="size-4" aria-hidden="true" /> Inviter un utilisateur
            </Button>
          </div>

          {inviteError ? <p role="alert" className="text-sm text-destructive">{inviteError}</p> : null}
          {memberNotice ? <p role="status" className="text-sm text-muted-foreground">{memberNotice}</p> : null}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Nom</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Profils attribués</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.isLoading ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>
                    ) : (members.data ?? []).length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Aucun membre.</td></tr>
                    ) : (
                      (members.data ?? []).map((m) => (
                        <tr key={m.userId} className="border-b border-border/60 align-top last:border-0">
                          <td className="px-4 py-3 font-medium">
                            {m.displayName}
                            {m.isAdmin ? <Badge variant="secondary" className="ml-2">Administrateur</Badge> : null}
                          </td>
                          <td className="px-4 py-3">{m.email}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {m.assignedProfiles.length === 0 ? (
                                <span className="text-xs text-muted-foreground">Aucun profil</span>
                              ) : (
                                m.assignedProfiles.map((p) => (
                                  <span
                                    key={p.id}
                                    title={p.status === "inactive" ? "Profil désactivé — ne produit aucun droit." : undefined}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                      p.status === "inactive"
                                        ? "border-transparent bg-muted text-muted-foreground"
                                        : "border-input bg-transparent text-foreground",
                                    )}
                                  >
                                    {p.name}
                                    {p.status === "inactive" ? <span className="text-xs">(désactivé)</span> : null}
                                    <button
                                      type="button"
                                      aria-label={`Retirer le profil ${p.name} à ${m.displayName}`}
                                      onClick={() => requestRevoke(m, p)}
                                      className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                    >
                                      <X className="size-3" aria-hidden="true" />
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="ghost" size="icon"
                              title="Envoyer un lien de réinitialisation de mot de passe"
                              aria-label={`Envoyer un lien de réinitialisation à ${m.email}`}
                              disabled={sendPasswordReset.isPending}
                              onClick={() => void onSendPasswordReset(m)}>
                              <KeyRound className="size-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openAssign(m)}>
                              <UserPlus className="size-3.5" /> Attribuer
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {revokeError ? <p role="alert" className="px-4 pb-3 text-sm text-destructive">{revokeError}</p> : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {section === "couverture" ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Organisation</th>
                    <th className="px-4 py-3">Démarche</th>
                    <th className="px-4 py-3">Demandes ouvertes</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.isLoading ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>
                  ) : (coverage.data ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                        Aucun angle mort : toutes les démarches actives sont couvertes par au moins un profil
                        au niveau instruction.
                      </td>
                    </tr>
                  ) : (
                    (coverage.data ?? []).map((c) => (
                      <tr key={`${c.socle_org_id}-${c.socle_procedure_id}`} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3">{c.org_name}</td>
                        <td className="px-4 py-3">{c.procedure_name}</td>
                        <td className="px-4 py-3">
                          <Badge variant={c.open_requests > 0 ? "outline" : "muted"}>{c.open_requests}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {section === "modeles" ? <EmailTemplatesPanel orgId={orgId} /> : null}

      {section === "ia" ? <AiUsagePanel orgId={orgId} /> : null}

      {section === "referentiel" ? (
        <OrganisationsPanel orgId={orgId} sync={sync} onOpenCoverage={() => setSection("couverture")} />
      ) : null}

      {section === "journal" ? (
        <div className="flex flex-col gap-2">
          {audit.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (audit.data ?? []).length === 0 ? (
            <p className="rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
              Aucune modification de droits pour l'instant.
            </p>
          ) : (
            (audit.data ?? []).map((row: AuditLogRow) => (
              <div key={row.id} className="rounded-[14px] border border-border bg-card p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {actionLabel(row.action)} — {row.profile_name}
                  </p>
                  <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.actor?.name ?? "Système"}
                  {row.target ? ` → ${row.target.name}` : ""}
                </p>
                {row.before !== null || row.after !== null ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Détail avant / après</summary>
                    <div className="mt-1.5 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <pre className="overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(row.before, null, 2)}</pre>
                      <pre className="overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(row.after, null, 2)}</pre>
                    </div>
                  </details>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* Dialogue profil (création / édition / duplication) */}
      {dialogState ? (
        <ProfileDialog
          key={dialogState.key}
          open
          onOpenChange={(o) => { if (!o) setDialogState(null); }}
          orgId={orgId}
          orgRows={orgRows.data ?? []}
          procedureRows={procedureRows.data ?? []}
          title={dialogState.title}
          initialDraft={dialogState.initialDraft}
          profileId={dialogState.profileId}
          expectedVersion={dialogState.expectedVersion}
          assignedCount={dialogState.assignedCount}
          onSaved={() => setDialogState(null)}
          onReload={dialogState.profileId ? () => void profiles.refetch() : undefined}
        />
      ) : null}

      {/* Désactivation / réactivation */}
      <AlertDialog open={statusTarget !== null} onOpenChange={(o) => { if (!o) setStatusTarget(null); }}>
        <AlertDialogContent>
          {statusTarget ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {statusTarget.status === "active" ? "Désactiver" : "Réactiver"} « {statusTarget.name} » ?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {statusTarget.status === "active"
                    ? `${statusTarget.assignedUserIds.length} utilisateur${statusTarget.assignedUserIds.length > 1 ? "s" : ""} perdra${statusTarget.assignedUserIds.length > 1 ? "ont" : ""} immédiatement les droits de ce profil. Les attributions sont conservées et pourront être réactivées.`
                    : `${statusTarget.assignedUserIds.length} utilisateur${statusTarget.assignedUserIds.length > 1 ? "s" : ""} retrouvera${statusTarget.assignedUserIds.length > 1 ? "ont" : ""} immédiatement les droits de ce profil.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {statusError ? <p role="alert" className="text-sm text-destructive">{statusError}</p> : null}
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <Button variant={statusTarget.status === "active" ? "destructive" : "primary"} disabled={setStatus.isPending}
                  onClick={() => void confirmStatusToggle()}>
                  {setStatus.isPending ? "En cours…" : statusTarget.status === "active" ? "Désactiver" : "Réactiver"}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      {/* Suppression */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          {deleteTarget ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer « {deleteTarget.name} » ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cette action est définitive. Le journal des droits conserve la trace de ce profil.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError ? <p role="alert" className="text-sm text-destructive">{deleteError}</p> : null}
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <Button variant="destructive" disabled={deleteProfile.isPending} onClick={() => void confirmDelete()}>
                  {deleteProfile.isPending ? "Suppression…" : "Supprimer"}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      {/* B1 : retrait d'un profil attribué — TOUJOURS confirmé (pas seulement l'auto-retrait d'administration) */}
      <AlertDialog open={revokeTarget !== null} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <AlertDialogContent>
          {revokeTarget ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Retirer le profil « {revokeTarget.chip.name} » à {revokeTarget.member.displayName} ?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Cette personne perdra immédiatement les droits qu'il accorde.
                  {revokeIsSelfAdmin
                    ? " Vous perdrez vous-même l'accès aux paramètres à votre prochaine action, sauf si un autre profil vous donne encore l'administration sur ce tenant."
                    : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {revokeError ? <p role="alert" className="text-sm text-destructive">{revokeError}</p> : null}
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <Button variant="destructive" disabled={revokeProfile.isPending} onClick={() => void confirmRevoke()}>
                  {revokeProfile.isPending ? "En cours…" : "Retirer"}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      {/* Attribution */}
      <Dialog open={assignTarget !== null} onOpenChange={(o) => { if (!o) setAssignTarget(null); }}>
        <DialogContent>
          {assignTarget ? (
            <>
              <DialogHeader>
                <DialogTitle>Attribuer un profil à {assignTarget.displayName}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <Field label="Profil" htmlFor="assign-profile">
                  <Select id="assign-profile" value={assignProfileId} onChange={(e) => setAssignProfileId(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {eligibleProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                {eligibleProfiles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Tous les profils actifs sont déjà attribués à cette personne, ou aucun profil actif
                    n'existe encore.
                  </p>
                ) : null}
                {assignError ? <p role="alert" className="text-sm text-destructive">{assignError}</p> : null}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setAssignTarget(null)}>Annuler</Button>
                  <Button type="button" disabled={assignProfileId === "" || assignProfile.isPending} onClick={() => void confirmAssign()}>
                    {assignProfile.isPending ? "Attribution…" : "Attribuer"}
                  </Button>
                </DialogFooter>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Invitation d'un membre — le compte s'ouvre par un lien d'activation */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter un utilisateur</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitInvite} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Le compte est ouvert sans mot de passe : son titulaire reçoit un lien d'activation
              envoyé par le serveur de {current.organizationName} et choisit lui-même le sien.
            </p>
            <Field label="Email" htmlFor="inv-email" required>
              <Input id="inv-email" type="email" required value={iEmail}
                onChange={(e) => setIEmail(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prénom" htmlFor="inv-first">
                <Input id="inv-first" value={iFirst} onChange={(e) => setIFirst(e.target.value)} />
              </Field>
              <Field label="Nom" htmlFor="inv-last">
                <Input id="inv-last" value={iLast} onChange={(e) => setILast(e.target.value)} />
              </Field>
            </div>
            {inviteError ? <p role="alert" className="text-sm text-destructive">{inviteError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={inviteMember.isPending}>
                {inviteMember.isPending ? "Envoi…" : "Inviter"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
