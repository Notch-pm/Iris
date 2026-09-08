import { describe, expect, it } from "vitest";
import {
  avatarExtension, avatarPath, defaultMatrix, displayName, identityChanged, identityFormFrom,
  identityPatch, initials, matrixEquals, matrixFromRows, PHONE_MAX_LENGTH, PREFERENCE_ROWS,
  rowsFromMatrix, silencedCount, validateAvatar, validateIdentityForm, validatePasswordForm,
  type PreferenceMatrix,
} from "./account";
import { NOTIFICATION_KINDS } from "@/features/notifications/notifications";

describe("matrice de préférences", () => {
  // La matrice se compte SUR le catalogue, jamais sur un nombre écrit ici :
  // un motif ajouté (transferred_in, 2026-09-01) doit faire échouer l'écran
  // qui l'oublie, pas le test qui le compte.
  it("couvre tous les motifs, sans doublon ni oubli", () => {
    expect(PREFERENCE_ROWS.map((r) => r.kind).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    expect(new Set(PREFERENCE_ROWS.map((r) => r.kind)).size).toBe(NOTIFICATION_KINDS.length);
  });

  it("sans aucune ligne enregistrée, tout est activé (fail open, comme en base)", () => {
    const m = matrixFromRows([]);
    expect(m).toEqual(defaultMatrix());
    for (const k of NOTIFICATION_KINDS) expect(m[k]).toEqual({ inApp: true, email: true });
  });

  it("la ligne « * » porte le défaut du compte", () => {
    const m = matrixFromRows([{ kind: "*", in_app: false, email: true }]);
    for (const k of NOTIFICATION_KINDS) expect(m[k]).toEqual({ inApp: false, email: true });
  });

  it("une ligne de motif surcharge le défaut — même sémantique qu'en base", () => {
    const m = matrixFromRows([
      { kind: "*", in_app: false, email: false },
      { kind: "assigned", in_app: true, email: true },
    ]);
    expect(m.assigned).toEqual({ inApp: true, email: true });
    expect(m.note_added).toEqual({ inApp: false, email: false });
  });

  it("ignore un motif inconnu sans planter", () => {
    const m = matrixFromRows([{ kind: "motif_du_futur", in_app: false, email: false }]);
    expect(m).toEqual(defaultMatrix());
  });

  it("écrit une ligne par motif, jamais « * »", () => {
    const rows = rowsFromMatrix(defaultMatrix());
    expect(rows).toHaveLength(NOTIFICATION_KINDS.length);
    expect(rows.some((r) => r.kind === "*")).toBe(false);
    expect(rows.every((r) => r.in_app && r.email)).toBe(true);
  });

  it("aller-retour matrice → lignes → matrice sans perte", () => {
    const m: PreferenceMatrix = {
      ...defaultMatrix(),
      assigned: { inApp: true, email: false },
      note_added: { inApp: false, email: false },
    };
    expect(matrixFromRows(rowsFromMatrix(m))).toEqual(m);
  });

  it("compare deux matrices (bouton « Enregistrer » à l'état inactif)", () => {
    const a = defaultMatrix();
    expect(matrixEquals(a, defaultMatrix())).toBe(true);
    expect(matrixEquals(a, { ...a, assigned: { inApp: false, email: true } })).toBe(false);
  });

  it("compte les motifs devenus totalement muets", () => {
    expect(silencedCount(defaultMatrix())).toBe(0);
    expect(silencedCount({
      ...defaultMatrix(),
      assigned: { inApp: false, email: false },
      note_added: { inApp: false, email: false },
    })).toBe(2);
    // « E-mail seul » n'est pas muet.
    expect(silencedCount({ ...defaultMatrix(), assigned: { inApp: false, email: true } })).toBe(0);
  });
});

describe("validatePasswordForm", () => {
  const ok = { current: "ancien-secret", next: "nouveau-secret", confirm: "nouveau-secret" };

  it("accepte un formulaire complet et cohérent", () => {
    expect(validatePasswordForm(ok)).toBeNull();
  });

  it("réclame l'ancien mot de passe en premier", () => {
    expect(validatePasswordForm({ ...ok, current: "" })).toBe("Saisissez votre mot de passe actuel.");
  });

  it("ne reproche pas la confirmation avant que le nouveau soit saisi", () => {
    expect(validatePasswordForm({ current: "a", next: "", confirm: "" }))
      .toBe("Saisissez le nouveau mot de passe.");
  });

  it("exige une longueur minimale", () => {
    expect(validatePasswordForm({ current: "ancien", next: "court", confirm: "court" }))
      .toBe("Le nouveau mot de passe doit faire au moins 8 caractères.");
  });

  it("refuse de « changer » pour le même mot de passe", () => {
    expect(validatePasswordForm({ current: "identique1", next: "identique1", confirm: "identique1" }))
      .toBe("Le nouveau mot de passe doit être différent de l'actuel.");
  });

  it("refuse une confirmation divergente", () => {
    expect(validatePasswordForm({ ...ok, confirm: "autre-chose" }))
      .toBe("La confirmation ne correspond pas.");
  });
});

describe("photo de profil", () => {
  it("accepte les formats du bucket", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(validateAvatar({ name: "p", type, size: 1000 })).toBeNull();
    }
  });

  it("refuse un format non image", () => {
    expect(validateAvatar({ name: "doc.pdf", type: "application/pdf", size: 1000 }))
      .toMatch(/Format non accepté/);
  });

  it("refuse au-delà de 2 Mo", () => {
    expect(validateAvatar({ name: "p.jpg", type: "image/jpeg", size: 2 * 1024 * 1024 + 1 }))
      .toMatch(/2 Mo au maximum/);
    expect(validateAvatar({ name: "p.jpg", type: "image/jpeg", size: 2 * 1024 * 1024 })).toBeNull();
  });

  it("refuse un fichier vide", () => {
    expect(validateAvatar({ name: "p.jpg", type: "image/jpeg", size: 0 })).toBe("Le fichier est vide.");
  });

  it("déduit l'extension du type MIME, jamais du nom", () => {
    expect(avatarExtension("image/png")).toBe("png");
    expect(avatarExtension("image/webp")).toBe("webp");
    expect(avatarExtension("image/gif")).toBe("gif");
    expect(avatarExtension("image/jpeg")).toBe("jpg");
    expect(avatarExtension("n/importe quoi")).toBe("jpg");
  });

  it("préfixe le chemin par l'identifiant — c'est lui que la policy compare", () => {
    expect(avatarPath("11111111-2222-3333-4444-555555555555", "image/png", "abc"))
      .toBe("11111111-2222-3333-4444-555555555555/abc.png");
  });
});

describe("identité affichée", () => {
  it("préfère le nom complet, puis l'adresse", () => {
    expect(displayName({ first_name: "Camille", last_name: "Martin" })).toBe("Camille Martin");
    expect(displayName({ first_name: null, last_name: null, email: "c@x.fr" })).toBe("c@x.fr");
    expect(displayName(null)).toBe("Utilisateur");
  });

  it("se contente d'un seul des deux noms", () => {
    expect(displayName({ first_name: "Camille", last_name: null })).toBe("Camille");
  });

  it("compose les initiales, avec repli sur l'adresse", () => {
    expect(initials({ first_name: "Camille", last_name: "Martin" })).toBe("CM");
    expect(initials({ first_name: "Camille", last_name: null })).toBe("C");
    expect(initials({ first_name: null, last_name: null, email: "zoe@x.fr" })).toBe("Z");
    expect(initials(null)).toBe("U");
  });
});

describe("téléphones et identité", () => {
  const form = (over: Partial<ReturnType<typeof identityFormFrom>> = {}) => ({
    ...identityFormFrom(null), ...over,
  });

  it("accepte le vide : un téléphone n'est pas obligatoire", () => {
    expect(validateIdentityForm(form())).toBeNull();
    expect(validateIdentityForm(form({ landlinePhone: "   " }))).toBeNull();
  });

  it("accepte les formats réels, français comme étrangers", () => {
    for (const n of [
      "0490123456", "04 90 12 34 56", "04.90.12.34.56", "04-90-12-34-56",
      "+33 4 90 12 34 56", "+1 (555) 123-4567", "0490123456 / 0612345678",
    ]) {
      expect(validateIdentityForm(form({ mobilePhone: n }))).toBeNull();
    }
  });

  it("refuse ce qui ne peut PAS être un numéro, et nomme le champ fautif", () => {
    expect(validateIdentityForm(form({ landlinePhone: "poste 42" })))
      .toBe("Téléphone fixe : seuls les chiffres et les séparateurs (+ - . / espace) sont acceptés.");
    expect(validateIdentityForm(form({ mobilePhone: "à venir" })))
      .toBe("Téléphone portable : seuls les chiffres et les séparateurs (+ - . / espace) sont acceptés.");
  });

  it("refuse un numéro visiblement incomplet", () => {
    expect(validateIdentityForm(form({ mobilePhone: "06" })))
      .toBe("Téléphone portable : ce numéro semble incomplet.");
  });

  it("borne la longueur, comme la contrainte SQL", () => {
    expect(validateIdentityForm(form({ landlinePhone: "0".repeat(PHONE_MAX_LENGTH + 1) })))
      .toContain("caractères au maximum");
  });

  it("le fixe est contrôlé avant le portable — l'ordre de la saisie", () => {
    const both = form({ landlinePhone: "abc", mobilePhone: "def" });
    expect(validateIdentityForm(both)).toContain("Téléphone fixe");
  });

  it("rend null plutôt qu'une chaîne vide, et taille les valeurs", () => {
    expect(identityPatch(form({ firstName: "  Camille ", lastName: "", mobilePhone: " 06 12 " })))
      .toEqual({
        first_name: "Camille", last_name: null,
        landline_phone: null, mobile_phone: "06 12",
      });
  });

  it("une espace de plus n'est PAS une modification", () => {
    const profile = { first_name: "Camille", last_name: null, landline_phone: "0490123456", mobile_phone: null };
    expect(identityChanged(profile, identityFormFrom(profile))).toBe(false);
    expect(identityChanged(profile, form({ firstName: " Camille ", landlinePhone: "0490123456 " })))
      .toBe(false);
    expect(identityChanged(profile, form({ firstName: "Camille", landlinePhone: "0490123457" })))
      .toBe(true);
  });

  it("lit un profil incomplet sans trou", () => {
    expect(identityFormFrom(null))
      .toEqual({ firstName: "", lastName: "", landlinePhone: "", mobilePhone: "" });
    expect(identityFormFrom({ first_name: "Alex" }))
      .toEqual({ firstName: "Alex", lastName: "", landlinePhone: "", mobilePhone: "" });
  });
});
