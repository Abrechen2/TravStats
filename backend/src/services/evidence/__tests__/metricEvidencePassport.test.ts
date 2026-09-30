import { prisma } from "../../../db";
import type { EvidenceScope } from "../../../shared/evidence";
import { loadPassport } from "../../stats/passportLoader";
import { loadCountryDetail } from "../../stats/countryDetailLoader";
import { resolveMetricEvidence } from "../metricEvidence";
import { resolveRankingEvidence } from "../rankingEvidence";
import { assertDistinctInvariant, assertSumInvariant } from "./invariants";

/**
 * forgejo#132 items 5 and 6. The passport's headline figures — "23 Länder",
 * the airports, the entries, the continents — could not be tapped, because no
 * evidence key named them; and the only per-country evidence was keyed by the
 * airport catalogue's country NAME and counted flights by the distribution
 * tile's rule, not by the country page's.
 *
 * The guard is agreement: every value equals the figure `/stats/passport` and
 * `/stats/countries/:code` publish, every row listed proves what it credits,
 * and a country only location history proves is SAID to be one.
 */
const USER = "passportevidence";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const PAGE = { offset: 0, limit: 100 };
const d = (day: string) => new Date(`${day}T00:00:00Z`);

describe("passport evidence", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;

    const airports = await prisma.airport.findMany({
      where: { iata: { in: ["MUC", "DOH", "SIN", "FRA", "LHR"] } },
      select: { iata: true, lat: true, lon: true },
    });
    const at = new Map(airports.map((a) => [a.iata, a]));
    const leg = (dep: string, arr: string, when: string, status = "flown") =>
      prisma.flight.create({
        data: {
          userId,
          flightNumber: `${dep}${arr}`,
          depIata: dep,
          depLat: at.get(dep)!.lat,
          depLon: at.get(dep)!.lon,
          arrIata: arr,
          arrLat: at.get(arr)!.lat,
          arrLon: at.get(arr)!.lon,
          departureTime: new Date(when),
          status,
        },
      });
    // Qatar is a same-day connection: in the passport, not in the headline.
    await leg("MUC", "DOH", "2024-03-01T06:00:00Z");
    await leg("DOH", "SIN", "2024-03-01T16:00:00Z");
    await leg("FRA", "LHR", "2023-05-01T08:00:00Z");
    await leg("FRA", "MUC", "2023-06-01T08:00:00Z"); // domestic: one entry, not two
    await leg("FRA", "SIN", "2031-01-01T08:00:00Z", "scheduled"); // not flown: nothing

    // A house in Italy, a place in Spain, a train to Austria.
    await prisma.lodging.create({
      data: {
        userId,
        name: "Albergo Roma",
        isoCountryCode: "IT",
        visited: true,
        stays: {
          create: {
            userId,
            checkIn: d("2022-04-01"),
            checkOut: d("2022-04-04"),
            status: "completed",
          },
        },
      },
    });
    await prisma.place.create({
      data: {
        userId,
        name: "Sagrada Família",
        lat: 41.4036,
        lon: 2.1744,
        isoCountryCode: "ES",
        visited: true,
      },
    });
    await prisma.railJourney.create({
      data: {
        userId,
        status: "completed",
        depStationName: "München Hbf",
        depLat: 48.14,
        depLon: 11.56,
        depCountry: "DE",
        depTimezone: "Europe/Berlin",
        arrStationName: "Salzburg Hbf",
        arrLat: 47.81,
        arrLon: 13.05,
        arrCountry: "AT",
        arrTimezone: "Europe/Vienna",
        departureTime: new Date("2021-08-01T07:00:00Z"),
        arrivalTime: new Date("2021-08-01T09:00:00Z"),
      },
    });
    // Two nights of location history in Norway and nothing else there.
    await prisma.countryDay.createMany({
      data: ["2024-07-13", "2024-07-14"].map((day) => ({
        userId,
        date: d(day),
        countryCode: "NO",
        source: "dawarich",
        pointCount: 1,
        airportPointCount: 0,
        spanKm: 0,
      })),
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  const metric = async (key: string) => {
    const res = await resolveMetricEvidence(userId, key, ALL, PAGE);
    if (!res) throw new Error(`${key} is not served`);
    return res;
  };

  it("lists the rows behind the headline country count, and names what only a track proves", async () => {
    const passport = await loadPassport(userId);
    const res = await metric("passportCountryCount");
    assertDistinctInvariant(res);
    expect(res.measure.value).toBe(passport.summary.countries);

    const counted = new Set(passport.countries.filter((c) => c.counted).map((c) => c.code));
    const credited = new Set(res.entries.flatMap((e) => e.credits ?? []));
    // A connection is in the passport but not the headline, so no row credits it.
    expect(counted.has("QA")).toBe(false);
    expect(credited.has("QA")).toBe(false);
    for (const code of credited) expect(counted.has(code)).toBe(true);

    // Each kind of record is a row a reader can open.
    const byDomain = (domain: string) => res.entries.filter((e) => e.domain === domain);
    expect(byDomain("lodging").map((e) => e.credits)).toEqual([["IT"]]);
    expect(byDomain("place").map((e) => e.credits)).toEqual([["ES"]]);
    expect(byDomain("rail")[0]?.credits).toEqual(["AT", "DE"]);

    // Norway: counted, and proved by location history alone.
    expect(counted.has("NO")).toBe(true);
    expect(credited.has("NO")).toBe(false);
    expect(res.unattributed).toEqual([{ count: 1, reason: "locationHistoryOnly" }]);
  });

  it("agrees with the passport on airports, entries and continents", async () => {
    const { summary } = await loadPassport(userId);

    const airports = await metric("passportAirportCount");
    assertDistinctInvariant(airports);
    expect(airports.measure.value).toBe(summary.airports);
    expect(airports.unattributed).toEqual([]);

    const entries = await metric("passportEntryCount");
    assertSumInvariant(entries, Math.round);
    expect(entries.measure.value).toBe(summary.entries);
    expect(entries.unattributed).toEqual([]);
    // FRA → MUC is domestic: one entry; FRA → LHR crosses a border: two.
    const contribution = (number: string) =>
      entries.entries.find((e) => "text" in e.title && e.title.text === number)?.contribution;
    expect(contribution("FRAMUC")).toBe(1);
    expect(contribution("FRALHR")).toBe(2);
    expect(contribution("FRASIN")).toBeUndefined();

    const continents = await metric("passportContinentCount");
    assertDistinctInvariant(continents);
    expect(continents.measure.value).toBe(summary.continentsVisited);
  });

  it("refuses a year: the passport has none", async () => {
    await expect(
      resolveMetricEvidence(
        userId,
        "passportCountryCount",
        { period: { kind: "year", year: 2024 } },
        PAGE
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("keys one country's entries by ISO code and counts them as its country page does", async () => {
    const page = await loadCountryDetail(userId, "DE");
    const res = await resolveRankingEvidence(userId, "passportCountry:DE", ALL, PAGE);
    expect(res).not.toBeNull();
    assertSumInvariant(res!, Math.round);
    expect(res!.measure.value).toBe(page!.entries);
    expect(res!.entries.map((e) => e.id).sort()).toEqual(
      page!.timeline.flatMap((t) => (t.kind === "flight" ? [t.flightId] : [])).sort()
    );
  });

  it("adds up, across every country, to the passport's entries", async () => {
    const passport = await loadPassport(userId);
    let total = 0;
    for (const row of passport.countries) {
      const res = await resolveRankingEvidence(userId, `passportCountry:${row.code}`, ALL, PAGE);
      total += res!.measure.value ?? 0;
    }
    expect(total).toBe(passport.summary.entries);
  });

  it("answers 0 for a country nothing proves, and nothing for a name", async () => {
    const none = await resolveRankingEvidence(userId, "passportCountry:JP", ALL, PAGE);
    expect(none!.measure.value).toBe(0);
    expect(await resolveRankingEvidence(userId, "passportCountry:Germany", ALL, PAGE)).toBeNull();
  });
});
