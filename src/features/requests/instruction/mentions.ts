// Mentions dans les notes internes — logique pure, sans DOM ni réseau.
//
// ENCODAGE. Une mention vit DANS le corps de la note : `@[Nom affiché](uuid)`.
// La note reste auto-portante — la base valide et notifie à partir du seul
// corps, sans table satellite à tenir synchronisée — et le motif est le même
// côté SQL (`message_mentions`) et côté écran : une seule vérité.
//
// ⚠️ Le nom figé dans le jeton n'est PAS de confiance : rien n'empêche un
// agent d'écrire `@[Le Maire](uuid-de-quelqu-un-d-autre)` à la main. À
// l'affichage on préfère donc TOUJOURS le nom vivant de l'annuaire, et le nom
// du jeton ne sert que de repli quand l'utilisateur n'est plus connu.

export interface MentionableUser {
  userId: string;
  displayName: string;
  email: string;
  /** Chemin de la photo dans le bucket privé — null = initiales. */
  avatarPath?: string | null;
}

/** Doit rester le jumeau exact de `public.message_mentions` (SQL). */
const MENTION_RE =
  /@\[([^\]]*)\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

export function mentionToken(user: { userId: string; displayName: string }): string {
  // Les crochets fermants casseraient le motif : ils n'ont pas leur place dans
  // un nom, on les retire plutôt que de produire un jeton illisible.
  return `@[${user.displayName.replace(/[[\]]/g, "")}](${user.userId})`;
}

/** UUID mentionnés, dédoublonnés, dans l'ordre d'apparition. */
export function parseMentions(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    if (!out.includes(m[2])) out.push(m[2]);
  }
  return out;
}

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; userId: string; label: string };

/**
 * Découpe le corps en segments pour l'affichage. Les mentions deviennent des
 * pastilles, le reste du texte est rendu tel quel (et échappé par React).
 */
export function bodySegments(body: string, names?: Map<string, string>): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: body.slice(last, start) });
    const live = names?.get(m[2]);
    out.push({ kind: "mention", userId: m[2], label: live ?? m[1] ?? "" });
    last = start + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

/** Le corps privé de ses jetons — ce qu'un humain lit vraiment. */
export function plainBody(body: string, names?: Map<string, string>): string {
  return bodySegments(body, names)
    .map((s) => (s.kind === "text" ? s.text : `@${s.label}`))
    .join("");
}

// ---------------------------------------------------------------------------
// Saisie : détecter le « @… » en cours de frappe, et le remplacer
// ---------------------------------------------------------------------------

export interface ActiveQuery {
  /** Position du `@` déclencheur. */
  start: number;
  /** Texte tapé après le `@` (peut être vide juste après la frappe du `@`). */
  query: string;
}

/** Un `@` n'ouvre une mention qu'en début de texte ou après une espace : sinon
 *  c'est une adresse e-mail, et personne ne veut d'un menu en la tapant. */
function opensMention(text: string, at: number): boolean {
  if (at === 0) return true;
  return /\s/.test(text[at - 1]);
}

/**
 * Le `@…` en cours de frappe à la position du curseur, ou `null`.
 * On remonte depuis le curseur jusqu'au `@` le plus proche ; une espace, un
 * retour à la ligne ou un jeton déjà posé referment la recherche.
 */
export function activeMentionQuery(text: string, caret: number): ActiveQuery | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (!opensMention(text, at)) return null;

  const query = upto.slice(at + 1);
  // Une mention se choisit en quelques caractères : au-delà, l'utilisateur
  // écrit une phrase, pas un nom.
  if (query.length > 40) return null;
  if (/[\n\r]/.test(query)) return null;
  // `@[` = un jeton déjà écrit : ne pas rouvrir un menu dessus.
  if (query.startsWith("[")) return null;
  return { start: at, query };
}

/**
 * L'annuaire privé de soi-même : on ne se propose pas dans son propre menu de
 * mentions (se citer n'a aucun effet — la règle « jamais pour son propre
 * geste » fait taire la notification).
 *
 * ⚠️ À faire ICI et pas dans la RPC : `mentionable_users` sert AUSSI à résoudre
 * les noms vivants des mentions déjà écrites, y compris les siennes. L'amputer
 * ferait retomber sa propre mention sur le nom figé du jeton.
 */
export function withoutSelf(
  users: MentionableUser[],
  selfId: string | null | undefined,
): MentionableUser[] {
  if (!selfId) return users;
  return users.filter((u) => u.userId !== selfId);
}

/** Initiales du rond, à partir du nom affiché (ou de l'adresse). */
export function mentionInitials(user: MentionableUser): string {
  const words = user.displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1 && words[0].length > 0) return words[0][0].toUpperCase();
  const email = user.email.trim();
  return email ? email[0].toUpperCase() : "?";
}

/** Filtre l'annuaire sur la saisie — accents et casse ignorés, tous les mots exigés. */
export function filterMentionables(users: MentionableUser[], query: string): MentionableUser[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return users;
  return users.filter((u) => {
    const hay = normalize(`${u.displayName} ${u.email}`);
    return words.every((w) => hay.includes(w));
  });
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export interface Insertion {
  text: string;
  /** Position du curseur après insertion — juste après l'espace ajoutée. */
  caret: number;
}

/**
 * Remplace le `@…` en cours par le jeton de l'utilisateur choisi, et ajoute une
 * espace : on enchaîne la frappe sans avoir à en taper une.
 */
export function insertMention(
  text: string,
  active: ActiveQuery,
  user: MentionableUser,
): Insertion {
  const token = `${mentionToken(user)} `;
  const before = text.slice(0, active.start);
  const after = text.slice(active.start + 1 + active.query.length);
  return { text: before + token + after, caret: before.length + token.length };
}
