import { describe, expect, it } from "vitest";
import { appUrl, CURRENT_APP, CURRENT_APP_KEY, EDILUMEN_APPS } from "./apps";

describe("gamme Edilumen", () => {
  it("bâtit l'adresse de chaque application sur le même motif", () => {
    expect(appUrl("iris")).toBe("https://iris.edilumen.fr");
    expect(appUrl("clara")).toBe("https://clara.edilumen.fr");
    expect(appUrl("socle")).toBe("https://socle.edilumen.fr");
    expect(appUrl("ariane")).toBe("https://ariane.edilumen.fr");
  });

  it("propose les quatre applications, chacune avec son initiale", () => {
    expect(EDILUMEN_APPS.map((a) => a.key)).toEqual(["socle", "iris", "clara", "ariane"]);
    for (const app of EDILUMEN_APPS) expect(app.initial).toBe(app.name[0]);
  });

  it("sait qu'elle est Iris", () => {
    expect(CURRENT_APP_KEY).toBe("iris");
    expect(CURRENT_APP.name).toBe("Iris");
  });
});
