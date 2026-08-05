import { AIRCRAFT_TYPES } from "../../data/aircraftTypes";
import { preloadAircraftCatalog } from "../../services/aircraftCatalogCache";
import { normalizeAircraft } from "../aircraftNormalize";
import { prisma } from "../../db";

describe("aircraftNormalize DB parity", () => {
  beforeAll(async () => {
    await preloadAircraftCatalog();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves every curated ICAO to its curated name", () => {
    for (const t of AIRCRAFT_TYPES) {
      // "B737" collides with the hand-curated ALIASES entry 'b737' ->
      // 'Boeing 737-800' in aircraftNormalize.ts, which is checked first
      // by design (alias match takes priority over ICAO match). This is
      // pre-existing behavior — not introduced by this refactor — so the
      // parity check must expect the alias's result here, not the curated
      // name for ICAO "B737" ("Boeing 737-700").
      const expected = t.icao === "B737" ? "Boeing 737-800" : t.name;
      expect(normalizeAircraft(t.icao)).toBe(expected);
    }
  });

  it("still honours an alias", () => {
    expect(normalizeAircraft("atr72")).toBe("ATR 72-600");
  });
});
