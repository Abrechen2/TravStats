import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The evaluation the tester asked for (Discord, 2026-09-26): "Nächte/
 * Aufenthalte pro Programm … Vielleicht ein Link zu einer Liste all dieser
 * Nächte/Aufenthalte". A card's figures are counted per year, and the link
 * behind each figure opens the list filtered to exactly the rows it counted —
 * on the server, before paging, so the page and its total agree.
 */
describe("loyalty figures per year, and the lists behind them", () => {
  const USERS = ["loyaltyfilter", "loyaltyfilterother"];
  let cookie: string;
  let userId: string;
  let otherUserId: string;
  let chainId: number;

  const api = () => request(app);

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

  const hotel = (name: string, chain: number | null) =>
    prisma.lodging.create({ data: { userId, name, type: "hotel", chainId: chain } });

  const stay = (lodgingId: string, checkIn: string, checkOut: string) =>
    prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId,
        checkIn: new Date(`${checkIn}T00:00:00Z`),
        checkOut: new Date(`${checkOut}T00:00:00Z`),
      },
    });

  const wipe = async () => {
    const ids = [userId, otherUserId];
    await prisma.loyaltyMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.flight.deleteMany({ where: { userId: { in: ids } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: ids } } });
  };

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
    chainId = (await prisma.lodgingChain.create({ data: { name: "LoyaltyFilter Chain" } })).id;
  });

  afterEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.lodgingChain.deleteMany({ where: { id: chainId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  describe("flight cards", () => {
    it("files a flight under its departure airport's year, and the list agrees", async () => {
      // 18:00 on New Year's Eve in Los Angeles is 02:00Z on 1 January.
      const newYearsEve = await flight({
        airline: "Lufthansa",
        airlineIata: "LH",
        depIata: "LAX",
        arrIata: "FRA",
        departureTime: new Date("2024-01-01T02:00:00Z"),
      });
      const march = await flight({ airline: "Lufthansa", airlineIata: "LH" });
      const swiss = await flight({ airline: "SWISS", airlineIata: "LX" });
      const card = await prisma.loyaltyMembership.create({
        data: { userId, domain: "flight", programName: "M&M", airlineCodes: ["LH"] },
      });

      const cards = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(cards.body.data[0].activity.years).toEqual([
        { year: 2024, count: 1, nights: null },
        { year: 2023, count: 1, nights: null },
      ]);

      const all = await api().get(`/api/v1/flights?membershipId=${card.id}`).set("Cookie", cookie);
      expect(all.status).toBe(200);
      const ids = all.body.flights.map((f: { id: string }) => f.id).sort();
      expect(ids).toEqual([newYearsEve.id, march.id].sort());
      expect(ids).not.toContain(swiss.id);
      expect(all.body.total).toBe(2);

      const in2023 = await api()
        .get(`/api/v1/flights?membershipId=${card.id}&year=2023`)
        .set("Cookie", cookie);
      expect(in2023.body.flights.map((f: { id: string }) => f.id)).toEqual([newYearsEve.id]);
      expect(in2023.body.total).toBe(1);
    });
  });

  describe("hotel cards", () => {
    it("lists the hotels whose past stays the card counts, per year, paged on the server", async () => {
      const berlin = await hotel("Chain Berlin", chainId);
      const paris = await hotel("Chain Paris", chainId);
      const other = await hotel("Independent Inn", null);
      const future = await hotel("Chain Future", chainId);
      await stay(berlin.id, "2024-05-01", "2024-05-04");
      await stay(paris.id, "2025-02-10", "2025-02-12");
      await stay(other.id, "2025-02-12", "2025-02-13");
      await stay(future.id, "2099-01-01", "2099-01-05");
      const card = await prisma.loyaltyMembership.create({
        data: {
          userId,
          domain: "lodging",
          programName: "Bonvoy",
          chains: { create: [{ chainId }] },
        },
      });

      const cards = await api().get("/api/v1/loyalty-memberships").set("Cookie", cookie);
      expect(cards.body.data[0].activity.years).toEqual([
        { year: 2025, count: 1, nights: 2 },
        { year: 2024, count: 1, nights: 3 },
      ]);

      const all = await api()
        .get(`/api/v1/lodging?membershipId=${card.id}&limit=1`)
        .set("Cookie", cookie);
      expect(all.status).toBe(200);
      // One row on the page, and the total names the whole filtered set: a
      // filter applied after paging would report 1 here, or 4.
      expect(all.body.data).toHaveLength(1);
      expect(all.body.meta.total).toBe(2);

      const in2025 = await api()
        .get(`/api/v1/lodging?membershipId=${card.id}&year=2025`)
        .set("Cookie", cookie);
      expect(in2025.body.data.map((l: { name: string }) => l.name)).toEqual(["Chain Paris"]);
      expect(in2025.body.meta.total).toBe(1);

      const facets = await api()
        .get(`/api/v1/lodging/facets?membershipId=${card.id}`)
        .set("Cookie", cookie);
      expect(facets.status).toBe(200);
    });
  });

  describe("a card that is not there", () => {
    it("answers 404 with a stable code rather than an unfiltered or empty list", async () => {
      const theirs = await prisma.loyaltyMembership.create({
        data: {
          userId: otherUserId,
          domain: "flight",
          programName: "Theirs",
          airlineCodes: ["LH"],
        },
      });
      const hotelCard = await prisma.loyaltyMembership.create({
        data: { userId, domain: "lodging", programName: "Mine" },
      });
      await flight({ airline: "Lufthansa", airlineIata: "LH" });

      for (const url of [
        `/api/v1/flights?membershipId=${theirs.id}`,
        // A hotel card on the flight list is not a flight card.
        `/api/v1/flights?membershipId=${hotelCard.id}`,
        `/api/v1/lodging?membershipId=${theirs.id}`,
        `/api/v1/loyalty-memberships/${theirs.id}`,
      ]) {
        const res = await api().get(url).set("Cookie", cookie);
        expect({ url, status: res.status, code: res.body.code }).toEqual({
          url,
          status: 404,
          code: "LOYALTY_MEMBERSHIP_NOT_FOUND",
        });
      }
    });

    it("reads one of the caller's own cards by id", async () => {
      const card = await prisma.loyaltyMembership.create({
        data: { userId, domain: "flight", programName: "M&M", tier: "Senator" },
      });
      const res = await api().get(`/api/v1/loyalty-memberships/${card.id}`).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ programName: "M&M", tier: "Senator" });
    });
  });
});
