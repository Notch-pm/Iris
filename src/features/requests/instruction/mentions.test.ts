import { describe, expect, it } from "vitest";
import {
  activeMentionQuery, bodySegments, filterMentionables, insertMention, mentionInitials,
  mentionToken, parseMentions, plainBody, withoutSelf, type MentionableUser,
} from "./mentions";

const CAMILLE = "11111111-2222-3333-4444-555555555555";
const DOMINIQUE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const USERS: MentionableUser[] = [
  { userId: CAMILLE, displayName: "Camille Martin", email: "camille@ville.fr" },
  { userId: DOMINIQUE, displayName: "Dominique Léro", email: "dominique@ville.fr" },
  { userId: "cccccccc-cccc-cccc-cccc-cccccccccccc", displayName: "Alex Dupont", email: "alex@ville.fr" },
];

describe("mentionToken", () => {
  it("compose le jeton attendu par la base", () => {
    expect(mentionToken({ userId: CAMILLE, displayName: "Camille Martin" }))
      .toBe(`@[Camille Martin](${CAMILLE})`);
  });

  it("retire les crochets, qui casseraient le motif", () => {
    expect(mentionToken({ userId: CAMILLE, displayName: "Camille [DGS] Martin" }))
      .toBe(`@[Camille DGS Martin](${CAMILLE})`);
  });
});

describe("parseMentions", () => {
  it("extrait les identifiants dans l'ordre, sans doublon", () => {
    const body = `Bonjour @[Camille Martin](${CAMILLE}), voir avec @[Dominique Léro](${DOMINIQUE}) ` +
      `et encore @[Camille Martin](${CAMILLE}).`;
    expect(parseMentions(body)).toEqual([CAMILLE, DOMINIQUE]);
  });

  it("ignore ce qui ressemble à une mention sans en être une", () => {
    expect(parseMentions("écrire à camille@ville.fr")).toEqual([]);
    expect(parseMentions("@[Camille](pas-un-uuid)")).toEqual([]);
    expect(parseMentions("")).toEqual([]);
  });
});

describe("bodySegments", () => {
  it("découpe texte et mentions en conservant l'ordre", () => {
    const segs = bodySegments(`Voir @[Camille Martin](${CAMILLE}) demain.`);
    expect(segs).toEqual([
      { kind: "text", text: "Voir " },
      { kind: "mention", userId: CAMILLE, label: "Camille Martin" },
      { kind: "text", text: " demain." },
    ]);
  });

  it("préfère TOUJOURS le nom vivant de l'annuaire au nom figé dans le jeton", () => {
    // Un agent peut avoir écrit le jeton à la main avec un nom mensonger.
    const segs = bodySegments(
      `@[Le Maire](${CAMILLE})`,
      new Map([[CAMILLE, "Camille Martin"]]),
    );
    expect(segs).toEqual([{ kind: "mention", userId: CAMILLE, label: "Camille Martin" }]);
  });

  it("se rabat sur le nom du jeton quand l'utilisateur n'est plus connu", () => {
    const segs = bodySegments(`@[Ancien Agent](${CAMILLE})`, new Map());
    expect(segs).toEqual([{ kind: "mention", userId: CAMILLE, label: "Ancien Agent" }]);
  });

  it("rend un corps sans mention en un seul segment", () => {
    expect(bodySegments("Rien à signaler.")).toEqual([{ kind: "text", text: "Rien à signaler." }]);
  });

  it("gère une mention seule, sans texte autour", () => {
    expect(bodySegments(`@[Camille Martin](${CAMILLE})`)).toEqual([
      { kind: "mention", userId: CAMILLE, label: "Camille Martin" },
    ]);
  });
});

describe("plainBody", () => {
  it("rend le corps lisible, jetons remplacés par « @Nom »", () => {
    expect(plainBody(`Voir @[Camille Martin](${CAMILLE}) demain.`))
      .toBe("Voir @Camille Martin demain.");
  });
});

describe("activeMentionQuery", () => {
  it("détecte un « @ » qui vient d'être tapé", () => {
    expect(activeMentionQuery("Voir @", 6)).toEqual({ start: 5, query: "" });
  });

  it("suit la saisie après le « @ »", () => {
    expect(activeMentionQuery("Voir @cam", 9)).toEqual({ start: 5, query: "cam" });
  });

  it("accepte un « @ » en tout début de note", () => {
    expect(activeMentionQuery("@cam", 4)).toEqual({ start: 0, query: "cam" });
  });

  it("n'ouvre PAS de menu sur une adresse e-mail", () => {
    expect(activeMentionQuery("camille@ville", 13)).toBeNull();
  });

  it("se referme sur un retour à la ligne", () => {
    expect(activeMentionQuery("@cam\nsuite", 10)).toBeNull();
  });

  it("ne rouvre pas de menu sur un jeton déjà posé", () => {
    expect(activeMentionQuery(`@[Camille Martin](${CAMILLE})`, 28)).toBeNull();
  });

  it("abandonne au-delà d'une longueur de nom plausible", () => {
    expect(activeMentionQuery(`@${"a".repeat(41)}`, 42)).toBeNull();
  });

  it("ne regarde que ce qui précède le curseur", () => {
    // Curseur avant le « @ » : aucune recherche en cours.
    expect(activeMentionQuery("Voir @cam", 4)).toBeNull();
  });

  it("rend null sans « @ »", () => {
    expect(activeMentionQuery("Rien à signaler", 15)).toBeNull();
  });
});

describe("filterMentionables", () => {
  it("rend tout le monde sur une saisie vide", () => {
    expect(filterMentionables(USERS, "")).toHaveLength(3);
  });

  it("ignore accents et casse", () => {
    expect(filterMentionables(USERS, "LERO").map((u) => u.displayName)).toEqual(["Dominique Léro"]);
    expect(filterMentionables(USERS, "léro").map((u) => u.displayName)).toEqual(["Dominique Léro"]);
  });

  it("exige tous les mots, dans n'importe quel ordre", () => {
    expect(filterMentionables(USERS, "martin camille").map((u) => u.displayName))
      .toEqual(["Camille Martin"]);
  });

  it("cherche aussi dans l'adresse", () => {
    expect(filterMentionables(USERS, "alex@").map((u) => u.displayName)).toEqual(["Alex Dupont"]);
  });

  it("rend une liste vide quand rien ne correspond", () => {
    expect(filterMentionables(USERS, "zzz")).toEqual([]);
  });
});

describe("withoutSelf", () => {
  it("retire son propre compte du menu", () => {
    expect(withoutSelf(USERS, CAMILLE).map((u) => u.displayName))
      .toEqual(["Dominique Léro", "Alex Dupont"]);
  });

  it("ne retire rien sans identité connue", () => {
    expect(withoutSelf(USERS, null)).toHaveLength(3);
    expect(withoutSelf(USERS, undefined)).toHaveLength(3);
  });

  it("laisse la liste intacte si l'identité n'y figure pas", () => {
    expect(withoutSelf(USERS, "99999999-9999-9999-9999-999999999999")).toHaveLength(3);
  });

  it("ne modifie PAS la liste d'origine — elle sert aussi aux noms vivants", () => {
    const copie = [...USERS];
    withoutSelf(USERS, CAMILLE);
    expect(USERS).toEqual(copie);
  });
});

describe("mentionInitials", () => {
  it("compose deux initiales à partir du nom", () => {
    expect(mentionInitials(USERS[0])).toBe("CM");
    expect(mentionInitials(USERS[1])).toBe("DL");
  });

  it("se contente d'un prénom", () => {
    expect(mentionInitials({ userId: "x", displayName: "Camille", email: "c@x.fr" })).toBe("C");
  });

  it("se rabat sur l'adresse quand il n'y a pas de nom", () => {
    expect(mentionInitials({ userId: "x", displayName: "", email: "zoe@x.fr" })).toBe("Z");
    expect(mentionInitials({ userId: "x", displayName: "   ", email: "zoe@x.fr" })).toBe("Z");
  });

  it("ne jette pas sur un utilisateur sans rien", () => {
    expect(mentionInitials({ userId: "x", displayName: "", email: "" })).toBe("?");
  });
});

describe("insertMention", () => {
  it("remplace la saisie en cours par le jeton et une espace", () => {
    const text = "Voir @cam";
    const active = activeMentionQuery(text, text.length)!;
    expect(insertMention(text, active, USERS[0])).toEqual({
      text: `Voir @[Camille Martin](${CAMILLE}) `,
      caret: `Voir @[Camille Martin](${CAMILLE}) `.length,
    });
  });

  it("conserve ce qui suit le curseur", () => {
    const text = "Voir @cam demain";
    const active = activeMentionQuery(text, 9)!;
    const out = insertMention(text, active, USERS[0]);
    expect(out.text).toBe(`Voir @[Camille Martin](${CAMILLE})  demain`);
    expect(parseMentions(out.text)).toEqual([CAMILLE]);
  });

  it("fonctionne sur un « @ » nu", () => {
    const text = "@";
    const active = activeMentionQuery(text, 1)!;
    expect(insertMention(text, active, USERS[1]).text).toBe(`@[Dominique Léro](${DOMINIQUE}) `);
  });

  it("permet d'enchaîner deux mentions", () => {
    let text = "@";
    text = insertMention(text, activeMentionQuery(text, 1)!, USERS[0]).text;
    text += "@";
    const out = insertMention(text, activeMentionQuery(text, text.length)!, USERS[1]);
    expect(parseMentions(out.text)).toEqual([CAMILLE, DOMINIQUE]);
  });
});
