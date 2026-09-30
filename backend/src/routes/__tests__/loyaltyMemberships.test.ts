import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The cross-domain loyalty page (owner, 2026-09-25). One table, three kinds
 * of card; each kind covers something different, and each derives its
 * activity from the logbook through the rules the statistics use.
 */
describe("Loyalty memberships API", () => {
  const USERS = ["loyaltytest", "loyaltyother"];
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;
  let chainId: number;
  let shipId: number;

  const api = () => request(app);
  const wipeLogbook = async () => {
    await prisma.loyaltyMembership.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.cruise.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.railJourney.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  };

  const flight = (o: Record<string, unknown>) =>
    prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "ZRH",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 47.46,
        arrLon: 8.55,
        status: "flown",
        departureTime: new Date("2024-03-10T08:00:00Z"),
        ...o,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
    chainId = (await prisma.lodgingChain.create({ data: { name: "LoyaltyTest Chain" } })).id;
    shipId = (
      await prisma.ship.create({
        data: { name: "LoyaltyTest Ship", cruiseLine: "LoyaltyTest Line", isUserAdded: true },
      })
    ).id;
  });

  afterEach(wipeLogbook);

  afterAll(async () => {
    await wipeLogbook();
    await prisma.ship.deleteMany({ where: { id: shipId } });
    await prisma.lodgingChain.deleteMany({ where: { id: chainId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  describe("writes", () => {
    it("creates a card per domain and lists them grouped by domain", async () => {
      for (const body of [
        { domain: "flight", programName: "Miles & More", airlineCodes: ["lh", "LX", "LH"] },
        { domain: "cruise", programName: "AIDA Club", cruiseLines: ["AIDA", "aida "] },
        { domain: "lodging", programName: "Bonvoy", chainIds: [chainId] },
      ]) {
        const res = await api()
          .post("/api/v1/loyalty-memberships")
          .set("Cookie", cookie)
          .send(body);
        expect(res.status).toBe(201);
      }
      const res = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(res.status).toBe(200);
      const byDomain = Object.fromEntries(
        res.body.data.map((c: { domain: string }) => [c.domain, c])
      );
      // Codes are upper-cased and each kept once; two spellings of a line are one line.
      expect(byDomain.flight.airlineCodes).toEqual(["LH", "LX"]);
      expect(byDomain.cruise.cruiseLines).toEqual(["AIDA"]);
      expect(byDomain.lodging.chainIds).toEqual([chainId]);
    });

    it("refuses another domain's coverage on create and on update", async () => {
      const bad = await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "flight", programName: "X", chainIds: [chainId] });
      expect(bad.status).toBe(400);

      const created = await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "cruise", programName: "Club" });
      const patched = await api()
        .patch(`/api/v1/loyalty-memberships/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ airlineCodes: ["LH"] });
      expect(patched.status).toBe(400);
    });

    it("keeps a card in the domain it was made in", async () => {
      const created = await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "cruise", programName: "Club" });
      const res = await api()
        .patch(`/api/v1/loyalty-memberships/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ domain: "flight" });
      expect(res.status).toBe(400);
    });

    it("allows one name per domain, so a hotel card and a flight card may share it", async () => {
      const send = (domain: string) =>
        api()
          .post("/api/v1/loyalty-memberships")
          .set("Cookie", cookie)
          .send({ domain, programName: "Accor ALL" });
      expect((await send("lodging")).status).toBe(201);
      expect((await send("flight")).status).toBe(201);
      expect((await send("flight")).status).toBe(409);
    });

    it("keeps one current status and no dated history (owner, 2026-09-26)", async () => {
      const created = await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "lodging", programName: "Bonvoy", tier: "Gold" });
      expect(created.status).toBe(201);
      expect(created.body.data.tier).toBe("Gold");
      expect(created.body.data).not.toHaveProperty("tierPeriods");

      const upgraded = await api()
        .patch(`/api/v1/loyalty-memberships/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ tier: "Platinum" });
      expect(upgraded.status).toBe(200);
      expect(upgraded.body.data.tier).toBe("Platinum");

      // A client still sending the retired history is told so, not ignored.
      const history = await api()
        .patch(`/api/v1/loyalty-memberships/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ tierPeriods: [{ tier: "Gold", validFrom: "2024-03-01" }] });
      expect(history.status).toBe(400);
      const stored = await prisma.loyaltyMembership.findUniqueOrThrow({
        where: { id: created.body.data.id },
      });
      expect(stored.tier).toBe("Platinum");
    });
  });

  describe("across accounts", () => {
    it("never lists, edits or deletes another user's card", async () => {
      const theirs = await prisma.loyaltyMembership.create({
        data: {
          userId: otherUserId,
          domain: "flight",
          programName: "Theirs",
          airlineCodes: ["LH"],
        },
      });
      const list = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(list.body.data).toEqual([]);
      const patch = await api()
        .patch(`/api/v1/loyalty-memberships/${theirs.id}`)
        .set("Cookie", cookie)
        .send({ tier: "Mine now" });
      expect(patch.status).toBe(404);
      const del = await api()
        .delete(`/api/v1/loyalty-memberships/${theirs.id}`)
        .set("Cookie", cookie);
      expect(del.status).toBe(404);
      expect(await prisma.loyaltyMembership.findUnique({ where: { id: theirs.id } })).toMatchObject(
        {
          tier: null,
        }
      );
    });

    it("refuses to link another user's hotel", async () => {
      const theirHotel = await prisma.lodging.create({
        data: { userId: otherUserId, name: "Their Hotel", type: "hotel" },
      });
      const res = await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "lodging", programName: "Bonvoy", lodgingIds: [theirHotel.id] });
      expect(res.status).toBe(400);
    });

    it("counts only the caller's own flights as a card's activity", async () => {
      await prisma.flight.create({
        data: {
          userId: otherUserId,
          airline: "Lufthansa",
          airlineIata: "LH",
          depIata: "FRA",
          arrIata: "MUC",
          depLat: 50,
          depLon: 8,
          arrLat: 48,
          arrLon: 11,
          status: "flown",
        },
      });
      await prisma.loyaltyMembership.create({
        data: { userId, domain: "flight", programName: "M&M", airlineCodes: ["LH"] },
      });
      const res = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(res.body.data[0].activity).toEqual({
        count: 0,
        nights: null,
        lastActivity: null,
        years: [],
      });
    });

    it("suggests no card from another user's frequent-flyer numbers", async () => {
      await prisma.flight.create({
        data: {
          userId: otherUserId,
          airlineIata: "LH",
          frequentFlyerNumber: "999",
          depIata: "FRA",
          arrIata: "MUC",
          depLat: 50,
          depLon: 8,
          arrLat: 48,
          arrLon: 11,
        },
      });
      const res = await api().get("/api/v1/loyalty-memberships/suggestions").set("Cookie", cookie);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("activity from the logbook", () => {
    it("counts flights that happened with a covered airline, by airline identity", async () => {
      await flight({ airline: "Lufthansa", airlineIata: "LH" });
      // No code stored: the name resolves to LH through the catalogue.
      await flight({ airline: "Lufthansa", departureTime: new Date("2025-01-02T08:00:00Z") });
      await flight({ airline: "SWISS", airlineIata: "LX" });
      await flight({ airline: "Lufthansa", airlineIata: "LH", status: "scheduled" });
      await flight({ airline: "Lufthansa", airlineIata: "LH", status: "cancelled" });
      await prisma.loyaltyMembership.create({
        data: { userId, domain: "flight", programName: "M&M", airlineCodes: ["LH"] },
      });
      const res = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(res.body.data[0].activity).toEqual({
        count: 2,
        nights: null,
        lastActivity: "2025-01-02",
        years: [
          { year: 2025, count: 1, nights: null },
          { year: 2024, count: 1, nights: null },
        ],
      });
    });

    it("counts cruises on a covered line, the ship's line standing in for a missing one", async () => {
      await prisma.cruise.create({
        data: {
          userId,
          cruiseLine: "LoyaltyTest Line",
          status: "flown",
          startDate: new Date("2024-06-01T00:00:00Z"),
          endDate: new Date("2024-06-08T00:00:00Z"),
        },
      });
      await prisma.cruise.create({
        data: { userId, shipId, status: "historical", startDate: new Date("2023-01-01T00:00:00Z") },
      });
      await prisma.cruise.create({
        data: { userId, cruiseLine: "LoyaltyTest Line", status: "scheduled" },
      });
      await prisma.loyaltyMembership.create({
        data: { userId, domain: "cruise", programName: "Club", cruiseLines: ["loyaltytest line"] },
      });
      const res = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(res.body.data[0].activity).toEqual({
        count: 2,
        nights: 7,
        lastActivity: "2024-06-08",
        // The 2023 cruise names no end, so that year has a cruise and no nights.
        years: [
          { year: 2024, count: 1, nights: 7 },
          { year: 2023, count: 1, nights: null },
        ],
      });
    });

    it("counts past stays at a covered chain, not future or opted-out ones", async () => {
      const hotel = await prisma.lodging.create({
        data: { userId, name: "Chain Hotel", type: "hotel", chainId },
      });
      const stay = (checkIn: string, checkOut: string, extra: Record<string, unknown> = {}) =>
        prisma.lodgingStay.create({
          data: {
            userId,
            lodgingId: hotel.id,
            checkIn: new Date(`${checkIn}T00:00:00Z`),
            checkOut: new Date(`${checkOut}T00:00:00Z`),
            ...extra,
          },
        });
      await stay("2024-05-01", "2024-05-04");
      await stay("2025-02-10", "2025-02-12");
      await stay("2025-03-01", "2025-03-02", { membershipOptOut: true });
      await stay("2099-01-01", "2099-01-05");
      await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "lodging", programName: "Bonvoy", chainIds: [chainId] });
      const res = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(res.body.data[0].activity).toEqual({
        count: 2,
        nights: 5,
        lastActivity: "2025-02-12",
        years: [
          { year: 2025, count: 1, nights: 2 },
          { year: 2024, count: 1, nights: 3 },
        ],
      });
    });
  });

  /**
   * forgejo#132 item 23: a rail programme (BahnBonus) is a card like the
   * others. It covers the counted rides whose operator it names — spelling
   * folded as the rail badges fold it — and nothing another domain owns.
   */
  describe("rail cards", () => {
    const ride = (o: Record<string, unknown>) =>
      prisma.railJourney.create({
        data: {
          userId,
          status: "completed",
          operator: "DB Fernverkehr",
          depStationName: "Frankfurt (Main) Hbf",
          depLat: 50.107,
          depLon: 8.663,
          depTimezone: "Europe/Berlin",
          arrStationName: "Köln Hbf",
          arrLat: 50.943,
          arrLon: 6.959,
          arrTimezone: "Europe/Berlin",
          departureTime: new Date("2024-05-01T08:00:00Z"),
          ...o,
        },
      });

    it("counts completed rides by the card's operators, per year on the station's calendar", async () => {
      await ride({});
      // 23:30 UTC on New Year's Eve is already 2025 in Frankfurt.
      await ride({ operator: "db  fernverkehr", departureTime: new Date("2024-12-31T23:30:00Z") });
      await ride({ operator: "ÖBB" });
      await ride({ status: "cancelled" });
      const created = await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "rail", programName: "BahnBonus", railOperators: ["DB Fernverkehr"] });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        domain: "rail",
        railOperators: ["DB Fernverkehr"],
      });

      const res = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(res.body.data[0].activity).toEqual({
        count: 2,
        nights: null,
        lastActivity: "2025-01-01",
        years: [
          { year: 2025, count: 1, nights: null },
          { year: 2024, count: 1, nights: null },
        ],
      });
    });

    it("refuses another domain's coverage on a rail card, and rail coverage elsewhere", async () => {
      const onRail = await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "rail", programName: "BahnBonus", airlineCodes: ["LH"] });
      expect(onRail.status).toBe(400);
      const onFlight = await api()
        .post("/api/v1/loyalty-memberships")
        .set("Cookie", cookie)
        .send({ domain: "flight", programName: "M&M", railOperators: ["DB Fernverkehr"] });
      expect(onFlight.status).toBe(400);
    });
  });

  describe("frequent-flyer suggestions", () => {
    it("groups one number across airlines and drops numbers a card already holds", async () => {
      await flight({ airline: "Lufthansa", airlineIata: "LH", frequentFlyerNumber: "992 0031" });
      await flight({ airline: "Lufthansa", airlineIata: "LH", frequentFlyerNumber: "9920031" });
      await flight({
        airline: "SWISS",
        airlineIata: "LX",
        frequentFlyerNumber: "9920031",
        departureTime: new Date("2025-07-01T08:00:00Z"),
      });
      await flight({ airline: "Condor", airlineIata: "DE", frequentFlyerNumber: "CD-1" });

      const first = await api()
        .get("/api/v1/loyalty-memberships/suggestions")
        .set("Cookie", cookie);
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(2);
      const mm = first.body.data[0];
      expect(mm.flightCount).toBe(3);
      expect(mm.lastUsed).toBe("2025-07-01");
      expect(mm.airlines.map((a: { code: string }) => a.code)).toEqual(["LH", "LX"]);

      await prisma.loyaltyMembership.create({
        data: { userId, domain: "flight", programName: "Condor", membershipNumber: "cd-1" },
      });
      const second = await api()
        .get("/api/v1/loyalty-memberships/suggestions")
        .set("Cookie", cookie);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.data[0].flightCount).toBe(3);
    });
  });

  describe("the lodging view of the same table", () => {
    it("shows hotel cards only, and a stay cannot name a flight card", async () => {
      const flightCard = await prisma.loyaltyMembership.create({
        data: { userId, domain: "flight", programName: "M&M", airlineCodes: ["LH"] },
      });
      await prisma.loyaltyMembership.create({
        data: { userId, domain: "lodging", programName: "Bonvoy" },
      });
      const list = await api().get("/api/v1/lodging-memberships").set("Cookie", cookie);
      expect(list.body.data.map((m: { programName: string }) => m.programName)).toEqual(["Bonvoy"]);

      const patch = await api()
        .patch(`/api/v1/lodging-memberships/${flightCard.id}`)
        .set("Cookie", cookie)
        .send({ tier: "Gold" });
      expect(patch.status).toBe(404);

      const hotel = await prisma.lodging.create({
        data: { userId, name: "Somewhere", type: "hotel" },
      });
      const stay = await api()
        .post(`/api/v1/lodging/${hotel.id}/stays`)
        .set("Cookie", cookie)
        .send({ checkIn: "2024-01-01", checkOut: "2024-01-03", membershipId: flightCard.id });
      expect(stay.status).toBe(404);
    });
  });
});
