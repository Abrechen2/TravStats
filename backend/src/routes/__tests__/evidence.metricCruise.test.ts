import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  assertDistinctInvariant,
  assertSumInvariant,
} from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence for the ten served cruise-tab measures (task-7b-3-brief.md).
 *
 * WHAT THE CROSS-CHECK AT THE BOTTOM DOES AND DOES NOT BIND, stated plainly
 * because a reader who assumes otherwise will write a weaker test on the
 * strength of it. It fetches `GET /stats/cruise` — the endpoint the tab
 * renders — in the same run and requires every rollup measure to equal the
 * figure that endpoint returns. Both sides deliberately call the SAME
 * `loadCruiseStatsData` and the SAME `calculateCruiseStats`, which is the
 * whole point of the extraction, so the two numbers are one number read
 * twice: a wrong POPULATION moves both together and passes. Measured, by
 * dropping `countableCruiseWhere()` from the loader: every literal below
 * failed and the cross-check stayed green.
 *
 * What it therefore binds is ARGUMENT drift — a year window that stops being
 * passed, a base currency read differently — which is the same limit
 * `invariants.ts` already records for the `year*` flight family. The
 * POPULATION rests on the per-key literals, which is why each of them names a
 * cruise rather than a number.
 *
 * `cruiseTotalSpend` and `cruiseCompanionCount` are absent from the
 * cross-check on purpose: neither figure exists on `/stats/cruise` at all —
 * the first is a base-currency total the client fold refuses to compute, the
 * second is the total of a ranked list. Their literals stand alone and say so.
 *
 * The fixture, all of it user A's:
 *   - MEIN SCHIFF (ship 1, line AIDA), 1–5 March 2024: Hamburg, a sea day,
 *     Oslo, an UNRESOLVED port call, Hamburg again. Priced 1000 EUR with an
 *     EUR snapshot. Two companions.
 *   - NORDLICHT (ship 2, line TUI), 10–12 January 2025: Kiel, Oslo. Priced
 *     500 USD with NO snapshot — real money nothing can convert. One
 *     companion, who also came on the first.
 *   - COSTA FORTUNA, booked for June 2027 and still `scheduled`, with one
 *     companion. It appears in nothing EXCEPT `cruiseCompanionCount`, whose
 *     calculator is the cruise LIST rather than the rollup — see that test.
 */
describe("GET /api/v1/evidence/metric/... — the cruise tab", () => {
  let userId: string;
  let cookie: string;
  let cruise2024: string;
  let cruise2025: string;
  let cruiseBooked: string;
  let hamburgId: number;
  let osloId: number;
  let kielId: number;
  let shipAId: number;
  let shipBId: number;

  const UNLOCODES = ["DEHAM-EVID", "NOOSL-EVID", "DEKEL-EVID"];

  interface EvidenceBody {
    measure: { value: number | null; unit: string; aggregation: string };
    entries: Array<{
      id: string;
      domain: string;
      href: string | null;
      credits?: string[];
      creditLabels?: Record<string, string>;
      contribution?: number;
      subtitle?: { key: string; values?: Record<string, string | number> } | null;
    }>;
    omitted: { count: number; contribution?: number; credits?: number };
    unattributed: Array<{ count: number; reason: string }>;
  }

  const KEYS = [
    "cruiseCount",
    "cruiseDistanceKmTotal",
    "cruiseSeaDaysTotal",
    "cruiseTotalDays",
    "cruisePortsUniqueCount",
    "cruiseShipsUniqueCount",
    "cruiseLinesUniqueCount",
    "cruiseCountriesCount",
    "cruiseCompanionCount",
    "cruiseTotalSpend",
  ] as const;

  const lifetime = new Map<string, EvidenceBody>();
  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
  const answer = (key: (typeof KEYS)[number]): EvidenceBody => lifetime.get(key)!;

  /**
   * The figures `/stats/cruise` renders, for the cross-check. Only the eight
   * this suite compares against are declared — a wider shape would be a second
   * copy of that response's contract kept in a test.
   */
  interface CruiseTabStats {
    cruisesCount: number;
    totalDistanceKm: number;
    seaDays: number;
    totalCruiseDays: number;
    cruisePortsUnique: number;
    cruiseShipsUnique: number;
    cruiseLinesUnique: number;
    countriesIso: string[];
  }
  let cruiseStats: CruiseTabStats;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencecruise" } });
    await prisma.port.deleteMany({ where: { unlocode: { in: UNLOCODES } } });
    await prisma.ship.deleteMany({ where: { imo: { in: ["IMO-EVID-1", "IMO-EVID-2"] } } });

    const user = await prisma.user.create({
      data: { username: "evidencecruise", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const [hamburg, oslo, kiel] = await Promise.all([
      prisma.port.create({
        data: {
          name: "Hamburg",
          city: "Hamburg",
          country: "Germany",
          unlocode: UNLOCODES[0],
          lat: 53.5511,
          lon: 9.9937,
          region: "north_sea",
          isUserAdded: true,
        },
      }),
      prisma.port.create({
        data: {
          name: "Oslo",
          city: "Oslo",
          country: "Norway",
          unlocode: UNLOCODES[1],
          lat: 59.9139,
          lon: 10.7522,
          region: "baltic",
          isUserAdded: true,
        },
      }),
      prisma.port.create({
        data: {
          name: "Kiel",
          city: "Kiel",
          country: "Germany",
          unlocode: UNLOCODES[2],
          lat: 54.3233,
          lon: 10.1228,
          region: "baltic",
          isUserAdded: true,
        },
      }),
    ]);
    hamburgId = hamburg.id;
    osloId = oslo.id;
    kielId = kiel.id;

    const [shipA, shipB] = await Promise.all([
      prisma.ship.create({
        data: { name: "Mein Schiff", imo: "IMO-EVID-1", cruiseLine: "AIDA", isUserAdded: true },
      }),
      prisma.ship.create({
        data: { name: "Nordlicht", imo: "IMO-EVID-2", cruiseLine: "TUI", isUserAdded: true },
      }),
    ]);

    shipAId = shipA.id;
    shipBId = shipB.id;

    const first = await prisma.cruise.create({
      data: {
        userId,
        status: "flown",
        routeName: "Nordland",
        shipId: shipA.id,
        cruiseLine: "AIDA",
        deck: 9,
        cabinType: "balcony",
        companions: ["Anna", "Ben"],
        price: 1000,
        currency: "EUR",
        priceBase: 1000,
        fxBaseCurrency: "EUR",
        startDate: day("2024-03-01"),
        endDate: day("2024-03-05"),
        stops: {
          create: [
            { dayNumber: 1, portId: hamburgId, isAtSea: false },
            { dayNumber: 2, isAtSea: true },
            { dayNumber: 3, portId: osloId, isAtSea: false },
            // The third state of the cruise-stop invariant: a real port call
            // whose imported name matched no catalogue entry.
            { dayNumber: 4, isAtSea: false, unresolvedPortName: "Geirangerfjord" },
            { dayNumber: 5, portId: hamburgId, isAtSea: false },
          ],
        },
      },
    });
    cruise2024 = first.id;

    const second = await prisma.cruise.create({
      data: {
        userId,
        status: "flown",
        routeName: "Ostsee kurz",
        shipId: shipB.id,
        cruiseLine: "TUI",
        companions: ["Anna"],
        // Priced, and nothing converted it — the stored amount is real and
        // belongs on screen, but it cannot join a base-currency sum.
        price: 500,
        currency: "USD",
        startDate: day("2025-01-10"),
        endDate: day("2025-01-12"),
        stops: {
          create: [
            { dayNumber: 1, portId: kielId, isAtSea: false },
            { dayNumber: 2, portId: osloId, isAtSea: false },
          ],
        },
      },
    });
    cruise2025 = second.id;

    const booked = await prisma.cruise.create({
      data: {
        userId,
        status: "scheduled",
        routeName: "Costa Fortuna",
        cruiseLine: "Costa",
        companions: ["Chris"],
        price: 9000,
        currency: "EUR",
        priceBase: 9000,
        fxBaseCurrency: "EUR",
        startDate: day("2027-06-01"),
        endDate: day("2027-06-08"),
        stops: { create: [{ dayNumber: 1, portId: hamburgId, isAtSea: false }] },
      },
    });
    cruiseBooked = booked.id;

    for (const key of KEYS) {
      const res = await request(app).get(`/api/v1/evidence/metric/${key}`).set("Cookie", cookie);
      expect([key, res.status]).toEqual([key, 200]);
      lifetime.set(key, res.body as EvidenceBody);
    }

    const tab = await request(app).get("/api/v1/stats/cruise").set("Cookie", cookie);
    expect(tab.status).toBe(200);
    cruiseStats = tab.body as CruiseTabStats;
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.port.deleteMany({ where: { unlocode: { in: UNLOCODES } } });
    await prisma.ship.deleteMany({ where: { imo: { in: ["IMO-EVID-1", "IMO-EVID-2"] } } });
  });

  it("cruiseCount: the two that sailed, and not the one that is only booked", () => {
    const res = answer("cruiseCount");
    expect(res.measure.value).toBe(2);
    expect(res.entries.map((e) => e.id).sort()).toEqual([cruise2024, cruise2025].sort());
    expect(res.entries.every((e) => e.contribution === 1)).toBe(true);
    expect(res.entries.every((e) => e.domain === "cruise")).toBe(true);
    expect(res.entries.map((e) => e.href)).toContain(`/cruises/${cruise2024}`);
    assertSumInvariant(res, Math.round);
  });

  it("cruiseSeaDaysTotal: the one sea day, credited to the cruise that had it", () => {
    const res = answer("cruiseSeaDaysTotal");
    expect(res.measure.value).toBe(1);
    expect(res.entries.find((e) => e.id === cruise2024)!.contribution).toBe(1);
    expect(res.entries.find((e) => e.id === cruise2025)!.contribution).toBe(0);
    assertSumInvariant(res, Math.round);
  });

  /** 1–5 March is five days, 10–12 January is three: the count is inclusive. */
  it("cruiseTotalDays: both ends counted, eight days over two cruises", () => {
    const res = answer("cruiseTotalDays");
    expect(res.measure.value).toBe(8);
    expect(res.entries.find((e) => e.id === cruise2024)!.contribution).toBe(5);
    expect(res.entries.find((e) => e.id === cruise2025)!.contribution).toBe(3);
    assertSumInvariant(res, Math.round);
  });

  /**
   * Hamburg, Oslo, Kiel. The Hamburg call happens TWICE on the first cruise
   * and once more on the scheduled one, and the unresolved Geirangerfjord
   * call is a port call with no catalogue id — a row count would say five.
   */
  it("cruisePortsUniqueCount: three ports, one of them called at three times", () => {
    const res = answer("cruisePortsUniqueCount");
    expect(res.measure.value).toBe(3);
    expect(res.measure.aggregation).toBe("distinct");
    const first = res.entries.find((e) => e.id === cruise2024)!;
    expect([...first.credits!].sort()).toEqual([String(hamburgId), String(osloId)].sort());
    const second = res.entries.find((e) => e.id === cruise2025)!;
    expect([...second.credits!].sort()).toEqual([String(kielId), String(osloId)].sort());
    assertDistinctInvariant(res);
  });

  it("cruiseShipsUniqueCount: one ship each, two in all", () => {
    const res = answer("cruiseShipsUniqueCount");
    expect(res.measure.value).toBe(2);
    expect(res.entries.every((e) => (e.credits ?? []).length === 1)).toBe(true);
    assertDistinctInvariant(res);
  });

  /**
   * A port and a ship credit is a CATALOGUE ID, which is what makes two
   * cruises calling at Hamburg count it once — and an id is not a word. The
   * panel printed "belegt: 12" until 2026-09-19, so each row carries the name
   * its own credits resolve to.
   */
  it("port and ship credits carry the catalogue NAME beside the id", () => {
    const ports = answer("cruisePortsUniqueCount");
    const first = ports.entries.find((e) => e.id === cruise2024)!;
    expect(first.creditLabels![String(hamburgId)]).toBe("Hamburg");
    expect(first.creditLabels![String(osloId)]).toBe("Oslo");
    const second = ports.entries.find((e) => e.id === cruise2025)!;
    expect(second.creditLabels![String(kielId)]).toBe("Kiel");
    // Every credited key has a label; none of them reaches a reader bare.
    for (const entry of ports.entries) {
      for (const credit of entry.credits ?? []) {
        expect([credit, entry.creditLabels?.[credit]]).not.toEqual([credit, undefined]);
      }
    }

    const ships = answer("cruiseShipsUniqueCount");
    expect(ships.entries.find((e) => e.id === cruise2024)!.creditLabels).toEqual({
      [String(shipAId)]: "Mein Schiff",
    });
    expect(ships.entries.find((e) => e.id === cruise2025)!.creditLabels).toEqual({
      [String(shipBId)]: "Nordlicht",
    });
  });

  /**
   * The other half of the rule: a credit that IS a word gets no label, and the
   * frontend then renders the key. A lookup table for "AIDA" or "DE" would be
   * a second opinion about what they are called.
   */
  it("a line and a country credit carry no label — they are already words", () => {
    for (const key of ["cruiseLinesUniqueCount", "cruiseCountriesCount"] as const) {
      for (const entry of answer(key).entries) {
        expect([key, entry.creditLabels]).toEqual([key, undefined]);
      }
    }
  });

  it("cruiseLinesUniqueCount: AIDA and TUI — Costa never sailed", () => {
    const res = answer("cruiseLinesUniqueCount");
    expect(res.measure.value).toBe(2);
    const lines = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...lines].sort()).toEqual(["AIDA", "TUI"]);
    assertDistinctInvariant(res);
  });

  /**
   * Germany and Norway. Both cruises prove Germany — Hamburg on one, Kiel on
   * the other — and the credits are ISO codes because that is what the tile
   * counts: the catalogue carries country NAMES, and counting those made
   * "United States" and "United States of America" two countries.
   */
  it("cruiseCountriesCount: two countries, each proved by both cruises", () => {
    const res = answer("cruiseCountriesCount");
    expect(res.measure.value).toBe(2);
    const credited = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...credited].sort()).toEqual(["DE", "NO"]);
    expect([...res.entries.find((e) => e.id === cruise2024)!.credits!].sort()).toEqual([
      "DE",
      "NO",
    ]);
    assertDistinctInvariant(res);
  });

  /**
   * Four companion slots over THREE cruises — including the one that has not
   * sailed. This is the only measure in the family that ignores the countable
   * filter, and it has to: its calculator is `deriveCruiseStats` over
   * `cruiseApi.list()`, and `GET /cruises` applies no status filter, so the
   * ranked companion bars on that tab already include a booked cruise's
   * companions. A panel that named fewer people than the bar it explains would
   * be the disagreement the panel exists to prevent.
   *
   * Anna came on two and is two of the four slots — the same arithmetic
   * `CruiseFunSection` draws as one bar reading "2", not a distinct count of
   * people.
   */
  it("cruiseCompanionCount: Anna twice, Ben once, and Chris on a cruise that has not sailed", () => {
    const res = answer("cruiseCompanionCount");
    expect(res.measure.value).toBe(4);
    expect(res.entries.find((e) => e.id === cruise2024)!.contribution).toBe(2);
    expect(res.entries.find((e) => e.id === cruise2025)!.contribution).toBe(1);
    expect(res.entries.find((e) => e.id === cruiseBooked)!.contribution).toBe(1);
    // The same fixture is invisible to every OTHER measure in this suite.
    expect(answer("cruiseCount").entries.map((e) => e.id)).not.toContain(cruiseBooked);
    assertSumInvariant(res, Math.round);
  });

  /**
   * 1000 EUR, and the 500 USD stays out. The unconvertible cruise is still
   * LISTED, contributing nothing and carrying a subtitle that names the
   * amount — dropping it would hide real money, and putting it in
   * `unattributed` would add a count of CRUISES to a total of MONEY.
   */
  it("cruiseTotalSpend: the euro cruise only, with the dollar one shown at zero", () => {
    const res = answer("cruiseTotalSpend");
    expect(res.measure.value).toBe(1000);
    expect(res.measure.unit).toBe("currency");
    expect(res.entries.find((e) => e.id === cruise2024)!.contribution).toBe(1000);
    const unconverted = res.entries.find((e) => e.id === cruise2025)!;
    expect(unconverted.contribution).toBe(0);
    expect(unconverted.subtitle).toEqual({
      key: "evidence.subtitle.notConverted",
      values: { amount: 500, currency: "USD" },
    });
    assertSumInvariant(res, (n) => Math.round(n * 100) / 100);
  });

  /** A year is a population, and the 2025 cruise is not in 2024's. */
  it("narrows to the year the cruise STARTED in", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/cruiseCount")
      .query({ period: "year", year: 2024 })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    expect(res.body.entries.map((e: { id: string }) => e.id)).toEqual([cruise2024]);

    const ports = await request(app)
      .get("/api/v1/evidence/metric/cruisePortsUniqueCount")
      .query({ period: "year", year: 2025 })
      .set("Cookie", cookie);
    expect(ports.status).toBe(200);
    expect(ports.body.measure.value).toBe(2);
  });

  it("answers 400 for a rolling window the tab cannot show", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/cruiseSeaDaysTotal")
      .query({ period: "rolling12m" })
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  /**
   * The population guard. `/stats/cruise` is what the tab renders; a resolver
   * that widened its predicate (the scheduled cruise), dropped the year window
   * or read a different accumulator would diverge here and nowhere else.
   */
  it("all eight rollup measures equal the numbers /stats/cruise renders", () => {
    const pairs: Array<[(typeof KEYS)[number], number]> = [
      ["cruiseCount", cruiseStats.cruisesCount],
      ["cruiseDistanceKmTotal", cruiseStats.totalDistanceKm],
      ["cruiseSeaDaysTotal", cruiseStats.seaDays],
      ["cruiseTotalDays", cruiseStats.totalCruiseDays],
      ["cruisePortsUniqueCount", cruiseStats.cruisePortsUnique],
      ["cruiseShipsUniqueCount", cruiseStats.cruiseShipsUnique],
      ["cruiseLinesUniqueCount", cruiseStats.cruiseLinesUnique],
      // The tab counts the ISO-FOLDED set, not the raw catalogue names.
      ["cruiseCountriesCount", cruiseStats.countriesIso.length],
    ];
    for (const [key, rendered] of pairs) {
      // The key rides in the assertion so a failure names WHICH measure
      // diverged rather than printing two bare numbers.
      expect([key, answer(key).measure.value]).toEqual([key, rendered]);
    }
  });

  /**
   * The fixture's own legs, to the kilometre. Hamburg→Oslo is 709.01 km and the
   * first cruise sails it TWICE (out via Oslo, back to Hamburg); Kiel→Oslo is
   * 622.80 km. 2 × 709.01 + 622.80 = 2040.82, which the surface rounds to 2041.
   *
   * The figures are what the great-circle distance between those catalogue
   * coordinates IS, measured once and written down — not recomputed here,
   * which would be the rule copied into its own test.
   *
   * What the literals pin is which legs exist: the unresolved port call has no
   * coordinates and moves the ship nowhere, and the sea day sits INSIDE the
   * leg between the ports either side of it rather than adding one. A resolver
   * that counted either would come out higher.
   */
  it("cruiseDistanceKmTotal: two Hamburg-Oslo legs and one Kiel-Oslo, and nothing else", () => {
    const res = answer("cruiseDistanceKmTotal");
    expect(res.measure.value).toBe(2041);
    expect(res.entries.find((e) => e.id === cruise2024)!.contribution).toBeCloseTo(1418.02, 1);
    expect(res.entries.find((e) => e.id === cruise2025)!.contribution).toBeCloseTo(622.8, 1);
    assertSumInvariant(res, Math.round);
  });
});
