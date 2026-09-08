// Logique de l'écran « Mon compte » — pure, sans DOM ni réseau.
//
// Trois sujets sans rapport entre eux (mot de passe, photo, préférences) mais
// une même règle : tout ce qui décide vit ici, l'écran ne fait que rendre et
// appeler. La base reste l'autorité (RLS, gardes) — ces contrôles ne sont là
// que pour ne pas envoyer au serveur ce qu'on sait déjà invalide, et pour dire
// pourquoi en français.

import { NOTIFICATION_KINDS, type NotificationKind } from "@/features/notifications/notifications";

// ---------------------------------------------------------------------------
// Préférences de notification — matrice (motif × canal)
// ---------------------------------------------------------------------------

export interface ChannelChoice {
  inApp: boolean;
  email: boolean;
}

export type PreferenceMatrix = Record<NotificationKind, ChannelChoice>;

/** Libellés de la colonne de gauche — l'ordre est celui du parcours d'un agent. */
export const PREFERENCE_ROWS: { kind: NotificationKind; label: string; hint: string }[] = [
  {
    kind: "assigned",
    label: "Une demande m'est affectée",
    hint: "Quelqu'un me confie une demande à instruire.",
  },
  {
    kind: "unassigned",
    label: "Une demande m'est retirée",
    hint: "On me retire une demande, ou elle passe à un collègue.",
  },
  {
    kind: "status_changed",
    label: "Le statut d'une de mes demandes change",
    hint: "Une demande qui m'est affectée change d'état sans que j'y sois pour rien.",
  },
  {
    kind: "note_added",
    label: "Une note interne est ajoutée",
    hint: "Un collègue commente une demande qui m'est affectée.",
  },
  {
    kind: "mentioned",
    label: "Je suis mentionné dans une note",
    hint: "Un collègue écrit « @moi » dans une note interne d'une demande.",
  },
  {
    kind: "new_request_in_scope",
    label: "Une nouvelle demande entre dans mon périmètre",
    hint: "Une demande arrive sur un couple (organisation, démarche) que j'instruis.",
  },
  {
    kind: "transferred_in",
    label: "Une demande nous est transférée",
    hint: "Un autre service confie à mon organisme une demande que j'instruis.",
  },
];

/** Sans préférence enregistrée, tout est activé — *fail open*, comme en base. */
export function defaultMatrix(): PreferenceMatrix {
  const out = {} as PreferenceMatrix;
  for (const kind of NOTIFICATION_KINDS) out[kind] = { inApp: true, email: true };
  return out;
}

/** Une ligne de `notification_preferences` telle que la base la rend. */
export interface PreferenceRow {
  kind: string;
  in_app: boolean;
  email: boolean;
}

/**
 * Lignes → matrice. La ligne `'*'` porte le défaut du compte, une ligne de
 * motif la surcharge : même sémantique que `notification_channels_for()` en
 * base — c'est volontairement le SEUL endroit où elle est réimplémentée, et
 * l'écran ne montre donc jamais autre chose que ce qui s'appliquera vraiment.
 */
export function matrixFromRows(rows: PreferenceRow[]): PreferenceMatrix {
  const fallback = rows.find((r) => r.kind === "*");
  const base: ChannelChoice = fallback
    ? { inApp: fallback.in_app, email: fallback.email }
    : { inApp: true, email: true };

  const out = {} as PreferenceMatrix;
  for (const kind of NOTIFICATION_KINDS) {
    const exact = rows.find((r) => r.kind === kind);
    out[kind] = exact ? { inApp: exact.in_app, email: exact.email } : { ...base };
  }
  return out;
}

/**
 * Matrice → lignes à écrire. On écrit UNE ligne par motif (jamais `'*'`) :
 * l'écran est explicite, chaque case cochée devient une décision enregistrée.
 * `'*'` reste au modèle pour un futur réglage global, il n'est pas produit ici.
 */
export function rowsFromMatrix(matrix: PreferenceMatrix): PreferenceRow[] {
  return NOTIFICATION_KINDS.map((kind) => ({
    kind,
    in_app: matrix[kind].inApp,
    email: matrix[kind].email,
  }));
}

export function matrixEquals(a: PreferenceMatrix, b: PreferenceMatrix): boolean {
  return NOTIFICATION_KINDS.every(
    (k) => a[k].inApp === b[k].inApp && a[k].email === b[k].email,
  );
}

/** Combien de motifs sont totalement muets — sert la mise en garde de l'écran. */
export function silencedCount(matrix: PreferenceMatrix): number {
  return NOTIFICATION_KINDS.filter((k) => !matrix[k].inApp && !matrix[k].email).length;
}

// ---------------------------------------------------------------------------
// Changement de mot de passe
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordForm {
  current: string;
  next: string;
  confirm: string;
}

/**
 * `null` = le formulaire peut partir. Sinon, la raison, en français.
 * L'ordre des contrôles suit celui de la saisie : on ne reproche pas la
 * confirmation à quelqu'un qui n'a pas encore tapé le nouveau mot de passe.
 */
export function validatePasswordForm(form: PasswordForm): string | null {
  if (form.current.length === 0) return "Saisissez votre mot de passe actuel.";
  if (form.next.length === 0) return "Saisissez le nouveau mot de passe.";
  if (form.next.length < PASSWORD_MIN_LENGTH) {
    return `Le nouveau mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (form.next === form.current) {
    return "Le nouveau mot de passe doit être différent de l'actuel.";
  }
  if (form.confirm !== form.next) return "La confirmation ne correspond pas.";
  return null;
}

// ---------------------------------------------------------------------------
// Photo de profil
// ---------------------------------------------------------------------------

/** Miroir de `allowed_mime_types` du bucket : la base refuse déjà le reste. */
export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export interface PickedFile {
  name: string;
  type: string;
  size: number;
}

/** `null` = acceptable. Sinon la raison — dite avant l'envoi, pas après. */
export function validateAvatar(file: PickedFile): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type)) {
    return "Format non accepté : choisissez une image JPEG, PNG, WebP ou GIF.";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return "Image trop lourde : 2 Mo au maximum.";
  }
  if (file.size === 0) return "Le fichier est vide.";
  return null;
}

/** Extension déduite du type MIME, jamais du nom de fichier (qui ment). */
export function avatarExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "jpg";
  }
}

/**
 * Chemin de stockage. Le premier segment EST l'identifiant de l'utilisateur :
 * c'est lui que la policy storage compare à `auth.uid()`. Le nom est tiré au
 * sort à chaque envoi — un nouvel envoi ne réécrit jamais l'objet précédent,
 * donc aucun cache de navigateur à combattre.
 */
export function avatarPath(userId: string, mimeType: string, token: string): string {
  return `${userId}/${token}.${avatarExtension(mimeType)}`;
}

// ---------------------------------------------------------------------------
// Coordonnées téléphoniques
// ---------------------------------------------------------------------------

/** Miroir de `users_phones_length_check` : la base refuse déjà au-delà. */
export const PHONE_MAX_LENGTH = 40;

/**
 * Ce qu'on accepte dans un numéro : des chiffres, et de quoi les présenter —
 * espaces, points, tirets, barres obliques, parenthèses, et un `+` d'indicatif.
 *
 * ⚠️ On ne valide PAS un format, délibérément. Iris n'a pas à décider qu'un
 * agent est joignable en France : indicatifs étrangers, extensions et
 * séparations libres passent. Le seul refus est ce qui ne peut pas être un
 * numéro — des lettres —, parce que là c'est une faute de frappe, pas un choix.
 * Même parti pris que pour les contacts du Socle, où rien n'est normalisé.
 */
const PHONE_ALLOWED = /^[+()./\s\d-]*$/;

/** `null` = acceptable (le vide compris : un téléphone n'est pas obligatoire). */
export function validatePhone(value: string, label: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (!PHONE_ALLOWED.test(v)) {
    return `${label} : seuls les chiffres et les séparateurs (+ - . / espace) sont acceptés.`;
  }
  if ((v.match(/\d/g) ?? []).length < 4) {
    return `${label} : ce numéro semble incomplet.`;
  }
  if (v.length > PHONE_MAX_LENGTH) {
    return `${label} : ${PHONE_MAX_LENGTH} caractères au maximum.`;
  }
  return null;
}

/**
 * Ce que « Mon compte » et l'écran superadmin écrivent tous les deux dans
 * `public.users`. Un seul objet, une seule validation, un seul « rien n'a
 * changé » — deux écrans, mais une seule idée de ce qu'est une identité.
 */
export interface IdentityForm {
  firstName: string;
  lastName: string;
  landlinePhone: string;
  mobilePhone: string;
}

export interface IdentityRow {
  first_name?: string | null;
  last_name?: string | null;
  landline_phone?: string | null;
  mobile_phone?: string | null;
}

export function identityFormFrom(profile: IdentityRow | null | undefined): IdentityForm {
  return {
    firstName: profile?.first_name ?? "",
    lastName: profile?.last_name ?? "",
    landlinePhone: profile?.landline_phone ?? "",
    mobilePhone: profile?.mobile_phone ?? "",
  };
}

/** `null` = le formulaire peut partir. Sinon la raison, en français. */
export function validateIdentityForm(form: IdentityForm): string | null {
  return validatePhone(form.landlinePhone, "Téléphone fixe")
    ?? validatePhone(form.mobilePhone, "Téléphone portable");
}

/**
 * Le bouton reste inactif tant que rien n'a bougé. La comparaison se fait sur
 * les valeurs TAILLÉES, celles qui partiront : ajouter une espace en fin de
 * champ n'est pas une modification.
 */
export function identityChanged(profile: IdentityRow | null | undefined, form: IdentityForm): boolean {
  const before = identityFormFrom(profile);
  return (["firstName", "lastName", "landlinePhone", "mobilePhone"] as const)
    .some((k) => before[k].trim() !== form[k].trim());
}

/** Valeurs prêtes pour la base : taillées, et `null` plutôt qu'une chaîne vide. */
export function identityPatch(form: IdentityForm): Required<IdentityRow> {
  const clean = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    first_name: clean(form.firstName),
    last_name: clean(form.lastName),
    landline_phone: clean(form.landlinePhone),
    mobile_phone: clean(form.mobilePhone),
  };
}

// ---------------------------------------------------------------------------
// Identité affichée
// ---------------------------------------------------------------------------

export function displayName(profile: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null): string {
  if (!profile) return "Utilisateur";
  const full = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return full || profile.email || "Utilisateur";
}

/** Initiales du rond, quand il n'y a pas de photo. */
export function initials(profile: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null): string {
  if (!profile) return "U";
  const letters = [profile.first_name?.[0], profile.last_name?.[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase();
  if (letters) return letters;
  const email = profile.email?.trim();
  return email ? email[0].toUpperCase() : "U";
}
