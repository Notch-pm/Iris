import { describe, expect, it } from "vitest";
import type { SocleContact } from "@/features/contacts/rapprochement";
import {
  buildGroups, flattenResults, isSearchable, moveIndex, normalizeQuery,
  toRequestResult, toUsagerResult, type RequestSearchRow,
} from "./search";

function hit(partial: Partial<RequestSearchRow> = {}): RequestSearchRow {
  return {
    request_id: "r1",
    request_reference: "DEM-2026-000042",
    request_subject: "Nid-de-poule avenue de la Gare",
    request_status: "en_instruction",
    request_received_at: "2026-08-12T09:30:00Z",
    request_assigned_to: null,
    request_organisme: "Direction de la voirie",
    ...partial,
  };
}

function contact(partial: Partial<SocleContact> = {}): SocleContact {
  return {
    id: "c1", contact_type: "personne", status: "active", display_name: null, civility: null,
    first_name: "Marie", last_name: "Dupont", usage_name: null, birth_date: null, legal_name: null,
    siret: null, email: null, mobile_phone: null, landline_phone: null, preferred_channel: null,
    address_line1: null, address_line2: null, postal_code: null, city: "Aix-en-Provence",
    country: null, quartier: null,
    ...partial,
  };
}

const nameOf = (userId: string) => (userId === "u1" ? "Claire Martin" : "Utilisateur");

describe("saisie", () => {
  it("taille la saisie et recolle les espaces internes", () => {
    expect(normalizeQuery("  nid   de   poule ")).toBe("nid de poule");
  });

  it("ne cherche qu'à partir de trois caractères, espaces exclus", () => {
    expect(isSearchable("ni")).toBe(false);
    expect(isSearchable("  n  ")).toBe(false);
    expect(isSearchable("nid")).toBe(true);
  });
});

// La normalisation (accents, casse) et l'échappement des métacaractères de
// LIKE vivent dans la RPC `search_requests` — c'est le seul endroit d'où les
// deux côtés de la comparaison sont vus. Rien à tester ici : la saisie part
// telle quelle. La garde des 3 caractères, elle, a un jumeau SQL
// (`char_length(btrim(coalesce(p_query,''))) >= 3`).

describe("résultats", () => {
  it("une demande porte ses six informations, statut traduit et date française", () => {
    expect(toRequestResult(hit({ request_assigned_to: "u1" }), nameOf)).toEqual({
      kind: "demande",
      id: "r1",
      href: "/demandes/r1",
      reference: "DEM-2026-000042",
      subject: "Nid-de-poule avenue de la Gare",
      status: "en_instruction",
      statusLabel: "En cours d'instruction",
      receivedAt: "12/08/2026",
      agent: "Claire Martin",
      organisme: "Direction de la voirie",
    });
  });

  it("sans instructeur ni organisme, les mots d'écran de la maison", () => {
    const result = toRequestResult(
      hit({ request_assigned_to: null, request_organisme: "  " }),
      nameOf,
    );
    expect(result.agent).toBe("Non affectée");
    expect(result.organisme).toBe("—");
  });

  it("un usager porte son nom composé et la ville de son adresse", () => {
    expect(toUsagerResult(contact())).toEqual({
      kind: "usager",
      id: "c1",
      href: "/usagers/c1",
      name: "Marie Dupont",
      city: "Aix-en-Provence",
    });
    expect(toUsagerResult(contact({ city: null })).city).toBe("");
  });
});

describe("groupes", () => {
  it("demandes d'abord, usagers ensuite", () => {
    const groups = buildGroups([hit()], [contact()], nameOf);
    expect(groups.map((g) => g.key)).toEqual(["demandes", "usagers"]);
  });

  it("un groupe vide n'apparaît pas", () => {
    expect(buildGroups([], [contact()], nameOf).map((g) => g.key)).toEqual(["usagers"]);
    expect(buildGroups([hit()], [], nameOf).map((g) => g.key)).toEqual(["demandes"]);
    expect(buildGroups([], [], nameOf)).toEqual([]);
  });

  it("le parcours clavier met les groupes bout à bout", () => {
    const flat = flattenResults(buildGroups([hit()], [contact()], nameOf));
    expect(flat.map((r) => r.kind)).toEqual(["demande", "usager"]);
  });
});

describe("clavier", () => {
  it("↑ ↓ tournent en boucle, et une liste vide reste sur 0", () => {
    expect(moveIndex(0, 1, 3)).toBe(1);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(0, 1, 0)).toBe(0);
  });
});
