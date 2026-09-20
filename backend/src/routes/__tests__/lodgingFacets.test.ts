/**
 * GET /api/v1/lodging/facets — what the filter bar and the summary strip read
 * once the browser no longer holds the library.
 *
 * Both used to be derived from rows in memory: the year and country dropdowns
 * came from a SECOND, unfiltered `listLodgings` walk (`baseline`), and the
 * strip summed the filtered array. Neither survives server-side paging — a
 * page of twenty-five rows knows nothing about the other three hundred — so
 * both move here.
 *
 * The two properties worth pinning are the ones a facet endpoint gets wrong:
 *
 *  - every facet is counted under the OTHER filters, never under its own.
 *    A country list that shrinks to the one country you already picked is a
 *    dropdown you cannot change your mind in.
 *  - the summary is counted under ALL of them, by the same counting rule the
 *    rows use. "31 Aufenthalte" over a set whose rows add up to 29 is the
 *    disagreement this endpoint exists to make impossible.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { classifyStay } from "../../shared/lodgingCounting";
import { resolveStayTiming } from "../../shared/lodgingTiming";

const USERNAME = "lodgingfacetstest";
const CHAIN_A = "Facet Chain A";
const CHAIN_B = "Facet Chain B";

interface Facets {
  chains: Array<{ id: number; name: string; count: number }>;
  countries: Array<{ value: string; isoCode: string | null; count: number }>;
  years: Array<{ year: number; count: number }>;
  types: Array<{ type: string; count: number }>;
  statuses: Array<{ status: string; count: number }>;
  summary: { lodgings: number; stays: number; nights: number; chains: number };
}

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("GET /api/v1/lodging/facets", () => {
  let authCookie: string;
  let userId: string;
  let chainA: number;
  let chainB: number;

  const facets = async (query: Record<string, string | number> = {}): Promise<Facets> => {
    const res = await request(app)
      .get("/api/v1/lodging/facets")
      .query(query)
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    return res.body.data as Facets;
  };

  beforeAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { user: { username: USERNAME } } });
    await prisma.lodging.deleteMany({ where: { user: { username: USERNAME } } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });

    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });

    chainA = (
      await prisma.lodgingChain.upsert({
        where: { name: CHAIN_A },
        update: {},
        create: { name: CHAIN_A, isUserAdded: true },
      })
    ).id;
    chainB = (
      await prisma.lodgingChain.upsert({
        where: { name: CHAIN_B },
        update: {},
        create: { name: CHAIN_B, isUserAdded: true },
      })
    ).id;

    const one = await prisma.lodging.create({
      data: {
        userId,
        name: "Facet DE Hotel",
        type: "hotel",
        country: "Deutschland",
        isoCountryCode: "DE",
        chainId: chainA,
      },
    });
    const two = await prisma.lodging.create({
      data: {
        userId,
        name: "Facet PT Hostel",
        type: "hostel",
        country: "Portugal",
        isoCountryCode: "PT",
        chainId: chainB,
      },
    });
    const three = await prisma.lodging.create({
      // No resolvable country: the text is a city. It keeps its own entry
      // rather than disappearing from the filter, exactly as the list does.
      data: { userId, name: "Facet Dubai Apartment", type: "apartment", country: "Dubai" },
    });

    await prisma.lodgingStay.createMany({
      data: [
        {
          userId,
          lodgingId: one.id,
          status: "completed",
          checkIn: day("2023-03-01"),
          checkOut: day("2023-03-04"),
          datePrecision: "DAY",
        },
        {
          userId,
          lodgingId: one.id,
          status: "completed",
          checkIn: day("2024-03-01"),
          checkOut: day("2024-03-03"),
          datePrecision: "DAY",
        },
        {
          userId,
          lodgingId: two.id,
          status: "completed",
          checkIn: day("2024-07-01"),
          checkOut: day("2024-07-08"),
          datePrecision: "DAY",
        },
        {
          // Ahead of today: it offers its year to the dropdown, and adds
          // nothing to the nights the summary reports.
          userId,
          lodgingId: three.id,
          status: "scheduled",
          checkIn: day("2030-02-01"),
          checkOut: day("2030-02-20"),
          datePrecision: "DAY",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.lodgingChain.deleteMany({ where: { name: { in: [CHAIN_A, CHAIN_B] } } });
    await prisma.$disconnect();
  });

  it("offers every chain, country, year, type and status with its count", async () => {
    const data = await facets();
    expect(data.chains).toEqual([
      { id: chainA, name: CHAIN_A, count: 1 },
      { id: chainB, name: CHAIN_B, count: 1 },
    ]);
    expect(data.countries).toEqual([
      { value: "DE", isoCode: "DE", count: 1 },
      // A country text that resolves to nothing keeps its own entry, under the
      // text itself — which is also what the list's `country` filter accepts.
      { value: "Dubai", isoCode: null, count: 1 },
      { value: "PT", isoCode: "PT", count: 1 },
    ]);
    expect(data.years).toEqual([
      { year: 2030, count: 1 },
      { year: 2024, count: 2 },
      { year: 2023, count: 1 },
    ]);
    expect(data.types).toEqual([
      { type: "apartment", count: 1 },
      { type: "hostel", count: 1 },
      { type: "hotel", count: 1 },
    ]);
    expect(data.statuses).toEqual([
      { status: "scheduled", count: 1 },
      { status: "completed", count: 2 },
    ]);
  });

  it("counts each facet under the OTHER filters, never under its own", async () => {
    const data = await facets({ country: "DE" });
    // The country list is NOT narrowed to Germany — otherwise the dropdown
    // would hold only the value already chosen and could never be changed.
    expect(data.countries.map((c) => c.value)).toEqual(["DE", "Dubai", "PT"]);
    // Everything else IS narrowed to the German house.
    expect(data.chains).toEqual([{ id: chainA, name: CHAIN_A, count: 1 }]);
    expect(data.years).toEqual([
      { year: 2024, count: 1 },
      { year: 2023, count: 1 },
    ]);
    expect(data.types).toEqual([{ type: "hotel", count: 1 }]);
  });

  it("narrows the country list by a year, and the year list by a country, at the same time", async () => {
    const data = await facets({ year: 2024, country: "PT" });
    // Countries: all houses with a 2024 stay, whatever their country.
    expect(data.countries.map((c) => c.value)).toEqual(["DE", "PT"]);
    // Years: all years of the Portuguese house, whatever the year filter says.
    expect(data.years).toEqual([{ year: 2024, count: 1 }]);
  });

  it("summarises under ALL the filters, by the same rule the rows count by", async () => {
    const all = await facets();
    const stays = await prisma.lodgingStay.findMany({ where: { userId } });
    const counted = stays.filter((s) => classifyStay(s) === "visited");
    expect(all.summary.lodgings).toBe(3);
    expect(all.summary.stays).toBe(counted.length);
    // The figure the totals bar prints, against the TypeScript rule on the
    // same rows — the one number a client could compute for itself and get a
    // different answer to.
    expect(all.summary.nights).toBe(
      counted.reduce((sum, s) => sum + resolveStayTiming(s).nights, 0)
    );
    expect(all.summary.chains).toBe(2);

    const narrowed = await facets({ country: "DE" });
    expect(narrowed.summary).toEqual({ lodgings: 1, stays: 2, nights: 5, chains: 1 });
  });

  it("is a lodging id to nobody — the literal path wins over /:id", async () => {
    const res = await request(app).get("/api/v1/lodging/facets").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("summary");
  });

  it("requires authentication", async () => {
    await request(app).get("/api/v1/lodging/facets").expect(401);
  });
});
