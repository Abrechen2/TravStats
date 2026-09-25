import { prisma } from "../../../../db";
import { updateInstanceSettings } from "../../../instanceSettingsService";
import { lookupTrain } from "..";
import { __clearRailHttpCache } from "../railHttp";
import {
  BERLIN,
  FRANKFURT,
  FULDA,
  mockFetch,
  stopTimesPage,
  tracedLine,
  tripAnswer,
  TRIP_ID,
  type FetchMock,
} from "./railFetchMock";

/**
 * The train-number lookup chain against recorded provider answers. No test
 * here reaches the network: `mockFetch` fails on any URL it does not know.
 */

const SOURCE = "rail-lookup-test";

const ICE_696_LINE = {
  name: "ICE 696",
  fahrtNr: "696",
  productName: "ICE",
  operator: { name: "DB Fernverkehr AG" },
};
const dbRestDepartures = (day: string): unknown => ({
  departures: [{ tripId: "1|db|696", plannedWhen: `${day}T06:15:00+02:00`, line: ICE_696_LINE }],
});
const dbRestTrip = {
  trip: {
    line: ICE_696_LINE,
    stopovers: [
      {
        stop: {
          name: "Frankfurt(Main)Hbf",
          location: { latitude: FRANKFURT.lat, longitude: FRANKFURT.lon },
        },
        plannedDeparture: "2026-09-26T06:15:00+02:00",
      },
      {
        stop: {
          name: "Berlin Gesundbrunnen",
          location: { latitude: BERLIN.lat, longitude: BERLIN.lon },
        },
        plannedArrival: "2026-09-26T10:43:00+02:00",
      },
    ],
  },
};

describe("lookupTrain", () => {
  let frankfurtId: number;
  let parisId: number;
  let fetchMock: FetchMock | null = null;

  const mock = (routes: Parameters<typeof mockFetch>[0]): FetchMock => {
    fetchMock = mockFetch(routes);
    return fetchMock;
  };

  beforeAll(async () => {
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: SOURCE } } });
    const make = (
      id: string,
      s: { name: string; lat: number; lon: number },
      extra: Record<string, string> = {}
    ) =>
      prisma.railStation.create({
        data: {
          sourceId: `${SOURCE}-${id}`,
          name: s.name,
          searchName: s.name.toLowerCase(),
          lat: s.lat,
          lon: s.lon,
          ...extra,
        },
      });
    const fra = await make("fra", FRANKFURT, {
      uic: "8011068",
      dbId: "8000105",
      country: "DE",
      timezone: "Europe/Berlin",
    });
    frankfurtId = fra.id;
    await make("fulda", FULDA, { uic: "8011146", country: "DE" });
    await make("berlin", BERLIN, { uic: "8011102", country: "DE" });
    const paris = await make(
      "paris",
      { name: "Paris Est", lat: 48.8768, lon: 2.3591 },
      {
        country: "FR",
      }
    );
    parisId = paris.id;
  });

  beforeEach(async () => {
    __clearRailHttpCache();
    await updateInstanceSettings({ railTransitousEnabled: true, railDbRestEnabled: true });
  });

  afterEach(() => {
    fetchMock?.restore();
    fetchMock = null;
  });

  afterAll(async () => {
    await updateInstanceSettings({ railTransitousEnabled: true, railDbRestEnabled: true });
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: SOURCE } } });
    await prisma.$disconnect();
  });

  const ask = (date = "2026-09-26", stationId = frankfurtId) =>
    lookupTrain({ trainNumber: "ICE 696", date, from: { lat: 0, lon: 0, stationId } });

  it("finds the train at the boarding station on Transitous, with its stops on their own clocks", async () => {
    const m = mock([
      [/api\.transitous\.org\/api\/v6\/stoptimes/, stopTimesPage("2026-09-26")],
      [/api\.transitous\.org\/api\/v6\/trip/, tripAnswer(tracedLine([FRANKFURT, FULDA, BERLIN]))],
    ]);
    const answer = await ask();

    expect(answer.attempts).toEqual([{ provider: "transitous", outcome: "matched" }]);
    const match = answer.match!;
    expect(match).toMatchObject({
      provider: "transitous",
      ref: TRIP_ID,
      operator: "DB Fernverkehr AG",
      trainCategory: "ICE",
      trainNumber: "696",
      boardingIndex: 0,
      hasGeometry: true,
    });
    // ICE 1696 leaves first from the same station; the number is matched whole.
    expect(match.stops.map((s) => s.name)).toEqual([FRANKFURT.name, FULDA.name, BERLIN.name]);
    // 04:15 UTC is 06:15 on the Frankfurt clock — what the form's field holds.
    expect(match.stops[0]).toMatchObject({
      stationId: frankfurtId,
      code: "8011068",
      country: "DE",
      departureLocal: "2026-09-26T06:15",
    });
    expect(match.stops[2].arrivalLocal).toBe("2026-09-26T10:43");
    // The first window already held the train: one stoptimes page, one trip.
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]).toContain("center=50.107149,8.663785");
    // The day starts at local midnight: 2026-09-25T22:00Z in Berlin.
    expect(m.calls[0]).toContain(encodeURIComponent("2026-09-25T22:00:00.000Z"));
  });

  it("says who is asking: Transitous wants a User-Agent with contact details", async () => {
    const previous = process.env.RAIL_LOOKUP_CONTACT;
    process.env.RAIL_LOOKUP_CONTACT = "ops@example.org";
    try {
      const m = mock([
        [/stoptimes/, stopTimesPage("2026-09-26")],
        [/api\/v6\/trip/, tripAnswer(tracedLine([FRANKFURT, BERLIN]))],
      ]);
      await ask();
      expect(m.userAgents[0]).toMatch(
        /^TravStats .*github\.com\/Abrechen2\/TravStats; ops@example\.org\)$/
      );
    } finally {
      if (previous === undefined) delete process.env.RAIL_LOOKUP_CONTACT;
      else process.env.RAIL_LOOKUP_CONTACT = previous;
    }
  });

  it("does not take another day's train for the asked one", async () => {
    // Asked for 2024-06-01, Transitous answers with the departures of the
    // first day it has — 2026-08-25, measured against the live service on
    // 2026-09-25. db-rest's window is no deeper.
    const m = mock([
      [/stoptimes/, stopTimesPage("2026-08-25")],
      [/v6\.db\.transport\.rest\/stops\/8000105\/departures/, dbRestDepartures("2026-08-25")],
    ]);
    const answer = await ask("2024-06-01");

    expect(answer.match).toBeNull();
    expect(answer.attempts).toEqual([
      { provider: "transitous", outcome: "noMatch" },
      { provider: "db-rest", outcome: "noMatch" },
    ]);
    // Six four-hour windows cover the day before Transitous gives up.
    expect(m.calls.filter((u) => u.includes("stoptimes"))).toHaveLength(6);
    expect(m.calls.some((u) => u.includes("/api/v6/trip"))).toBe(false);
  });

  it("falls through to db-rest when Transitous does not answer, naming the stop by its EVA number", async () => {
    const m = mock([
      [/stoptimes/, { error: "down" }, 503],
      [/v6\.db\.transport\.rest\/stops\/8000105\/departures/, dbRestDepartures("2026-09-26")],
      [/v6\.db\.transport\.rest\/trips\//, dbRestTrip],
    ]);
    const answer = await ask();

    expect(answer.attempts).toEqual([
      { provider: "transitous", outcome: "unavailable" },
      { provider: "db-rest", outcome: "matched" },
    ]);
    expect(answer.match).toMatchObject({
      provider: "db-rest",
      ref: "1|db|696",
      trainCategory: "ICE",
      trainNumber: "696",
      hasGeometry: false,
    });
    expect(answer.match!.stops[1].arrivalLocal).toBe("2026-09-26T10:43");
    // The UIC code (8011068) is NOT what db-rest wants; the EVA number is.
    expect(m.calls.some((u) => u.includes("8011068"))).toBe(false);
    expect(m.calls.some((u) => u.includes("/locations/nearby"))).toBe(false);
  });

  it("asks no provider the admin switched off", async () => {
    await updateInstanceSettings({ railTransitousEnabled: false });
    const m = mock([
      [/v6\.db\.transport\.rest\/stops\/8000105\/departures/, dbRestDepartures("2026-09-26")],
      [/v6\.db\.transport\.rest\/trips\//, dbRestTrip],
    ]);
    const answer = await ask();

    expect(answer.attempts[0]).toEqual({ provider: "transitous", outcome: "disabled" });
    expect(m.calls.some((u) => u.includes("transitous"))).toBe(false);
    expect(answer.match?.provider).toBe("db-rest");
  });

  it("does not ask the German service about a station outside Germany", async () => {
    const m = mock([[/stoptimes/, { stopTimes: [] }]]);
    const answer = await ask("2026-09-26", parisId);

    expect(answer.attempts).toEqual([
      { provider: "transitous", outcome: "noMatch" },
      { provider: "db-rest", outcome: "notApplicable" },
    ]);
    expect(m.calls.some((u) => u.includes("db.transport.rest"))).toBe(false);
  });

  it("answers a repeated lookup from its cache", async () => {
    const m = mock([
      [/stoptimes/, stopTimesPage("2026-09-26")],
      [/api\/v6\/trip/, tripAnswer(tracedLine([FRANKFURT, BERLIN]))],
    ]);
    await ask();
    const before = m.calls.length;
    await ask();
    expect(m.calls).toHaveLength(before);
  });
});
