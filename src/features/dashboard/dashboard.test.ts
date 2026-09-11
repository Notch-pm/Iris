import { describe, expect, it } from "vitest";
import {
  formatVariation,
  monthKeyOf,
  monthLongLabel,
  pickMonthPair,
  previousMonthKey,
  variation,
} from "./dashboard";

describe("clés de mois", () => {
  it("formate la clé et recule d'un mois, année comprise", () => {
    expect(monthKeyOf(new Date(2026, 8, 19))).toBe("2026-09");
    expect(previousMonthKey("2026-09")).toBe("2026-08");
    expect(previousMonthKey("2026-01")).toBe("2025-12");
  });
  it("libelle le mois en toutes lettres", () => {
    expect(monthLongLabel("2026-09")).toBe("septembre 2026");
    expect(monthLongLabel("n/a")).toBe("n/a");
  });
});

describe("pickMonthPair", () => {
  const now = new Date(2026, 8, 19);
  it("retient le mois courant et le précédent, compteurs convertis en nombres", () => {
    const pair = pickMonthPair(
      [
        { month_key: "2026-08", received_count: "12" as unknown as number, instruction_count: 5, resolved_count: 3 },
        { month_key: "2026-09", received_count: 20, instruction_count: 9, resolved_count: 4 },
      ],
      now,
    );
    expect(pair.current.received_count).toBe(20);
    expect(pair.previous.received_count).toBe(12);
    expect(pair.previous.month_key).toBe("2026-08");
  });
  it("met à zéro un mois absent plutôt que de casser l'écran", () => {
    const pair = pickMonthPair([], now);
    expect(pair.current).toEqual({ month_key: "2026-09", received_count: 0, instruction_count: 0, resolved_count: 0 });
    expect(pair.previous.month_key).toBe("2026-08");
  });
});

describe("variation", () => {
  it("calcule la variation relative et la formate", () => {
    expect(variation(15, 12)).toBeCloseTo(0.25);
    expect(formatVariation(variation(15, 12))).toBe("+25 %");
    expect(formatVariation(variation(9, 10))).toBe("−10 %");
    expect(formatVariation(variation(10, 10))).toBe("=");
  });
  it("n'invente pas de pourcentage sans base", () => {
    expect(variation(5, 0)).toBeNull();
    expect(formatVariation(null)).toBe("—");
  });
});
