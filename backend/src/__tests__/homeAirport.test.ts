import {
  allHomeAirports,
  applyLegacyEdit,
  applyLegacyMove,
  currentPrimaryAirport,
  homeAirportsAt,
  isHomeAirportAt,
  legacyHistoryOf,
  normalizeHistory,
  periodsFromLegacy,
  primaryAirportAt,
  readStoredPeriods,
  residenceAt,
  sortHistory,
  type HomePeriod,
} from "../utils/homeAirport";
import { findUnconfirmedResidence } from "../services/dataQuality/checks/homeResidence";

const KOELN = { name: "Köln", lat: 50.9375, lon: 6.9603 };
const MUENCHEN = { name: "München", lat: 48.1374, lon: 11.5755 };
const AIRPORTS: Record<string, { lat: number; lon: number; name: string }> = {
  MUC: { lat: 48.3538, lon: 11.7861, name: "Munich" },
  CGN: { lat: 50.8659, lon: 7.1427, name: "Köln" },
};

const periods: HomePeriod[] = [
  {
    fromDate: "2018-01-01",
    toDate: "2024-06-01",
    residence: MUENCHEN,
    residenceConfirmed: true,
    airports: [{ code: "MUC", primary: true }],
  },
  {
    fromDate: "2024-06-01",
    toDate: null,
    residence: KOELN,
    residenceConfirmed: true,
    airports: [
      { code: "CGN", primary: false },
      { code: "DUS", primary: true },
    ],
  },
];

describe("home periods", () => {
  it("answers airport questions by membership, at the date", () => {
    expect([...homeAirportsAt(periods, "2025-01-01")].sort()).toEqual(["CGN", "DUS"]);
    expect(isHomeAirportAt(periods, "2025-01-01", "cgn")).toBe(true);
    expect(isHomeAirportAt(periods, "2020-01-01", "DUS")).toBe(false);
    expect(isHomeAirportAt(periods, "2024-05-31", "MUC")).toBe(true);
    expect(isHomeAirportAt(periods, "2024-06-01", "MUC")).toBe(false);
    expect(homeAirportsAt(periods, "2010-01-01").size).toBe(0);
  });

  it("answers distance questions from the residence", () => {
    expect(residenceAt(periods, "2025-01-01")).toEqual({ lat: KOELN.lat, lon: KOELN.lon });
    expect(residenceAt(periods, "2019-01-01")).toEqual({ lat: MUENCHEN.lat, lon: MUENCHEN.lon });
    expect(residenceAt(periods, "2010-01-01")).toBeNull();
  });

  it("uses the primary for prefills", () => {
    expect(currentPrimaryAirport(periods)).toBe("DUS");
    expect(primaryAirportAt(periods, "2019-01-01")).toBe("MUC");
    expect(currentPrimaryAirport([])).toBeNull();
  });

  it("lists every home airport ever, newest first", () => {
    expect(allHomeAirports(periods)).toEqual(["CGN", "DUS", "MUC"]);
  });

  it("derives the old shape from the primaries", () => {
    expect(legacyHistoryOf(periods)).toEqual([
      { iata: "MUC", fromDate: "2018-01-01", toDate: "2024-06-01" },
      { iata: "DUS", fromDate: "2024-06-01", toDate: null },
    ]);
  });
});

describe("migrating the old shape", () => {
  const legacy = normalizeHistory([
    { iata: "cgn", fromDate: "2020-01-01", toDate: null },
    { iata: "MUC", fromDate: "2015-01-01", toDate: "2020-01-01" },
    { iata: "BAD" },
  ]);

  it("normalizes and sorts the old entries", () => {
    expect(legacy.map((e) => e.iata)).toEqual(["MUC", "CGN"]);
    expect(sortHistory([...legacy].reverse())).toEqual(legacy);
  });

  it("makes one unconfirmed period per entry, residing at its airport", () => {
    const migrated = periodsFromLegacy(legacy, (code) => AIRPORTS[code] ?? null);
    expect(migrated).toEqual([
      {
        fromDate: "2015-01-01",
        toDate: "2020-01-01",
        residence: AIRPORTS.MUC,
        residenceConfirmed: false,
        airports: [{ code: "MUC", primary: true }],
      },
      {
        fromDate: "2020-01-01",
        toDate: null,
        residence: AIRPORTS.CGN,
        residenceConfirmed: false,
        airports: [{ code: "CGN", primary: true }],
      },
    ]);
    // What every distance was measured from before: the airport itself.
    expect(residenceAt(migrated, "2025-01-01")).toEqual({ lat: 50.8659, lon: 7.1427 });
  });

  it("abstains from a residence when the airport is not in the catalogue", () => {
    const [period] = periodsFromLegacy(
      [{ iata: "QQX", fromDate: "2020-01-01", toDate: null }],
      () => null
    );
    expect(period.residence).toBeNull();
    expect(residenceAt([period], "2021-01-01")).toBeNull();
  });
});

describe("reading stored periods", () => {
  it("returns null when the key was never written", () => {
    expect(readStoredPeriods(undefined)).toBeNull();
  });

  it("keeps an explicitly empty list — the user removed every period", () => {
    expect(readStoredPeriods([])).toEqual([]);
  });

  it("drops malformed periods, repairs the primary, and never confirms by default", () => {
    const read = readStoredPeriods([
      {
        fromDate: "2024-06-01",
        toDate: null,
        residence: KOELN,
        airports: [{ code: "cgn" }, { code: "DUS" }],
      },
      { fromDate: "bad", airports: [{ code: "MUC", primary: true }], residence: KOELN },
      {
        fromDate: "2018-01-01",
        toDate: "2024-06-01",
        residence: null,
        residenceConfirmed: true,
        airports: [{ code: "MUC", primary: true }],
      },
    ]);
    expect(read).toEqual([
      {
        fromDate: "2018-01-01",
        toDate: "2024-06-01",
        residence: null,
        residenceConfirmed: false,
        airports: [{ code: "MUC", primary: true }],
      },
      {
        fromDate: "2024-06-01",
        toDate: null,
        residence: KOELN,
        residenceConfirmed: false,
        airports: [
          { code: "CGN", primary: true },
          { code: "DUS", primary: false },
        ],
      },
    ]);
  });
});

describe("old-API writes", () => {
  it("a move closes the running period and opens an unconfirmed one at the airport", () => {
    const after = applyLegacyMove(periods, "muc", "2026-01-01", AIRPORTS.MUC);
    expect(after).toHaveLength(3);
    expect(after[1]).toEqual({ ...periods[1], toDate: "2026-01-01" });
    expect(after[2]).toEqual({
      fromDate: "2026-01-01",
      toDate: null,
      residence: AIRPORTS.MUC,
      residenceConfirmed: false,
      airports: [{ code: "MUC", primary: true }],
    });
  });

  it("a move to the running primary is a no-op", () => {
    expect(applyLegacyMove(periods, "DUS", "2026-01-01", null)).toEqual(periods);
  });

  it("an edited iata promotes a member, or replaces the primary; a confirmed residence stays", () => {
    const promoted = applyLegacyEdit(periods[1], { iata: "CGN" }, AIRPORTS.CGN);
    expect(promoted.airports).toEqual([
      { code: "CGN", primary: true },
      { code: "DUS", primary: false },
    ]);
    expect(promoted.residence).toEqual(KOELN);
    const replaced = applyLegacyEdit(periods[1], { iata: "NRN", toDate: "2027-01-01" }, null);
    expect(replaced.airports).toEqual([
      { code: "CGN", primary: false },
      { code: "NRN", primary: true },
    ]);
    expect(replaced.toDate).toBe("2027-01-01");
    expect(replaced.residence).toEqual(KOELN);
  });

  it("an unconfirmed residence follows its airport", () => {
    const [migrated] = periodsFromLegacy(
      [{ iata: "CGN", fromDate: "2020-01-01", toDate: null }],
      (c) => AIRPORTS[c] ?? null
    );
    expect(applyLegacyEdit(migrated, { iata: "MUC" }, AIRPORTS.MUC).residence).toEqual(
      AIRPORTS.MUC
    );
  });
});

describe("the inbox question", () => {
  it("is asked once per account while any period is unconfirmed", () => {
    const migrated = periodsFromLegacy(
      [
        { iata: "MUC", fromDate: "2015-01-01", toDate: "2020-01-01" },
        { iata: "CGN", fromDate: "2020-01-01", toDate: null },
      ],
      (c) => AIRPORTS[c] ?? null
    );
    expect(findUnconfirmedResidence(migrated)).toEqual([
      {
        entityType: "home",
        entityId: "residence",
        kind: "home_residence_unconfirmed",
        details: { airports: ["MUC", "CGN"], periods: 2 },
      },
    ]);
    expect(findUnconfirmedResidence(periods)).toEqual([]);
    expect(findUnconfirmedResidence([])).toEqual([]);
  });
});
