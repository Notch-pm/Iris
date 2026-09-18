import * as React from "react";
import { KeyRound, Pencil, Plus, Search, Trash2, UserCog } from "lucide-react";
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
  identityFormFrom, PHONE_MAX_LENGTH, validateIdentityForm, type IdentityForm,
} from "@/features/account/account";
import {
  useAllMemberships, useAllProfileAssignments, useAllTenants, useAllUsers, useDeleteUser,
  useInviteUser, useRemoveMembership, useSendPasswordReset, useSetMembership, useUpdateUserProfile,
  type ProfileAssignmentInfo, type UserRow,
} from "./useSuperAdmin";

/** Message de fin de geste — remplace l'ancien encart d'identifiants. */
interface Notice {
  title: string;
  lines: string[];
  tone: "success" | "warning";
}

function displayName(u: UserRow): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return name === "" ? "—" : name;
}

export function SuperAdminUsersPage() {
  const { session } = useAuth();
  const users = useAllUsers();
  const tenants = useAllTenants();
  const memberships = useAllMemberships();
  const profileAssignments = useAllProfileAssignments();
  const inviteUser = useInviteUser();
  const updateProfile = useUpdateUserProfile();
  const setMembership = useSetMembership();
  const removeMembership = useRemoveMembership();
  const sendPasswordReset = useSendPasswordReset();
  const deleteUser = useDeleteUser();

  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<UserRow | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Formulaire d'invitation.
  const [cEmail, setCEmail] = React.useState("");
  const [cIdentity, setCIdentity] = React.useState<IdentityForm>(() => identityFormFrom(null));
  const [cTenant, setCTenant] = React.useState("");
  const setC = <K extends keyof IdentityForm>(key: K, value: IdentityForm[K]) =>
    setCIdentity((f) => ({ ...f, [key]: value }));

  // Formulaire d'édition.
  const [eIdentity, setEIdentity] = React.useState<IdentityForm>(() => identityFormFrom(null));
  const [ePlatform, setEPlatform] = React.useState(false);
  const setE = <K extends keyof IdentityForm>(key: K, value: IdentityForm[K]) =>
    setEIdentity((f) => ({ ...f, [key]: value }));

  // RM-44 : le rattachement à un tenant est un simple accès, sans rôle — le
  // rôle de confort (badge) est dérivé côté serveur des profils de droits.
  const membershipsByUser = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const m of memberships.data ?? []) {
      const set = map.get(m.user_id) ?? new Set<string>();
      set.add(m.organization_id);
      map.set(m.user_id, set);
    }
    return map;
  }, [memberships.data]);

  const profileAssignmentsByUser = React.useMemo(() => {
    const map = new Map<string, Map<string, ProfileAssignmentInfo[]>>();
    for (const a of profileAssignments.data ?? []) {
      const inner = map.get(a.user_id) ?? new Map<string, ProfileAssignmentInfo[]>();
      const list = inner.get(a.organization_id) ?? [];
      list.push(a);
      inner.set(a.organization_id, list);
      map.set(a.user_id, inner);
    }
    return map;
  }, [profileAssignments.data]);

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
    setEIdentity(identityFormFrom(u));
    setEPlatform(u.is_platform_admin);
    setError(null);
    setEditUser(u);
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateIdentityForm(cIdentity);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const result = await inviteUser.mutateAsync({
        email: cEmail,
        identity: cIdentity,
        organizationId: cTenant === "" ? null : cTenant,
      });
      setCreateOpen(false);
      setCEmail(""); setCIdentity(identityFormFrom(null)); setCTenant("");

      if (!result.invited) {
        setNotice({
          title: "Compte existant rattaché",
          tone: "success",
          lines: [
            `${result.email} avait déjà un compte Iris : il a simplement reçu l'accès à ce tenant.`,
            "Aucun mail n'a été envoyé — ce compte a déjà son mot de passe.",
          ],
        });
      } else if (result.email_sent) {
        setNotice({
          title: "Invitation envoyée",
          tone: "success",
          lines: [
            `Le lien d'activation est parti à ${result.email}.`,
            "Le compte reste inutilisable tant que son titulaire n'a pas choisi son mot de passe.",
          ],
        });
      } else {
        setNotice({
          title: "Compte créé, invitation NON envoyée",
          tone: "warning",
          lines: [
            result.email_error ?? "Le message n'a pas pu partir.",
            "Vérifiez le serveur d'envoi du tenant : il est défini dans le Référentiel (organisation principale, onglet « Emails (SMTP) ») et descend à la synchronisation du référentiel. Renvoyez ensuite un lien depuis la liste.",
          ],
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invitation impossible.");
    }
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    // Même contrôle de confort qu'à « Mon compte » : un administrateur ne
    // saisit pas mieux un numéro que son titulaire.
    const problem = validateIdentityForm(eIdentity);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await updateProfile.mutateAsync({
        userId: editUser.id,
        identity: eIdentity,
        isPlatformAdmin: ePlatform,
      });
      setEditUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  /** « Donner accès » / « Retirer l'accès » — sans rôle (RM-44). */
  async function onMembershipToggle(userId: string, organizationId: string, hasAccess: boolean) {
    setError(null);
    try {
      if (hasAccess) await removeMembership.mutateAsync({ organizationId, userId });
      else await setMembership.mutateAsync({ organizationId, userId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise à jour impossible.");
    }
  }

  async function onSendPasswordReset(u: UserRow) {
    setError(null);
    try {
      await sendPasswordReset.mutateAsync(u.id);
      setNotice({
        title: "Lien envoyé",
        tone: "success",
        lines: [`${u.email} vient de recevoir un lien pour choisir un nouveau mot de passe.`],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible.");
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
          <Plus /> Inviter un utilisateur
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
                          <div className="flex flex-col gap-1.5">
                            {(tenants.data ?? [])
                              .filter((t) => userMemberships?.has(t.id))
                              .map((t) => {
                                const profilesHere = profileAssignmentsByUser.get(u.id)?.get(t.id) ?? [];
                                return (
                                  <div key={t.id} className="flex flex-wrap items-center gap-1">
                                    <Badge variant="outline">{t.name}</Badge>
                                    {profilesHere.length === 0 ? (
                                      <Badge variant="muted">Aucun profil</Badge>
                                    ) : (
                                      profilesHere.map((p) => (
                                        <Badge key={p.profile_id} variant={p.profile_status === "inactive" ? "muted" : "secondary"}>
                                          {p.profile_name}
                                        </Badge>
                                      ))
                                    )}
                                  </div>
                                );
                              })}
                            {!userMemberships || userMemberships.size === 0 ? (
                              <span className="text-xs text-muted-foreground">Aucun accès</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Modifier"
                              aria-label={`Modifier ${u.email}`} onClick={() => openEdit(u)}>
                              <Pencil />
                            </Button>
                            <Button variant="ghost" size="icon"
                              title="Envoyer un lien de réinitialisation"
                              aria-label={`Envoyer un lien de réinitialisation à ${u.email}`}
                              disabled={sendPasswordReset.isPending}
                              onClick={() => void onSendPasswordReset(u)}>
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

      {/* Invitation */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter un utilisateur</DialogTitle>
            <DialogDescription>
              Le compte est ouvert sans mot de passe : son titulaire reçoit un lien d'activation
              et choisit lui-même le sien.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitInvite} className="flex flex-col gap-4">
            <Field label="Email" htmlFor="cu-email" required>
              <Input id="cu-email" type="email" required value={cEmail}
                onChange={(e) => setCEmail(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prénom" htmlFor="cu-first">
                <Input id="cu-first" value={cIdentity.firstName}
                  onChange={(e) => setC("firstName", e.target.value)} />
              </Field>
              <Field label="Nom" htmlFor="cu-last">
                <Input id="cu-last" value={cIdentity.lastName}
                  onChange={(e) => setC("lastName", e.target.value)} />
              </Field>
              <Field label="Téléphone fixe" htmlFor="cu-landline">
                <Input id="cu-landline" type="tel" inputMode="tel" maxLength={PHONE_MAX_LENGTH}
                  value={cIdentity.landlinePhone}
                  onChange={(e) => setC("landlinePhone", e.target.value)} />
              </Field>
              <Field label="Téléphone portable" htmlFor="cu-mobile">
                <Input id="cu-mobile" type="tel" inputMode="tel" maxLength={PHONE_MAX_LENGTH}
                  value={cIdentity.mobilePhone}
                  onChange={(e) => setC("mobilePhone", e.target.value)} />
              </Field>
            </div>
            <Field label="Tenant" htmlFor="cu-tenant"
              hint="Un simple accès — l'attribution d'un profil de droits se fait ensuite depuis les Paramètres du tenant. Le mail part par le serveur d'envoi de ce tenant.">
              <Select id="cu-tenant" value={cTenant} onChange={(e) => setCTenant(e.target.value)}>
                <option value="">— Aucun accès pour l'instant —</option>
                {(tenants.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={inviteUser.isPending}>
                {inviteUser.isPending ? "Envoi…" : "Inviter"}
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
                    <Input id="eu-first" value={eIdentity.firstName}
                      onChange={(e) => setE("firstName", e.target.value)} />
                  </Field>
                  <Field label="Nom" htmlFor="eu-last">
                    <Input id="eu-last" value={eIdentity.lastName}
                      onChange={(e) => setE("lastName", e.target.value)} />
                  </Field>
                  <Field label="Téléphone fixe" htmlFor="eu-landline">
                    <Input id="eu-landline" type="tel" inputMode="tel" maxLength={PHONE_MAX_LENGTH}
                      value={eIdentity.landlinePhone}
                      onChange={(e) => setE("landlinePhone", e.target.value)} />
                  </Field>
                  <Field label="Téléphone portable" htmlFor="eu-mobile">
                    <Input id="eu-mobile" type="tel" inputMode="tel" maxLength={PHONE_MAX_LENGTH}
                      value={eIdentity.mobilePhone}
                      onChange={(e) => setE("mobilePhone", e.target.value)} />
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
                    Appliqué immédiatement — un simple accès, sans rôle. Les droits
                    (consultation, création, instruction, clôture, administration) se règlent
                    ensuite dans les Paramètres du tenant, par l'attribution de profils de
                    droits.
                  </p>
                  {(tenants.data ?? []).map((t) => {
                    const hasAccess = membershipsByUser.get(editUser.id)?.has(t.id) ?? false;
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-3">
                        <span className="text-sm">{t.name}</span>
                        <Button
                          type="button"
                          variant={hasAccess ? "outline" : "ghost"}
                          size="sm"
                          onClick={() => void onMembershipToggle(editUser.id, t.id, hasAccess)}
                        >
                          {hasAccess ? "Retirer l'accès" : "Donner accès"}
                        </Button>
                      </div>
                    );
                  })}
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

      {/* Issue du geste — aucun secret n'y figure */}
      <Dialog open={notice !== null} onOpenChange={(o) => { if (!o) setNotice(null); }}>
        <DialogContent>
          {notice ? (
            <>
              <DialogHeader>
                <DialogTitle>{notice.title}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2 text-sm">
                {notice.lines.map((line) => (
                  <p key={line} className={notice.tone === "warning" ? "text-destructive" : "text-muted-foreground"}>
                    {line}
                  </p>
                ))}
              </div>
              <DialogFooter>
                <Button onClick={() => setNotice(null)}>Fermer</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
