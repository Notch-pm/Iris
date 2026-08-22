// Paramètres — Droits : profils de droits, attributions aux membres du
// tenant, rapport de couverture (RM-62) et journal (RM-57). Réservée aux
// administrateurs (`AdminRoute`) ; les gardes réelles restent côté serveur
// (RM-09, RM-38 à RM-42) — cette page ne fait que refléter et confirmer.

import * as React from "react";
import {
  AlertTriangle, ClipboardList, Copy, DatabaseZap, Layers, Pencil, Plus, Power, Settings, Trash2, UserPlus, Users, X,
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
import { Select } from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { cn } from "@/lib/utils";
import {
  PROFILE_TEMPLATES, draftForDuplicate, draftFromProfileRow, draftFromTemplate, emptyDraft, matrixSummary,
  type ProfileRow,
} from "./profileRows";
import type { ProfileDraft } from "./profileValidation";
import { ProfileDialog } from "./ProfileDialog";
import { ReferentielPanel } from "./ReferentielPanel";
import {
  useAllProcedureRows, useAssignProfile, useAuditLog, useCoverageReport, useDeleteProfile,
  useMembersWithoutProfile, useRevokeProfile, useSetProfileStatus, useSocleOrgRows, useTenantMemberRows,
  useTenantProfiles, type AuditLogRow, type MemberProfileChip, type MemberRow,
} from "./usePermissions";

type Section = "profils" | "utilisateurs" | "couverture" | "referentiel" | "journal";

const SECTIONS: { id: Section; label: string; icon: typeof Layers }[] = [
  { id: "profils", label: "Profils", icon: Layers },
  { id: "utilisateurs", label: "Utilisateurs", icon: Users },
  { id: "couverture", label: "Couverture", icon: AlertTriangle },
  { id: "referentiel", label: "Référentiel", icon: DatabaseZap },
  { id: "journal", label: "Journal", icon: ClipboardList },
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

  const [section, setSection] = React.useState<Section>("profils");

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

  // ---- Onglets (I9 : navigation flèches gauche/droite, roving tabindex) ------
  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = SECTIONS[(index + dir + SECTIONS.length) % SECTIONS.length];
    setSection(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  if (!current) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Settings className="size-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paramètres — Droits</h1>
          <p className="text-sm text-muted-foreground">
            Profils de droits et attributions pour {current.organizationName}.
          </p>
        </div>
      </div>

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

      <div role="tablist" aria-label="Sections des paramètres de droits" className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {SECTIONS.map((s, i) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              id={`tab-${s.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${s.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setSection(s.id)}
              onKeyDown={(e) => handleTabKeyDown(e, i)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {s.label}
            </button>
          );
        })}
      </div>

      {section === "profils" ? (
        <div id="panel-profils" role="tabpanel" aria-labelledby="tab-profils" tabIndex={0} className="flex flex-col gap-4">
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
        <Card id="panel-utilisateurs" role="tabpanel" aria-labelledby="tab-utilisateurs" tabIndex={0}>
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
      ) : null}

      {section === "couverture" ? (
        <Card id="panel-couverture" role="tabpanel" aria-labelledby="tab-couverture" tabIndex={0}>
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

      {section === "referentiel" ? (
        <ReferentielPanel orgId={orgId} onOpenCoverage={() => setSection("couverture")} />
      ) : null}

      {section === "journal" ? (
        <div id="panel-journal" role="tabpanel" aria-labelledby="tab-journal" tabIndex={0} className="flex flex-col gap-2">
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
    </div>
  );
}
