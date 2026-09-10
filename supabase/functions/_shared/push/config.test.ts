import { describe, expect, it } from "vitest";
import { readVapid } from "./config.ts";

const ok = { VAPID_PUBLIC_KEY: " pub ", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:iris@exemple.fr" };

describe("readVapid", () => {
  it("lit et nettoie les trois secrets", () => {
    expect(readVapid(ok)).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:iris@exemple.fr" });
  });

  it("accepte un sujet https", () => {
    expect(readVapid({ ...ok, VAPID_SUBJECT: "https://iris.exemple.fr" })?.subject).toBe("https://iris.exemple.fr");
  });

  it("une clé absente ou vide ⇒ null", () => {
    expect(readVapid({ ...ok, VAPID_PRIVATE_KEY: "" })).toBeNull();
    expect(readVapid({ ...ok, VAPID_PUBLIC_KEY: undefined })).toBeNull();
    expect(readVapid({})).toBeNull();
  });

  it("un sujet qui n'est ni mailto: ni https: ⇒ null (le service de push le refuserait)", () => {
    expect(readVapid({ ...ok, VAPID_SUBJECT: "iris@exemple.fr" })).toBeNull();
    expect(readVapid({ ...ok, VAPID_SUBJECT: "" })).toBeNull();
  });
});
