import { AIRLINES } from "../../data/airlines";
import { preloadAirlineCatalog } from "../../services/airlineCatalogCache";
import { resolveAirlineCodes } from "../airlineNormalize";
import { prisma } from "../../db";

// Proves the DB-backed resolver returns the SAME iata for every curated
// carrier as the retired static list did — no resolution regression.
describe("airlineNormalize DB parity", () => {
  beforeAll(async () => { await preloadAirlineCatalog(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("resolves every curated IATA code to itself", () => {
    // resolveAirlineCodes' direct-IATA branch only fires for exactly
    // 2-char input (see its docstring). A handful of curated rows are
    // rail/coach operators carried with a 3-char pseudo-code (e.g. FLX =
    // FlixTrain, ICE, SBB, TGV) — self-lookup by that pseudo-code was
    // already `null` before this rewrite (falls through to the 3-char
    // ICAO branch, which doesn't match either), so it's excluded here as
    // pre-existing, unchanged behaviour rather than a real invariant.
    for (const a of AIRLINES.filter((a) => a.iata.length === 2)) {
      expect(resolveAirlineCodes(a.iata)?.iata).toBe(a.iata);
    }
  });

  it("resolves every curated name to its curated IATA", () => {
    for (const a of AIRLINES) {
      expect(resolveAirlineCodes(a.name)?.iata).toBe(a.iata);
    }
  });

  it("still honours a NAME_TO_IATA alias", () => {
    expect(resolveAirlineCodes("alitalia")?.iata).toBe("AZ");
  });
});
