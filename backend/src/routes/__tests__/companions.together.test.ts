import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { makeFullTrip, type TestAccount } from "./sharingFixtures";

/**
 * "Mit wem unterwegs" on the statistics overview: shared entries that have
 * happened, the days they cover — a day two entries share counts once — and
 * the countries the passport's visited rule proves from them. Paying an
 * expense is not travelling together.
 */
const PREFIX = "companions-together-";

async function account(name: string, domains: string[]): Promise<TestAccount> {
  const user = await prisma.user.create({
    data: { username: `${PREFIX}${name}`, passwordHash: "x", firstName: name },
  });
  await prisma.userSettings.create({
    data: { userId: user.id, data: {}, enabledDomains: domains },
  });
  return { id: user.id, username: user.username, cookie: `auth_token=${generateToken(user.id)}` };
}

const companion = (userId: string, name: string) =>
  prisma.companion.create({
    data: { userId, canonicalName: name.toLowerCase(), displayName: name, searchName: name },
  });

describe("companions — travelled together", () => {
  let anna: TestAccount;
  let full: Awaited<ReturnType<typeof makeFullTrip>>;
  let benId: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    anna = await account("anna", ["flight", "cruise", "rail"]);
    full = await makeFullTrip(anna);
    // The fixture's train leaves Lisbon for Porto: both ends in Portugal.
    await prisma.railJourney.update({
      where: { id: full.rail.id },
      data: { depCountry: "PT", arrCountry: "PT" },
    });
    const ben = await companion(anna.id, "Ben");
    benId = ben.id;
    // Ben: the flight out (1 May), the whole trip (1–8 May), the train (6 May)
    // and the flight home from Porto (8 May), which makes Portugal the
    // destination — without it the passport files Portugal as a transit.
    const home = await prisma.flight.create({
      data: {
        userId: anna.id,
        depIata: "OPO",
        depLat: 41.2481,
        depLon: -8.6814,
        arrIata: "FRA",
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2025-05-08T12:00:00.000Z"),
        arrivalTime: new Date("2025-05-08T15:30:00.000Z"),
        depTimezone: "Europe/Lisbon",
        arrTimezone: "Europe/Berlin",
        depPrecision: "minute",
        arrPrecision: "minute",
        status: "flown",
      },
    });
    await prisma.flightCompanion.createMany({
      data: [
        { flightId: full.flight.id, companionId: ben.id, position: 0 },
        { flightId: home.id, companionId: ben.id, position: 0 },
      ],
    });
    await prisma.tripCompanion.create({
      data: { tripId: full.trip.id, companionId: ben.id, position: 0 },
    });
    await prisma.railJourneyCompanion.create({
      data: { railJourneyId: full.rail.id, companionId: ben.id, position: 0 },
    });
    // A planned flight with Ben is not yet a flight together.
    const planned = await prisma.flight.create({
      data: {
        userId: anna.id,
        depIata: "LIS",
        depLat: 38.7742,
        depLon: -9.1342,
        arrIata: "FRA",
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2099-01-01T08:00:00.000Z"),
        status: "planned",
      },
    });
    await prisma.flightCompanion.create({
      data: { flightId: planned.id, companionId: ben.id, position: 0 },
    });
    // Carl only paid for dinner.
    const carl = await companion(anna.id, "Carl");
    await prisma.tripExpense.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        kind: "food",
        amount: 30,
        currency: "EUR",
        payerCompanionId: carl.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const together = (who: TestAccount) =>
    request(app).get("/api/v1/companions/together").set("Cookie", who.cookie).expect(200);
  const evidence = (who: TestAccount, key: string) =>
    request(app)
      .get(`/api/v1/evidence/ranking/${encodeURIComponent(key)}`)
      .set("Cookie", who.cookie);

  it("counts entries per kind, and the days they cover once", async () => {
    const res = await together(anna);
    expect(res.body.kinds).toEqual(["flight", "trip", "cruise", "rail"]);
    expect(res.body.companions).toHaveLength(1);
    expect(res.body.companions[0]).toMatchObject({
      id: benId,
      name: "Ben",
      entries: 4,
      perKind: { flight: 2, trip: 1, cruise: 0, rail: 1 },
      // 1–8 May from the trip; the flights' and the train's days are inside it.
      days: 8,
      lastTogether: "2025-05-08",
    });
  });

  it("counts the countries the passport's visited rule proves, and abstains without proof", async () => {
    const res = await together(anna);
    expect(res.body.companions[0].countries).toBe(1); // Portugal; Frankfurt is where it began

    // Dana was only on the trip: a trip proves no country, so nothing is claimed.
    const dana = await companion(anna.id, "Dana");
    await prisma.tripCompanion.create({
      data: { tripId: full.trip.id, companionId: dana.id, position: 1 },
    });
    const again = await together(anna);
    const row = again.body.companions.find((c: { id: string }) => c.id === dana.id);
    expect(row).toMatchObject({ entries: 1, days: 8, countries: null });
  });

  it("follows the domain switch: a hidden domain's entries are not counted", async () => {
    await prisma.userSettings.update({
      where: { userId: anna.id },
      data: { enabledDomains: ["flight"] },
    });
    const res = await together(anna);
    expect(res.body.kinds).toEqual(["flight", "trip"]);
    expect(res.body.companions[0]).toMatchObject({ entries: 3, perKind: { flight: 2, trip: 1 } });
    await evidence(anna, `companion:rail:${benId}`).expect(404);
  });

  it("opens each figure's evidence: the days union and the entries behind it", async () => {
    const days = await evidence(anna, `companion:days:${benId}`).expect(200);
    expect(days.body.measure).toMatchObject({ aggregation: "distinct", unit: "days", value: 8 });
    expect(days.body.entries.map((e: { domain: string }) => e.domain).sort()).toEqual([
      "flight",
      "flight",
      "rail",
      "trip",
    ]);

    const countries = await evidence(anna, `companion:countries:${benId}`).expect(200);
    expect(countries.body.measure.value).toBe(1);
    const credited = new Set(
      countries.body.entries.flatMap((e: { credits: string[] }) => e.credits)
    );
    expect([...credited]).toEqual(["PT"]);

    const flights = await evidence(anna, `companion:flight:${benId}`).expect(200);
    expect(flights.body.measure).toMatchObject({ aggregation: "sum", value: 2 });
    expect(flights.body.entries.map((e: { id: string }) => e.id)).toContain(full.flight.id);
  });

  it("answers 404 for another account's companion", async () => {
    const eve = await account("eve", ["flight"]);
    await evidence(eve, `companion:days:${benId}`).expect(404);
    const res = await together(eve);
    expect(res.body.companions).toEqual([]);
  });
});
