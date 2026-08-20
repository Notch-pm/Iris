import * as React from "react";
import { Copy, KeyRound, Pencil, Plus, Search, Trash2, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  useAllMemberships, useAllTenants, useAllUsers, useCreateUser, useDeleteUser,
  useRemoveMembership, useResetPassword, useSetMembership, useUpdateUserProfile,
  type CreatedAccount, type UserRow,
} from "./useSuperAdmin";

const ROLE_OPTIONS = [
  { value: "agent", label: "Agent" },
  { value: "administrateur", label: "Administrateur" },
];
const ROLE_LABELS: Record<string, string> = {
  agent: "Agent",
  administrateur: "Administrateur",
};

function displayName(u: UserRow): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return name === "" ? "—" : name;
}

export function SuperAdminUsersPage() {
  const { session } = useAuth();
  const users = useAllUsers();
  const tenants = useAllTenants();
  const memberships = useAllMemberships();
  const createUser = useCreateUser();
  const updateProfile = useUpdateUserProfile();
  const setMembership = useSetMembership();
  const removeMembership = useRemoveMembership();
  const resetPassword = useResetPassword();
  const deleteUser = useDeleteUser();

  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<UserRow | null>(null);
  const [credentials, setCredentials] = React.useState<CreatedAccount | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Formulaire de création.
  const [cEmail, setCEmail] = React.useState("");
  const [cFirst, setCFirst] = React.useState("");
  const [cLast, setCLast] = React.useState("");
  const [cTenant, setCTenant] = React.useState("");
  const [cRole, setCRole] = React.useState("agent");

  // Formulaire d'édition.
  const [eFirst, setEFirst] = React.useState("");
  const [eLast, setELast] = React.useState("");
  const [ePlatform, setEPlatform] = React.useState(false);

  const membershipsByUser = React.useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const m of memberships.data ?? []) {
      const inner = map.get(m.user_id) ?? new Map<string, string>();
      inner.set(m.organization_id, m.role);
      map.set(m.user_id, inner);
    }
    return map;
  }, [memberships.data]);

  const filtered = (users.data ?? []).filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      (u.first_name ?? "").toLowerCase().includes(q) ||
      (u.last_name ?? "").toLowerCase().includes(q)
    );
  });

  function openEdit(u: UserRow) {
    setEFirst(u.first_name ?? "");
    setELast(u.last_name ?? "");
    setEPlatform(u.is_platform_admin);
    setError(null);
    setEditUser(u);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await createUser.mutateAsync({
        email: cEmail,
        firstName: cFirst,
        lastName: cLast,
        membership: cTenant === "" ? null : { organizationId: cTenant, role: cRole },
      });
      setCreateOpen(false);
      setCEmail(""); setCFirst(""); setCLast(""); setCTenant(""); setCRole("agent");
      setCredentials(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    }
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setError(null);
    try {
      await updateProfile.mutateAsync({
        userId: editUser.id,
        firstName: eFirst,
        lastName: eLast,
        isPlatformAdmin: ePlatform,
      });
      setEditUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  async function onMembershipChange(userId: string, organizationId: string, value: string) {
    setError(null);
    try {
      if (value === "") await removeMembership.mutateAsync({ organizationId, userId });
      else await setMembership.mutateAsync({ organizationId, userId, role: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise à jour impossible.");
    }
  }

  async function onResetPassword(u: UserRow) {
    setError(null);
    try {
      const account = await resetPassword.mutateAsync(u.id);
      setCredentials({ ...account, email: u.email });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réinitialisation impossible.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setError(null);
    try {
      await deleteUser.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserCog className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Utilisateurs</h1>
            <p className="text-sm text-muted-foreground">
              Comptes de la plateforme et rattachements aux tenants.
            </p>
          </div>
        </div>
        <Button onClick={() => { setError(null); setCreateOpen(true); }}>
          <Plus /> Nouvel utilisateur
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Rechercher (nom, email)…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Plateforme</th>
                  <th className="px-4 py-3">Tenants</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Aucun utilisateur.</td></tr>
                ) : (
                  filtered.map((u) => {
                    const userMemberships = membershipsByUser.get(u.id);
                    const isSelf = u.id === session?.user.id;
                    return (
                      <tr key={u.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 font-medium">
                          {displayName(u)}
                          {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(vous)</span> : null}
                        </td>
                        <td className="px-4 py-3">{u.email}</td>
                        <td className="px-4 py-3">
                          {u.is_platform_admin ? <Badge variant="secondary">Admin plateforme</Badge> : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(tenants.data ?? [])
                              .filter((t) => userMemberships?.has(t.id))
                              .map((t) => (
                                <Badge key={t.id} variant="outline">
                                  {t.name} · {ROLE_LABELS[userMemberships!.get(t.id)!] ?? userMemberships!.get(t.id)}
                                </Badge>
                              ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Modifier"
                              aria-label={`Modifier ${u.email}`} onClick={() => openEdit(u)}>
                              <Pencil />
                            </Button>
                            <Button variant="ghost" size="icon" title="Réinitialiser le mot de passe"
                              aria-label={`Réinitialiser le mot de passe de ${u.email}`}
                              onClick={() => void onResetPassword(u)}>
                              <KeyRound />
                            </Button>
                            <Button variant="ghost" size="icon" title="Supprimer" disabled={isSelf}
                              aria-label={`Supprimer ${u.email}`}
                              onClick={() => { setError(null); setDeleteTarget(u); }}>
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Création */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Créer un utilisateur</DialogTitle>
            <DialogDescription>
              Le mot de passe sera généré et affiché une seule fois.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="flex flex-col gap-4">
            <Field label="Email" htmlFor="cu-email" required>
              <Input id="cu-email" type="email" required value={cEmail}
                onChange={(e) => setCEmail(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prénom" htmlFor="cu-first">
                <Input id="cu-first" value={cFirst} onChange={(e) => setCFirst(e.target.value)} />
              </Field>
              <Field label="Nom" htmlFor="cu-last">
                <Input id="cu-last" value={cLast} onChange={(e) => setCLast(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tenant" htmlFor="cu-tenant">
                <Select id="cu-tenant" value={cTenant} onChange={(e) => setCTenant(e.target.value)}>
                  <option value="">— Aucun pour l'instant —</option>
                  {(tenants.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Rôle" htmlFor="cu-role">
                <Select id="cu-role" value={cRole} disabled={cTenant === ""}
                  onChange={(e) => setCRole(e.target.value)}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? "Création…" : "Créer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Édition */}
      <Dialog open={editUser !== null} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent>
          {editUser ? (
            <>
              <DialogHeader>
                <DialogTitle>Modifier {editUser.email}</DialogTitle>
              </DialogHeader>
              <form onSubmit={submitEdit} className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Prénom" htmlFor="eu-first">
                    <Input id="eu-first" value={eFirst} onChange={(e) => setEFirst(e.target.value)} />
                  </Field>
                  <Field label="Nom" htmlFor="eu-last">
                    <Input id="eu-last" value={eLast} onChange={(e) => setELast(e.target.value)} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={ePlatform}
                    disabled={editUser.id === session?.user.id}
                    onChange={(e) => setEPlatform(e.target.checked)} />
                  Administrateur plateforme
                  {editUser.id === session?.user.id ? (
                    <span className="text-xs text-muted-foreground">(votre propre statut est verrouillé)</span>
                  ) : null}
                </label>

                <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-semibold">Accès aux tenants</legend>
                  <p className="text-xs text-muted-foreground">
                    Appliqué immédiatement. L'agent ne voit pas les paramètres ;
                    l'administrateur voit tout.
                  </p>
                  {(tenants.data ?? []).map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t.name}</span>
                      <Select
                        aria-label={`Rôle sur ${t.name}`}
                        className="h-9 w-44"
                        value={membershipsByUser.get(editUser.id)?.get(t.id) ?? ""}
                        onChange={(e) => void onMembershipChange(editUser.id, t.id, e.target.value)}
                      >
                        <option value="">— Aucun accès —</option>
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </fieldset>

                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setEditUser(null)}>Fermer</Button>
                  <Button type="submit" disabled={updateProfile.isPending}>Enregistrer</Button>
                </DialogFooter>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Suppression */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent>
          {deleteTarget ? (
            <>
              <DialogHeader>
                <DialogTitle>Supprimer {deleteTarget.email} ?</DialogTitle>
                <DialogDescription>
                  Le compte et ses accès seront supprimés définitivement. Les demandes qu'il a
                  traitées et le journal d'audit sont conservés.
                </DialogDescription>
              </DialogHeader>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Annuler</Button>
                <Button variant="destructive" disabled={deleteUser.isPending}
                  onClick={() => void confirmDelete()}>
                  {deleteUser.isPending ? "Suppression…" : "Supprimer"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Identifiants affichés une seule fois */}
      <Dialog open={credentials !== null} onOpenChange={(o) => { if (!o) setCredentials(null); }}>
        <DialogContent>
          {credentials ? (
            <>
              <DialogHeader>
                <DialogTitle>Identifiants de connexion</DialogTitle>
                <DialogDescription>
                  Transmettez-les de manière sécurisée — le mot de passe ne sera plus jamais
                  affiché.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 text-sm">
                <p><span className="text-muted-foreground">Email :</span> {credentials.email}</p>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Mot de passe :</span>
                  <code className="rounded bg-muted px-2 py-1">{credentials.password}</code>
                  <Button variant="ghost" size="icon" title="Copier"
                    aria-label="Copier le mot de passe"
                    onClick={() => void navigator.clipboard.writeText(credentials.password)}>
                    <Copy />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setCredentials(null)}>J'ai transmis les identifiants</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
