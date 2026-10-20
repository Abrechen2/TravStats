import { buildPassport, type PassportFlight } from "../passport";
import { applyCountryOverrides, type CountryOverrideInput } from "../countryOverrides";
import { summarizePassport } from "../passportSummary";

/**
 * forgejo#308: the user's own verdict on a passport country, applied after the
 * automatic fold. Each test names the rule; the totals are always asserted
 * against a recount of the rows, so a verdict can never move a row without
 * moving the number above it.
 */

const NOW = new Date("2026-10-16T12:00:00Z");
const THIS_YEAR = 2026;
const AIRPORTS = new Map<string, string | null>([
  ["MUC", "DE"],
  ["DOH", "QA"],
  ["HAN", "VN"],
  ["BKK", "TH"],
  ["PNH", "KH"],
]);

const flight = (dep: string, arr: string, day: string): PassportFlight => ({
  depIata: dep,
  arrIata: arr,
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 0,
  departureTime: new Date(`${day}T10:00:00Z`),
  localDay: day,
  status: "flown",
});

const automatic = (flights: PassportFlight[]) =>
  buildPassport(flights, AIRPORTS, [], NOW, [], [], [], undefined, [], [], [], "UTC", [], ["DE"]);

/** MUC -> BKK, PNH -> MUC: Thailand and Cambodia are unclear. */
const OPEN_JAW = [flight("MUC", "BKK", "2024-02-01"), flight("PNH", "MUC", "2024-02-20")];
/** MUC -> DOH -> HAN and back: Vietnam visited, Qatar a connection. */
const DOHA_HANOI = [
  flight("MUC", "DOH", "2025-01-01"),
  flight("DOH", "HAN", "2025-01-02"),
  flight("HAN", "DOH", "2025-01-20"),
  flight("DOH", "MUC", "2025-01-21"),
];

const override = (
  countryCode: string,
  verdict: CountryOverrideInput["verdict"],
  day: string | null = null
): CountryOverrideInput => ({ countryCode, verdict, note: `note for ${countryCode}`, day });

const row = (p: ReturnType<typeof buildPassport>, code: string) =>
  p.countries.find((c) => c.code === code);

/** The totals must be exactly what the shared summary says of the rows. */
const expectRecounted = (p: ReturnType<typeof buildPassport>): void => {
  const recount = summarizePassport(p.countries, p.stamps.length);
  expect(p.summary).toEqual(recount.summary);
  expect(p.continents).toEqual(recount.continents);
  const byEvidence = Object.values(p.summary.byEvidence).reduce((a, b) => a + b, 0);
  expect(byEvidence).toBe(p.summary.countriesTotal);
};

describe("forgejo#308: country overrides", () => {
  it("changes nothing when the user has no override", () => {
    const base = automatic(OPEN_JAW);
    expect(applyCountryOverrides(base, [], THIS_YEAR)).toBe(base);
    expect(base.countries.every((c) => c.override === null)).toBe(true);
    expect(base.excludedCountries).toEqual([]);
  });

  it("visited lifts an unclear row into both sets and keeps its real evidence kind", () => {
    const base = automatic(OPEN_JAW);
    expect(row(base, "TH")).toMatchObject({ visited: false, visitUncertain: true });

    const p = applyCountryOverrides(base, [override("TH", "visited")], THIS_YEAR);

    expect(row(p, "TH")).toMatchObject({
      groundPresence: true,
      visited: true,
      counted: true,
      visitUncertain: false,
      visitUncertainReasons: [],
      tier: "visited",
      evidence: "flight",
      override: { verdict: "visited", note: "note for TH", day: null },
    });
    expect(row(p, "TH")!.kinds).toEqual(["flight", "manual"]);
    expect(p.summary.visitedCountries).toBe(base.summary.visitedCountries! + 1);
    expect(p.summary.unclearCountries).toBe(base.summary.unclearCountries! - 1);
    expect(p.summary.groundCountries).toBe(base.summary.groundCountries);
    expectRecounted(p);
  });

  it("visited creates a manual row for a country no record shows", () => {
    const base = automatic(OPEN_JAW);
    const p = applyCountryOverrides(base, [override("PT", "visited", "2026-03-01")], THIS_YEAR);

    expect(row(p, "PT")).toMatchObject({
      code: "PT",
      continent: "Europe",
      evidence: "manual",
      kinds: ["manual"],
      tier: "visited",
      visited: true,
      counted: true,
      entries: 0,
      airports: [],
      firstYear: 2026,
      lastYear: 2026,
      firstVisitedYear: 2026,
      isNew: true,
      daysPresent: 0,
      hasUndatedEvidence: false,
      override: { verdict: "visited", note: "note for PT", day: "2026-03-01" },
    });
    expect(p.summary.groundCountries).toBe(base.summary.groundCountries! + 1);
    expect(p.summary.visitedCountries).toBe(base.summary.visitedCountries! + 1);
    expect(p.summary.newThisYear).toBe(base.summary.newThisYear + 1);
    expect(p.summary.byEvidence.manual).toBe(1);
    expectRecounted(p);
  });

  it("visited with an earlier day moves the first visit back, so the country is not new", () => {
    const thisYearsTrip = [
      flight("MUC", "DOH", "2026-01-01"),
      flight("DOH", "HAN", "2026-01-02"),
      flight("HAN", "DOH", "2026-01-20"),
      flight("DOH", "MUC", "2026-01-21"),
    ];
    const base = automatic(thisYearsTrip);
    expect(row(base, "VN")).toMatchObject({ firstVisitedYear: 2026, isNew: true });

    const p = applyCountryOverrides(base, [override("VN", "visited", "2019-05-04")], THIS_YEAR);

    expect(row(p, "VN")).toMatchObject({ firstYear: 2019, firstVisitedYear: 2019, isNew: false });
    expect(p.summary.newThisYear).toBe(base.summary.newThisYear - 1);
    expectRecounted(p);
  });

  it("a manual row without a day is undated and never new", () => {
    const p = applyCountryOverrides(automatic(OPEN_JAW), [override("pt", "visited")], THIS_YEAR);
    expect(row(p, "PT")).toMatchObject({
      firstYear: null,
      isNew: false,
      hasUndatedEvidence: true,
    });
  });

  it("a transcontinental manual country gets no guessed continent", () => {
    const p = applyCountryOverrides(automatic([]), [override("RU", "visited")], THIS_YEAR);
    expect(row(p, "RU")!.continent).toBeNull();
    expectRecounted(p);
  });

  it("ground demotes a visited row out of 'Besucht' but keeps it on the ground", () => {
    const base = automatic(DOHA_HANOI);
    expect(row(base, "VN")).toMatchObject({ visited: true });

    const p = applyCountryOverrides(base, [override("VN", "ground")], THIS_YEAR);

    expect(row(p, "VN")).toMatchObject({
      groundPresence: true,
      visited: false,
      counted: false,
      visitUncertain: false,
      tier: "transited",
      visitSources: [],
      isNew: false,
      override: { verdict: "ground" },
    });
    expect(p.summary.visitedCountries).toBe(base.summary.visitedCountries! - 1);
    expect(p.summary.groundCountries).toBe(base.summary.groundCountries);
    expectRecounted(p);
  });

  it("ground creates a ground-only row for a country no record shows", () => {
    const p = applyCountryOverrides(automatic([]), [override("AT", "ground")], THIS_YEAR);
    expect(row(p, "AT")).toMatchObject({ groundPresence: true, visited: false, tier: "transited" });
    expect(p.summary).toMatchObject({ groundCountries: 1, visitedCountries: 0, countries: 0 });
    expectRecounted(p);
  });

  it("visited never lowers a stronger tier", () => {
    const base = automatic(DOHA_HANOI);
    const slept = {
      ...base,
      countries: base.countries.map((c) => ({ ...c, tier: "slept" as const })),
    };
    const p = applyCountryOverrides(slept, [override("VN", "visited")], THIS_YEAR);
    expect(row(p, "VN")!.tier).toBe("slept");
  });

  it("excluded removes the country from both sets and every total, and lists it", () => {
    const base = automatic(DOHA_HANOI);
    const p = applyCountryOverrides(base, [override("VN", "excluded", "2025-01-05")], THIS_YEAR);

    expect(row(p, "VN")).toBeUndefined();
    expect(p.excludedCountries).toEqual([{ code: "VN", note: "note for VN", day: "2025-01-05" }]);
    expect(p.summary.groundCountries).toBe(base.summary.groundCountries! - 1);
    expect(p.summary.visitedCountries).toBe(base.summary.visitedCountries! - 1);
    expect(p.summary.entries).toBe(base.summary.entries - row(base, "VN")!.entries);
    expect(p.stamps.map((s) => s.iata)).not.toContain("HAN");
    expect(p.summary.airports).toBe(base.summary.airports - 1);
    expect(p.continents.find((c) => c.continent === "Asia")!.visited).toBe(
      base.continents.find((c) => c.continent === "Asia")!.visited - 1
    );
    expectRecounted(p);
  });

  it("excluding a country no record shows still lists it, so it can be undone", () => {
    const base = automatic(DOHA_HANOI);
    const p = applyCountryOverrides(base, [override("FR", "excluded")], THIS_YEAR);
    expect(p.countries).toHaveLength(base.countries.length);
    expect(p.excludedCountries.map((c) => c.code)).toEqual(["FR"]);
  });
});
