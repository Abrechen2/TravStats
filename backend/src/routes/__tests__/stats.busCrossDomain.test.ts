import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * forgejo#265 — bus rides in the cross-domain figures, the passport and the
 * country page, behind the bus beta switch. A coach ride counts ONCE beside
 * the trip's other legs: it adds an experience, but a day or a country a
 * flight already proved stays one day and one country.
 *
 * Fixture (2025): FRA → PRG flight on 10 May, Praha → Wien coach on 10 May
 * (same day; CZ already proved by the flight, AT new), Wien → Praha coach on
 * 12 May; a cancelled coach Wien → Budapest that proves nothing.
 */
describe("bus in the cross-domain figures and the passport", () => {
  const username = `bus-cross-${Date.now()}`;
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  const PRAHA = {
    name: "Praha Florenc",
    lat: 50.0897,
    lon: 14.4397,
    cc: "CZ",
    tz: "Europe/Prague",
  };
  const WIEN = { name: "Wien Erdberg", lat: 48.1913, lon: 16.4146, cc: "AT", tz: "Europe/Vienna" };
  const BUDAPEST = {
    name: "Budapest Népliget",
    lat: 47.4757,
    lon: 19.0985,
    cc: "HU",
    tz: "Europe/Budapest",
  };
  type Stop = typeof PRAHA;

  const coach = (from: Stop, to: Stop, dep: string, arr: string, status = "completed") =>
    prisma.busJourney.create({
      data: {
        userId,
        depStationName: from.name,
        depLat: from.lat,
        depLon: from.lon,
        depCountry: from.cc,
        depTimezone: from.tz,
        arrStationName: to.name,
        arrLat: to.lat,
        arrLon: to.lon,
        arrCountry: to.cc,
        arrTimezone: to.tz,
        departureTime: new Date(dep),
        arrivalTime: new Date(arr),
        depPrecision: "minute",
        arrPrecision: "minute",
        operator: "FlixBus",
        status,
      },
    });

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    userId = (
      await prisma.user.create({ data: { username, passwordHash: await hashPassword("pw123456") } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "bus"], data: {} },
    });
    await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "PRG",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 50.1008,
        arrLon: 14.26,
        departureTime: new Date("2025-05-10T06:00:00Z"),
        arrivalTime: new Date("2025-05-10T07:00:00Z"),
        status: "flown",
        flightNumber: "LH1394",
      },
    });
    await coach(PRAHA, WIEN, "2025-05-10T12:00:00Z", "2025-05-10T16:00:00Z");
    await coach(WIEN, PRAHA, "2025-05-12T08:00:00Z", "2025-05-12T12:00:00Z");
    await coach(WIEN, BUDAPEST, "2025-05-11T08:00:00Z", "2025-05-11T11:00:00Z", "cancelled");
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const metric = (key: string, domains = "flight,bus") =>
    request(app)
      .get(`/api/v1/evidence/metric/${key}`)
      .query({ domains, period: "year", year: 2025 })
      .set("Cookie", cookie);

  it("counts each completed coach ride once beside the flight — no second day, no second country", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const events = await metric("crossDomainEventCount");
    expect(events.status).toBe(200);
    expect(events.body.measure.value).toBe(3);
    // 10 May (flight + coach) and 12 May — the cancelled ride's day is no day.
    expect((await metric("crossDomainActiveDayCount")).body.measure.value).toBe(2);
    // DE, CZ by the flight; AT by the coach; CZ again by the coach is no second CZ; never HU.
    expect((await metric("crossDomainCountryCount")).body.measure.value).toBe(3);
    const busEntry = events.body.entries.find((e: { domain: string }) => e.domain === "bus");
    expect(busEntry.href).toMatch(/^\/bus\//);
  });

  it("puts a country reached only by coach in the passport and on its country page", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const passport = (await request(app).get("/api/v1/stats/passport").set("Cookie", cookie)).body;
    const at = passport.countries.find((c: { code: string }) => c.code === "AT");
    expect(at).toMatchObject({ evidence: "bus", kinds: ["bus"] });
    expect(passport.summary.byEvidence.bus).toBe(1);
    expect(passport.countries.map((c: { code: string }) => c.code)).not.toContain("HU");
    const page = await request(app).get("/api/v1/stats/countries/AT").set("Cookie", cookie);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ evidence: "bus", busRides: 2 });
    expect(page.body.timeline[0]).toMatchObject({ kind: "bus" });
  });

  it("leaves every bus figure out while the bus domain is behind the switch", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    // A chip list naming bus is answered without it, as the overview never folds it.
    expect((await metric("crossDomainEventCount")).body.measure.value).toBe(1);
    expect((await metric("crossDomainCountryCount")).body.measure.value).toBe(2);
    const passport = (await request(app).get("/api/v1/stats/passport").set("Cookie", cookie)).body;
    expect(passport.countries.map((c: { code: string }) => c.code)).not.toContain("AT");
    expect(
      (await request(app).get("/api/v1/stats/countries/AT").set("Cookie", cookie)).status
    ).toBe(404);
  });
});
