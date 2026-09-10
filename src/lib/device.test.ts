import { describe, expect, it } from "vitest";
import { DEVICE_MODE_LABELS, parseOverride, resolveDevice, switchTarget } from "./device";

describe("resolveDevice", () => {
  it("bascule sur mobile sous 768 px, bureau au-dessus (tablette comprise)", () => {
    expect(resolveDevice({ viewportNarrow: true, override: null })).toBe("mobile");
    expect(resolveDevice({ viewportNarrow: false, override: null })).toBe("desktop");
  });

  it("le commutateur PRIME sur la largeur, dans les deux sens", () => {
    expect(resolveDevice({ viewportNarrow: true, override: "desktop" })).toBe("desktop");
    expect(resolveDevice({ viewportNarrow: false, override: "mobile" })).toBe("mobile");
  });
});

describe("parseOverride", () => {
  it("ne retient que les deux valeurs connues", () => {
    expect(parseOverride("mobile")).toBe("mobile");
    expect(parseOverride("desktop")).toBe("desktop");
    expect(parseOverride("tablette")).toBeNull();
    expect(parseOverride("")).toBeNull();
    expect(parseOverride(null)).toBeNull();
    expect(parseOverride(undefined)).toBeNull();
  });
});

describe("switchTarget / libellés", () => {
  it("propose toujours l'autre version", () => {
    expect(switchTarget("mobile")).toBe("desktop");
    expect(switchTarget("desktop")).toBe("mobile");
    expect(DEVICE_MODE_LABELS[switchTarget("mobile")]).toBe("Version bureau");
  });
});
