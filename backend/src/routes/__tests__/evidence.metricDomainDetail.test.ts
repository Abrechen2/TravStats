import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence for the POPULATIONS behind the cruise tab's rhythm and
 * fun tiles and the lodging tab's money, loyalty, quality and geography tiles
 * (forgejo#257/#258). Each tile shows an average, a share or an extreme, and
 * opens the set its figure is read from — so what this suite pins is the SET:
 * which entry is in, what it carries, and that the measure's value is the
 * figure the tab's own endpoint reports where it reports one.
 *
 * Cruises (all user A's):
 *   - "Nordland", sailed, 1–5 March 2024, deck 9, on a trip, three listed
 *     port calls and one sea day.
 *   - "Ostsee kurz", sailed, 10–12 January 2025, no deck, two port calls.
 *   - "Costa Fortuna", BOOKED for June 2027 — on the cruise list, so in
 *     these blocks, though in no rollup figure.
 *   - "Ohne Datum", cancelled and undated: in the list, in no dated figure.
 *
 * Stays (2024): Rheinblick (chain "Rhein Hotels", 3 nights, 300 EUR, four
 * ratings, located), Rheinblick again (award night, chain), Sakura Inn (no
 * chain, 2 nights, 40000 JPY nothing converts, overall rating only, located),
 * Casa Verde (independent, no coordinates, 2 nights, 100 EUR, month
 * precision).
 */
describe("GET /api/v1/evidence/metric/... — the populations behind averages and extremes", () => {
  let userId: string;
  let cookie: string;
  const ids: Record<string, string> = {};
  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  interface EvidenceBody {
    measure: { value: number | null; unit: string; aggregation: string };
    entries: Array<{
      id: string;
      domain: string;
      contribution?: number;
      subtitle?: { key?: string; text?: string; values?: Record<string, string | number> } | null;
    }>;
    omitted: { count: number; contribution?: number };
    unattributed: Array<{ count: number; reason: string }>;
  }

  const get = async (key: string, query = ""): Promise<EvidenceBody> => {
    const res = await request(app)
      .get(`/api/v1/evidence/metric/${key}${query}`)
      .set("Cookie", cookie);
    expect([key, res.status]).toEqual([key, 200]);
    const body = res.body as EvidenceBody;
    assertSumInvariant(body as never, Math.round);
    return body;
  };
  /** The lodging tab's own figures (`GET /stats/lodging`, an enveloped router). */
  const lodgingTab = async (): Promise<{
    staysCount: number;
    price: { pricedNights: number };
    geo: { unlocatedStays: number };
  }> => {
    const res = await request(app).get("/api/v1/stats/lodging").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.data ?? res.body;
  };
  const split = (body: EvidenceBody): Record<string, number> =>
    Object.fromEntries(body.entries.map((e) => [e.id, e.contribution ?? 0]));

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencedetail" } });
    const user = await prisma.user.create({
      data: { username: "evidencedetail", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen 2024" } });
    const [hamburg, oslo] = await Promise.all(
      [
        { name: "Hamburg D", unlocode: "DEHDX", lat: 53.54, lon: 9.98 },
        { name: "Oslo D", unlocode: "NOODX", lat: 59.9, lon: 10.75 },
      ].map((p) =>
        prisma.port.upsert({
          where: { unlocode: p.unlocode },
          update: {},
          create: { ...p, city: p.name, country: "Norway", region: "baltic", isUserAdded: true },
        })
      )
    );

    ids.nordland = (
      await prisma.cruise.create({
        data: {
          userId,
          status: "completed",
          routeName: "Nordland",
          deck: 9,
          tripId: trip.id,
          startDate: day("2024-03-01"),
          endDate: day("2024-03-05"),
          stops: {
            create: [
              { dayNumber: 1, portId: hamburg.id, isAtSea: false },
              { dayNumber: 2, isAtSea: true },
              { dayNumber: 3, portId: oslo.id, isAtSea: false },
              { dayNumber: 4, isAtSea: false, unresolvedPortName: "Geirangerfjord" },
            ],
          },
        },
      })
    ).id;
    ids.ostsee = (
      await prisma.cruise.create({
        data: {
          userId,
          status: "completed",
          routeName: "Ostsee kurz",
          startDate: day("2025-01-10"),
          endDate: day("2025-01-12"),
          stops: {
            create: [
              { dayNumber: 1, portId: oslo.id, isAtSea: false },
              { dayNumber: 2, portId: hamburg.id, isAtSea: false },
            ],
          },
        },
      })
    ).id;
    ids.booked = (
      await prisma.cruise.create({
        data: {
          userId,
          status: "scheduled",
          routeName: "Costa Fortuna",
          deck: 12,
          startDate: day("2027-06-01"),
          endDate: day("2027-06-08"),
        },
      })
    ).id;
    ids.undated = (
      await prisma.cruise.create({ data: { userId, status: "cancelled", routeName: "Ohne Datum" } })
    ).id;

    const chain = await prisma.lodgingChain.create({
      data: { name: "Rhein Hotels", userId, isUserAdded: true },
    });
    const lodging = (name: string, extra: Record<string, unknown>) =>
      prisma.lodging.create({
        data: { userId, name, type: "hotel", visited: true, ...extra },
      });
    const rheinblick = await lodging("Rheinblick", {
      chainId: chain.id,
      country: "Germany",
      isoCountryCode: "DE",
      lat: 50.9375,
      lon: 6.9603,
    });
    const sakura = await lodging("Sakura Inn", {
      country: "Japan",
      isoCountryCode: "JP",
      lat: 35.0116,
      lon: 135.7681,
    });
    const casa = await lodging("Casa Verde", { country: "Spain", isoCountryCode: "ES" });

    const stay = (lodgingId: string, data: Record<string, unknown>) =>
      prisma.lodgingStay.create({
        data: { userId, lodgingId, status: "completed", datePrecision: "DAY", ...data },
      });
    ids.rheinLong = (
      await stay(rheinblick.id, {
        checkIn: day("2024-03-10"),
        checkOut: day("2024-03-13"),
        totalPrice: 300,
        currency: "EUR",
        ratingOverall: 4,
        ratingRoom: 5,
        ratingBreakfast: 3,
        ratingService: 4,
      })
    ).id;
    ids.rheinAward = (
      await stay(rheinblick.id, {
        checkIn: day("2024-03-20"),
        checkOut: day("2024-03-21"),
        isAwardStay: true,
        totalPrice: 0,
        currency: "EUR",
      })
    ).id;
    ids.sakura = (
      await stay(sakura.id, {
        checkIn: day("2024-05-01"),
        checkOut: day("2024-05-03"),
        totalPrice: 40000,
        currency: "JPY",
        ratingOverall: 5,
      })
    ).id;
    ids.casa = (
      await stay(casa.id, {
        checkIn: day("2024-07-01"),
        checkOut: day("2024-07-31"),
        datePrecision: "MONTH",
        nights: 2,
        totalPrice: 100,
        currency: "EUR",
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencedetail" } });
  });

  describe("cruise list (rhythm and fun)", () => {
    it("dated cruises: every cruise on the list with a start date, booked ones too", async () => {
      const body = await get("cruiseDatedCount");
      expect(split(body)).toEqual({ [ids.nordland]: 1, [ids.ostsee]: 1, [ids.booked]: 1 });
      expect(body.measure).toMatchObject({ value: 3, unit: "cruises", aggregation: "sum" });
    });

    it("nights per cruise with both dates — the average, longest and shortest", async () => {
      const body = await get("cruiseNightsTotal");
      expect(split(body)).toEqual({ [ids.nordland]: 4, [ids.ostsee]: 2, [ids.booked]: 7 });
    });

    it("listed port calls: sea days out, an unresolved call in, empty itineraries absent", async () => {
      const body = await get("cruiseListedPortCallsTotal");
      expect(split(body)).toEqual({ [ids.nordland]: 3, [ids.ostsee]: 2 });
    });

    it("a recorded deck names itself", async () => {
      const body = await get("cruiseDeckRecordedCount");
      expect(split(body)).toEqual({ [ids.nordland]: 1, [ids.booked]: 1 });
      const nordland = body.entries.find((e) => e.id === ids.nordland)!;
      expect(nordland.subtitle).toEqual({ key: "evidence.subtitle.deck", values: { deck: 9 } });
    });

    it("cruises on a trip, and the year a cruise started in scopes all of them", async () => {
      expect(split(await get("cruiseOnTripCount"))).toEqual({ [ids.nordland]: 1 });
      expect(split(await get("cruiseDatedCount", "?period=year&year=2025"))).toEqual({
        [ids.ostsee]: 1,
      });
    });
  });

  describe("lodging populations", () => {
    it("priced nights: a comparable price per night, award stays in, unconvertible out", async () => {
      const body = await get("lodgingPricedNightsTotal");
      expect(split(body)).toEqual({ [ids.rheinLong]: 3, [ids.rheinAward]: 1, [ids.casa]: 2 });
      const long = body.entries.find((e) => e.id === ids.rheinLong)!;
      expect(long.subtitle).toEqual({
        key: "evidence.subtitle.pricePerNight",
        values: { amount: 100, currency: "EUR" },
      });
      const award = body.entries.find((e) => e.id === ids.rheinAward)!;
      expect(award.subtitle?.key).toBe("evidence.subtitle.pricePerNightAward");

      expect(body.measure.value).toBe((await lodgingTab()).price.pricedNights);
    });

    it("paid nights leave the award stay out — it is what they value", async () => {
      expect(split(await get("lodgingPaidNightsTotal"))).toEqual({
        [ids.rheinLong]: 3,
        [ids.casa]: 2,
      });
    });

    it("chain nights name their chain; the top chain's nights are its own", async () => {
      const chain = await get("lodgingChainNightsTotal");
      expect(split(chain)).toEqual({ [ids.rheinLong]: 3, [ids.rheinAward]: 1 });
      expect(chain.entries[0].subtitle).toEqual({ text: "Rhein Hotels" });
      const top = await get("lodgingTopChainNights");
      expect(top.measure.value).toBe(4);
    });

    it("rated stays carry all four ratings, a blank one as a dash", async () => {
      const body = await get("lodgingRatedStaysCount");
      expect(split(body)).toEqual({ [ids.rheinLong]: 1, [ids.sakura]: 1 });
      const sakura = body.entries.find((e) => e.id === ids.sakura)!;
      expect(sakura.subtitle).toEqual({
        key: "evidence.subtitle.ratings",
        values: { overall: 5, room: "–", breakfast: "–", service: "–" },
      });
    });

    it("located stays: coordinates and the night weight, the unlocated house absent", async () => {
      const body = await get("lodgingLocatedStaysCount");
      expect(split(body)).toEqual({ [ids.rheinLong]: 1, [ids.rheinAward]: 1, [ids.sakura]: 1 });
      const tab = await lodgingTab();
      expect(body.measure.value).toBe(tab.staysCount - tab.geo.unlocatedStays);
    });
  });
});
