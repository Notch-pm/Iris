// « Mon compte » — l'écran de l'utilisateur sur lui-même : son identité, sa
// photo, son mot de passe, ses préférences de notification.
//
// Rien ici n'est administré par quelqu'un d'autre : chaque bloc est un geste
// personnel. L'adresse e-mail fait exception — c'est l'identifiant de
// connexion, il est administré, et la base le refuse (trigger
// `t03_users_protect_email`) : l'écran ne fait que le refléter.

import * as React from "react";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  defaultMatrix, displayName, initials, matrixEquals, PREFERENCE_ROWS, silencedCount,
  validateAvatar, validatePasswordForm, type PreferenceMatrix,
} from "./account";
import {
  useAvatarUrl, useChangePassword, useNotificationPreferences, useRemoveAvatar,
  useSaveNotificationPreferences, useUpdateNames, useUploadAvatar,
} from "./useAccount";

type Note = { text: string; error: boolean } | null;

function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p
      role={note.error ? "alert" : "status"}
      className={cn("text-xs", note.error ? "text-destructive" : "text-primary")}
    >
      {note.text}
    </p>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identité et photo
// ---------------------------------------------------------------------------

function IdentityCard() {
  const { profile, session } = useAuth();
  const avatarUrl = useAvatarUrl(profile?.avatar_path ?? null).data ?? null;
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const updateNames = useUpdateNames();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = React.useState(profile?.first_name ?? "");
  const [lastName, setLastName] = React.useState(profile?.last_name ?? "");
  const [note, setNote] = React.useState<Note>(null);
  const [photoNote, setPhotoNote] = React.useState<Note>(null);

  // Le profil arrive après le premier rendu : on aligne les champs tant que
  // l'utilisateur n'a rien saisi (clé sur l'id, pas sur l'objet profil).
  const profileId = profile?.id ?? null;
  React.useEffect(() => {
    setFirstName(profile?.first_name ?? "");
    setLastName(profile?.last_name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const dirty =
    (profile?.first_name ?? "") !== firstName || (profile?.last_name ?? "") !== lastName;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Le champ est remis à zéro tout de suite : re-choisir le MÊME fichier
    // après une erreur doit relancer un « change ».
    e.target.value = "";
    if (!file) return;
    const problem = validateAvatar({ name: file.name, type: file.type, size: file.size });
    if (problem) {
      setPhotoNote({ text: problem, error: true });
      return;
    }
    setPhotoNote(null);
    try {
      await upload.mutateAsync(file);
      setPhotoNote({ text: "Photo mise à jour.", error: false });
    } catch (err) {
      setPhotoNote({ text: err instanceof Error ? err.message : "Envoi impossible.", error: true });
    }
  }

  async function onRemove() {
    setPhotoNote(null);
    try {
      await remove.mutateAsync();
      setPhotoNote({ text: "Photo retirée.", error: false });
    } catch (err) {
      setPhotoNote({ text: err instanceof Error ? err.message : "Suppression impossible.", error: true });
    }
  }

  async function onSaveNames() {
    setNote(null);
    try {
      await updateNames.mutateAsync({ firstName, lastName });
      setNote({ text: "Identité enregistrée.", error: false });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Enregistrement impossible.", error: true });
    }
  }

  const busy = upload.isPending || remove.isPending;

  return (
    <Surface className="p-6">
      <SectionTitle title="Identité" />

      <div className="flex flex-wrap items-start gap-6">
        {/* Le rond : la photo si elle existe, les initiales sinon. */}
        <div className="flex flex-col items-center gap-2">
          <span className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-primary text-2xl font-bold text-primary-foreground">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(profile)
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Camera className="size-4" aria-hidden="true" />
              {profile?.avatar_path ? "Changer" : "Ajouter"}
            </Button>
            {profile?.avatar_path ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void onRemove()}
                aria-label="Retirer la photo"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void onPick(e)}
          />
          <p className="max-w-[12rem] text-center text-[11px] text-muted-foreground">
            JPEG, PNG, WebP ou GIF — 2 Mo maximum.
          </p>
          <NoteLine note={photoNote} />
        </div>

        {/* Colonne de champs : empilée, pas en deux colonnes — la carte ne fait
            plus que la moitié de la page, deux champs côte à côte y seraient
            à l'étroit. */}
        <div className="flex min-w-[16rem] flex-1 flex-col gap-4">
          <Field label="Prénom" htmlFor="first-name">
            <Input
              id="first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Nom" htmlFor="last-name">
            <Input
              id="last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
            />
          </Field>
          <Field
            label="Adresse e-mail"
            htmlFor="email"
            hint="Votre identifiant de connexion. Il est administré : adressez-vous à un administrateur pour le modifier."
          >
            <Input id="email" value={session?.user.email ?? ""} readOnly disabled />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!dirty || updateNames.isPending}
              onClick={() => void onSaveNames()}
            >
              {updateNames.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <NoteLine note={note} />
          </div>
        </div>
      </div>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Mot de passe
// ---------------------------------------------------------------------------

function PasswordCard() {
  const change = useChangePassword();
  const [form, setForm] = React.useState({ current: "", next: "", confirm: "" });
  const [note, setNote] = React.useState<Note>(null);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validatePasswordForm(form);
    if (problem) {
      setNote({ text: problem, error: true });
      return;
    }
    setNote(null);
    try {
      await change.mutateAsync({ current: form.current, next: form.next });
      setForm({ current: "", next: "", confirm: "" });
      setNote({ text: "Mot de passe modifié.", error: false });
    } catch (err) {
      setNote({
        text: err instanceof Error ? err.message : "Changement impossible.",
        error: true,
      });
    }
  }

  return (
    <Surface className="p-6">
      <SectionTitle
        title="Mot de passe"
        hint="Votre mot de passe actuel est demandé : personne d'autre que vous ne doit pouvoir le changer depuis une session laissée ouverte."
      />
      <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
        <Field label="Mot de passe actuel" htmlFor="pwd-current" required>
          <Input
            id="pwd-current"
            type="password"
            value={form.current}
            onChange={set("current")}
            autoComplete="current-password"
          />
        </Field>
        <Field label="Nouveau mot de passe" htmlFor="pwd-next" required hint="8 caractères minimum.">
          <Input
            id="pwd-next"
            type="password"
            value={form.next}
            onChange={set("next")}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirmation" htmlFor="pwd-confirm" required>
          <Input
            id="pwd-confirm"
            type="password"
            value={form.confirm}
            onChange={set("confirm")}
            autoComplete="new-password"
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? "Modification…" : "Changer le mot de passe"}
          </Button>
          <NoteLine note={note} />
        </div>
      </form>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Préférences de notification
// ---------------------------------------------------------------------------

function PreferencesCard() {
  const query = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const [matrix, setMatrix] = React.useState<PreferenceMatrix>(defaultMatrix);
  const [note, setNote] = React.useState<Note>(null);

  const loaded = query.data;
  React.useEffect(() => {
    if (loaded) setMatrix(loaded);
  }, [loaded]);

  const dirty = loaded ? !matrixEquals(loaded, matrix) : false;
  const silenced = silencedCount(matrix);

  function toggle(kind: keyof PreferenceMatrix, channel: "inApp" | "email") {
    setMatrix((m) => ({ ...m, [kind]: { ...m[kind], [channel]: !m[kind][channel] } }));
    setNote(null);
  }

  async function onSave() {
    setNote(null);
    try {
      await save.mutateAsync(matrix);
      setNote({ text: "Préférences enregistrées.", error: false });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Enregistrement impossible.", error: true });
    }
  }

  return (
    <Surface className="p-6">
      <SectionTitle
        title="Notifications"
        hint="Ces réglages valent pour toutes les organisations auxquelles vous avez accès. Décochez les deux cases pour ne rien recevoir d'un événement."
      />

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">Préférences indisponibles.</p>
      ) : (
        <>
          {/* La carte est pleine largeur ; le TABLEAU garde une largeur de
              lecture : au-delà, l'œil parcourt un vide de plusieurs centaines
              de pixels entre un libellé et sa case à cocher. */}
          <div className="max-w-[46rem] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Événement</th>
                  <th className="w-28 px-3 py-2 text-center font-medium">Dans Iris</th>
                  <th className="w-28 px-3 py-2 text-center font-medium">Par e-mail</th>
                </tr>
              </thead>
              <tbody>
                {PREFERENCE_ROWS.map((row) => {
                  const choice = matrix[row.kind];
                  const muet = !choice.inApp && !choice.email;
                  return (
                    <tr key={row.kind} className="border-b border-border/60 last:border-0">
                      <td className="py-3 pr-4">
                        <span className="font-medium">{row.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {muet ? "Aucune notification pour cet événement." : row.hint}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          className="size-4 accent-[hsl(var(--primary))]"
                          checked={choice.inApp}
                          onChange={() => toggle(row.kind, "inApp")}
                          aria-label={`${row.label} — notification dans Iris`}
                        />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          className="size-4 accent-[hsl(var(--primary))]"
                          checked={choice.email}
                          onChange={() => toggle(row.kind, "email")}
                          aria-label={`${row.label} — notification par e-mail`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {silenced > 0 ? (
            <p className="mt-3 max-w-[46rem] text-xs text-muted-foreground">
              {silenced === 1
                ? "Un événement ne vous sera plus signalé du tout."
                : `${silenced} événements ne vous seront plus signalés du tout.`}{" "}
              Les demandes concernées restent visibles dans la liste.
            </p>
          ) : null}

          <div className="mt-5 flex items-center gap-3">
            <Button type="button" disabled={!dirty || save.isPending} onClick={() => void onSave()}>
              {save.isPending ? "Enregistrement…" : "Enregistrer les préférences"}
            </Button>
            <NoteLine note={note} />
          </div>
        </>
      )}
    </Surface>
  );
}

// ---------------------------------------------------------------------------

export function AccountPage() {
  const { profile } = useAuth();
  return (
    // ⚠️ AUCUN plafond de largeur ici : le shell en pose déjà un (colonne
    // centrée à 1240px). Un second plafond posé par la page — qui plus est
    // aligné à gauche — laissait tout le vide s'accumuler à DROITE et donnait
    // des marges asymétriques. Une page ne re-borne pas ce que le shell borne.
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mon compte</h1>
        <p className="mt-1 text-sm text-muted-foreground">{displayName(profile)}</p>
      </div>
      {/* Identité et mot de passe côte à côte dès qu'il y a la place ; en
          dessous de `lg`, ils s'empilent sans rien perdre. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <IdentityCard />
        <PasswordCard />
      </div>
      <PreferencesCard />
    </div>
  );
}
