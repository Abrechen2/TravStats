import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";
import { calculateDistance } from "../utils/geo";
import { detectTrips } from "../services/tripDetectionService";
import { computeTripSuggestions } from "../services/tripSuggestions/engine";
import { loadHomeIatas } from "../services/stats/passportLoader";
import { homePeriodsFromData, loadHomePeriods } from "../services/home/homeStore";
import { USER_EXPORT_SELECT } from "../services/export/allDataExport";
import { ensureUserSettings } from "../seedDemoAccount";

/**
 * "Zuhause" = residence + home airports (owner decision 2026-09-27), against a
 * real database and the real airport catalogue.
 *
 * The fixtures write the settings blob by hand, in the shape the new server
 * stores — `homePeriods` AND the legacy mirror `homeAirportHistory`, which
 * names only the primary airport. A server that still read the mirror alone
 * therefore sees "home = CGN" and nothing else: that is the reading each test
 * below proves wrong for the right reason.
 */

const KOELN = { name: "Köln", lat: 50.9375, lon: 6.9603 };
const MUENCHEN = { name: "München", lat: 48.1374, lon: 11.5755 };
/** A hotel by Düsseldorf airport: 40 km from Köln, 53 km from CGN's runway. */
const DUS_HOTEL = { lat: 51.2803, lon: 6.7627 };
/** Kassel, ~180 km from Köln. */
const KASSEL = { lat: 51.3127, lon: 9.4797 };

type Coord = { lat: number; lon: number };

const period = (
  fromDate: string,
  toDate: string | null,
  residence: typeof KOELN,
  codes: string[],
  primary = codes[0]
) => ({
  fromDate,
  toDate,
  residence,
  residenceConfirmed: true,
  airports: codes.map((code) => ({ code, primary: code === primary })),
});

type Period = ReturnType<typeof period>;

/** What the new server writes: the periods, plus the primary-only mirror. */
const blob = (periods: Period[]) => ({
  homePeriods: periods,
  homeAirportHistory: periods.map((p) => ({
    iata: p.airports.find((a) => a.primary)!.code,
    fromDate: p.fromDate,
    toDate: p.toDate,
  })),
});

const KOELN_NOW = [period("2020-01-01", null, KOELN, ["CGN", "DUS"])];

describe("home = residence + home airports", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  const airports = new Map<string, Coord & { name: string }>();

  const setHome = (data: object) =>
    prisma.userSettings.update({
      where: { userId },
      data: { data: data as never },
    });

  type FlightData = Parameters<typeof prisma.flight.create>[0]["data"];
  const fly = (
    dep: string,
    arr: string,
    departure: string,
    hours = 3,
    over: Partial<FlightData> = {}
  ) => {
    const a = airports.get(dep)!;
    const b = airports.get(arr)!;
    const departureTime = new Date(departure);
    return prisma.flight.create({
      data: {
        userId,
        depIata: dep,
        arrIata: arr,
        depLat: a.lat,
        depLon: a.lon,
        arrLat: b.lat,
        arrLon: b.lon,
        departureTime,
        arrivalTime: new Date(departureTime.getTime() + hours * 3_600_000),
        status: "flown",
        ...over,
      },
    });
  };

  const stay = async (at: Coord, name: string, checkIn: string, checkOut: string) => {
    const lodging = await prisma.lodging.create({ data: { userId, name, city: name, ...at } });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date(`${checkIn}T00:00:00Z`),
        checkOut: new Date(`${checkOut}T00:00:00Z`),
      },
    });
  };

  /** Two back-to-back stays: a new-trip proposal needs two entries. */
  const twoStays = async (at: Coord, name: string, from: string, mid: string, to: string) => {
    await stay(at, `${name} I`, from, mid);
    await stay({ lat: at.lat + 0.005, lon: at.lon }, `${name} II`, mid, to);
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `home-${stamp}`, passwordHash } });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: {
        userId,
        enabledDomains: ["flight", "lodging"],
        data: blob(KOELN_NOW) as never,
      },
    });
    const rows = await prisma.airport.findMany({
      where: {
        iata: { in: ["CGN", "DUS", "LIS", "OPO", "MUC", "JFK", "LHR", "AMS"] },
        isClosed: false,
      },
    });
    for (const r of rows) airports.set(r.iata!, { lat: r.lat, lon: r.lon, name: r.name });
    expect(airports.size).toBe(8);
  });

  beforeEach(async () => {
    await prisma.dataQualityFlag.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await setHome(blob(KOELN_NOW));
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("airport questions use membership", () => {
    it("detects CGN → LIS → OPO → DUS as a home loop", async () => {
      await fly("CGN", "LIS", "2024-05-01T08:00:00Z");
      await fly("LIS", "OPO", "2024-05-04T08:00:00Z", 1);
      await fly("OPO", "DUS", "2024-05-08T08:00:00Z");
      const { proposed } = await detectTrips({ userId, dryRun: true });
      expect(proposed).toHaveLength(1);
      expect(proposed[0].source).toBe("home_loop");
      expect(proposed[0].flightIds).toHaveLength(3);
    });

    it("respects the dates: DUS was not home in 2018, MUC was", async () => {
      await setHome(
        blob([
          period("2015-01-01", "2020-01-01", MUENCHEN, ["MUC"]),
          period("2020-01-01", null, KOELN, ["CGN", "DUS"]),
        ])
      );
      await fly("DUS", "LHR", "2018-03-01T08:00:00Z", 1);
      await fly("LHR", "AMS", "2018-03-03T08:00:00Z", 1);
      await fly("AMS", "DUS", "2018-03-05T08:00:00Z", 1);
      await fly("MUC", "LIS", "2019-06-01T08:00:00Z");
      await fly("LIS", "OPO", "2019-06-04T08:00:00Z", 1);
      await fly("OPO", "MUC", "2019-06-08T08:00:00Z");
      const { proposed } = await detectTrips({ userId, dryRun: true });
      const bySource = Object.fromEntries(proposed.map((p) => [p.origin, p.source]));
      expect(bySource).toEqual({ DUS: "continuity", MUC: "home_loop" });
    });

    it("does not count a change of planes at DUS as a layover", async () => {
      await fly("LIS", "DUS", "2024-06-01T07:00:00Z");
      await fly("DUS", "MUC", "2024-06-01T14:00:00Z", 1);
      const res = await request(app).get("/api/v1/stats/unique").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.longestLayover).toBeNull();
    });

    it("puts every home airport on the passport's home list", async () => {
      expect((await loadHomeIatas(userId)).sort()).toEqual(["CGN", "DUS"]);
    });
  });

  describe("distance questions measure from the residence", () => {
    const newTrips = async () =>
      (await computeTripSuggestions(userId)).suggestions.filter((s) => s.kind === "new_trip");

    it("does not call a Düsseldorf stay 'away' for someone living in Köln", async () => {
      await twoStays(DUS_HOTEL, "Düsseldorf", "2025-03-01", "2025-03-03", "2025-03-04");
      expect(await newTrips()).toHaveLength(0);
    });

    it("calls a stay ~180 km away 'away'", async () => {
      await twoStays(KASSEL, "Kassel", "2025-04-01", "2025-04-03", "2025-04-04");
      const trips = await newTrips();
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({ startDay: "2025-04-01", endDay: "2025-04-04" });
    });

    it("measures the farthest-from-home airport from the residence", async () => {
      await fly("CGN", "JFK", "2024-02-01T08:00:00Z", 9);
      const res = await request(app).get("/api/v1/stats/airports").set("Cookie", cookie);
      expect(res.status).toBe(200);
      const jfk = airports.get("JFK")!;
      const cgn = airports.get("CGN")!;
      const fromResidence = Math.round(calculateDistance(KOELN.lat, KOELN.lon, jfk.lat, jfk.lon));
      const fromAirport = Math.round(calculateDistance(cgn.lat, cgn.lon, jfk.lat, jfk.lon));
      expect(fromResidence).not.toBe(fromAirport);
      expect(res.body.farthestFromHome).toMatchObject({
        code: "JFK",
        distanceKm: fromResidence,
        homeCode: "CGN",
      });
    });
  });

  describe("an account with only the old shape keeps its numbers until it confirms", () => {
    const legacyOnly = {
      homeAirportHistory: [{ iata: "CGN", fromDate: "2020-01-01", toDate: null }],
    };

    it("measures from the airport, exactly as before", async () => {
      await setHome(legacyOnly);
      await fly("CGN", "JFK", "2024-02-01T08:00:00Z", 9);
      const res = await request(app).get("/api/v1/stats/airports").set("Cookie", cookie);
      const jfk = airports.get("JFK")!;
      const cgn = airports.get("CGN")!;
      expect(res.body.farthestFromHome.distanceKm).toBe(
        Math.round(calculateDistance(cgn.lat, cgn.lon, jfk.lat, jfk.lon))
      );
    });

    it("still calls the Düsseldorf stay 'away' — nothing changes silently", async () => {
      await setHome(legacyOnly);
      await twoStays(DUS_HOTEL, "Düsseldorf", "2025-03-01", "2025-03-03", "2025-03-04");
      expect(
        (await computeTripSuggestions(userId)).suggestions.filter((s) => s.kind === "new_trip")
      ).toHaveLength(1);
    });

    it("serves the migrated period, unconfirmed, at the airport", async () => {
      await setHome(legacyOnly);
      const res = await request(app).get("/api/v1/settings/home-airports").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.history).toEqual(legacyOnly.homeAirportHistory);
      const cgn = airports.get("CGN")!;
      expect(res.body.periods).toEqual([
        {
          fromDate: "2020-01-01",
          toDate: null,
          residence: expect.objectContaining({ lat: cgn.lat, lon: cgn.lon }),
          residenceConfirmed: false,
          airports: [{ code: "CGN", primary: true }],
        },
      ]);
    });

    it("asks ONE inbox question, however many periods, and closes it on confirmation", async () => {
      await setHome({
        homeAirportHistory: [
          { iata: "MUC", fromDate: "2015-01-01", toDate: "2020-01-01" },
          { iata: "CGN", fromDate: "2020-01-01", toDate: null },
        ],
      });
      const run = () => request(app).post("/api/v1/data-quality-flags/run").set("Cookie", cookie);
      expect((await run()).status).toBe(200);
      const open = await request(app).get("/api/v1/data-quality-flags").set("Cookie", cookie);
      const home = open.body.flags.filter(
        (f: { kind: string }) => f.kind === "home_residence_unconfirmed"
      );
      expect(home).toHaveLength(1);
      expect(home[0]).toMatchObject({ entityType: "home", subject: { entityType: "home" } });
      expect(home[0].details.airports).toEqual(["MUC", "CGN"]);

      const put = await request(app)
        .put("/api/v1/settings/home-airports/periods")
        .set("Cookie", cookie)
        .send({
          periods: [
            period("2015-01-01", "2020-01-01", MUENCHEN, ["MUC"]),
            period("2020-01-01", null, KOELN, ["CGN", "DUS"]),
          ],
        });
      expect(put.status).toBe(200);
      await run();
      const after = await request(app).get("/api/v1/data-quality-flags").set("Cookie", cookie);
      expect(
        after.body.flags.filter((f: { kind: string }) => f.kind === "home_residence_unconfirmed")
      ).toHaveLength(0);
    });
  });

  describe("the primary airport drives the prefills", () => {
    it("offers the primary as the trip form's origin and keeps every home airport out of the destinations", async () => {
      await setHome(blob([period("2020-01-01", null, KOELN, ["CGN", "DUS"], "DUS")]));
      const trip = await prisma.trip.create({ data: { userId, name: "Lissabon" } });
      await fly("DUS", "LIS", "2024-05-01T08:00:00Z", 3, { tripId: trip.id });
      await fly("LIS", "CGN", "2024-05-08T08:00:00Z", 3, { tripId: trip.id });
      const res = await request(app)
        .get("/api/v1/trips/entry-suggestions")
        .query({ tripId: trip.id })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.origins).toHaveLength(1);
      expect(res.body.origins[0]).toMatch(/Düsseldorf/);
      expect(res.body.destinations).toHaveLength(1);
      expect(res.body.destinations[0]).toMatch(/Lisbon|Lissabon/);
    });
  });

  describe("export and backup", () => {
    it("carries the periods in the data export, and reads them back unchanged", async () => {
      const exported = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: USER_EXPORT_SELECT,
      });
      const data = JSON.parse(JSON.stringify(exported.settings?.data));
      expect(data.homePeriods).toEqual(KOELN_NOW);
      expect(await homePeriodsFromData(data)).toEqual(KOELN_NOW);
    });

    it("still reads an export written before the rework — the old key alone", async () => {
      const cgn = airports.get("CGN")!;
      const old = { homeAirportHistory: [{ iata: "CGN", fromDate: "2020-01-01", toDate: null }] };
      expect(await homePeriodsFromData(old)).toEqual([
        {
          fromDate: "2020-01-01",
          toDate: null,
          residence: expect.objectContaining({ lat: cgn.lat, lon: cgn.lon }),
          residenceConfirmed: false,
          airports: [{ code: "CGN", primary: true }],
        },
      ]);
    });
  });

  describe("the demo account", () => {
    it("lives in Köln and flies from CGN (default) and DUS, confirmed", async () => {
      await ensureUserSettings(userId, new Date("2026-09-27T12:00:00Z"));
      const [only, ...rest] = await loadHomePeriods(userId);
      expect(rest).toHaveLength(0);
      expect(only).toMatchObject({
        fromDate: "2016-01-01",
        toDate: null,
        residence: { name: "Köln" },
        residenceConfirmed: true,
        airports: [
          { code: "CGN", primary: true },
          { code: "DUS", primary: false },
        ],
      });
    });
  });

  describe("the settings API", () => {
    const put = (body: unknown) =>
      request(app).put("/api/v1/settings/home-airports/periods").set("Cookie", cookie).send(body);

    it("keeps serving the old shape a Companion reads, derived from the periods", async () => {
      const res = await request(app).get("/api/v1/settings/home-airports").set("Cookie", cookie);
      expect(res.body.history).toEqual([{ iata: "CGN", fromDate: "2020-01-01", toDate: null }]);
      const settings = await request(app).get("/api/v1/settings").set("Cookie", cookie);
      expect(settings.body.homeAirportHistory).toEqual(res.body.history);
      expect(settings.body.homePeriods).toEqual(KOELN_NOW);
    });

    it("converts an old-shape move and keeps the earlier period's residence and airports", async () => {
      const res = await request(app)
        .post("/api/v1/settings/home-airports")
        .set("Cookie", cookie)
        .send({ iata: "MUC", fromDate: "2026-01-01" });
      expect(res.status).toBe(200);
      expect(res.body.history).toEqual([
        { iata: "CGN", fromDate: "2020-01-01", toDate: "2026-01-01" },
        { iata: "MUC", fromDate: "2026-01-01", toDate: null },
      ]);
      expect(res.body.periods[0]).toMatchObject({
        residence: KOELN,
        residenceConfirmed: true,
        airports: KOELN_NOW[0].airports,
      });
      expect(res.body.periods[1]).toMatchObject({
        residenceConfirmed: false,
        airports: [{ code: "MUC", primary: true }],
      });
    });

    it("refuses four airports, two primaries and an unknown code with stable codes", async () => {
      const four = {
        ...KOELN_NOW[0],
        airports: ["CGN", "DUS", "NRN", "LHR"].map((code, i) => ({ code, primary: i === 0 })),
      };
      expect((await put({ periods: [four] })).body.error).toBe("HOME_PERIODS_INVALID");
      const twoPrimaries = {
        ...KOELN_NOW[0],
        airports: [
          { code: "CGN", primary: true },
          { code: "DUS", primary: true },
        ],
      };
      expect((await put({ periods: [twoPrimaries] })).body.error).toBe("HOME_PERIODS_INVALID");
      const overlapping = [period("2015-01-01", "2021-01-01", MUENCHEN, ["MUC"]), ...KOELN_NOW];
      expect((await put({ periods: overlapping })).body.error).toBe("HOME_PERIODS_INVALID");
      const unknown = await put({
        periods: [{ ...KOELN_NOW[0], airports: [{ code: "QQX", primary: true }] }],
      });
      expect(unknown.status).toBe(400);
      expect(unknown.body).toMatchObject({ error: "HOME_AIRPORT_UNKNOWN", codes: ["QQX"] });
      // Nothing of the refused writes reached the account.
      const res = await request(app).get("/api/v1/settings/home-airports").set("Cookie", cookie);
      expect(res.body.periods).toEqual(KOELN_NOW);
    });

    it("suggests the nearest airports to a residence, nearest first", async () => {
      const res = await request(app)
        .get("/api/v1/settings/home-airports/nearby")
        .query({ lat: KOELN.lat, lon: KOELN.lon })
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      const codes = res.body.airports.map((a: { code: string }) => a.code);
      expect(codes).toContain("CGN");
      expect(codes).toContain("DUS");
      const km = res.body.airports.map((a: { distanceKm: number }) => a.distanceKm);
      expect(km).toEqual([...km].sort((a, b) => a - b));
    });
  });
});
