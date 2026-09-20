/**
 * GET /api/v1/lodging — the page comes from the database, not from the set.
 *
 * Until 2026-09-20 this handler loaded every lodging of the account with every
 * stay, derived nights/rating/spend in JavaScript, sorted the array and sliced
 * the page out of it. The answers were right; the work was the whole library
 * per request, and the browser's client compounded it by walking `limit=500`
 * pages until exhausted, so twenty-five rows on screen cost two full reads.
 *
 * These tests are the ones that would have failed on the way here. They check
 * the properties a client can actually observe, because the point of the change
 * is that they do NOT change: the same order, the same totals, the same rows —
 * only bounded. The two that are new say so in their titles.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import type { Prisma } from "../../prisma";

const USERNAME = "lodginglisttest";
const OTHER = "lodginglistother";
const CHAIN = "Parity Chain Test";

interface ListRow {
  id: string;
  name: string;
  nights: number;
  stayCount: number;
  overallRating: number | null;
  totalSpendBase: number;
}
interface ListBody {
  success: boolean;
  data: ListRow[];
  meta: { total: number; limit: number; offset: number };
}

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("GET /api/v1/lodging — server-side paging, sorting and filtering", () => {
  let authCookie: string;
  let userId: string;
  let otherUserId: string;
  let chainId: number;

  const list = async (query: Record<string, string | number>): Promise<ListBody> => {
    const res = await request(app).get("/api/v1/lodging").query(query).set("Cookie", authCookie);
    expect(res.status).toBe(200);
    return res.body as ListBody;
  };
  const names = (body: ListBody): string[] => body.data.map((r) => r.name);

  beforeAll(async () => {
    await prisma.lodgingStay.deleteMany({
      where: { user: { username: { in: [USERNAME, OTHER] } } },
    });
    await prisma.lodging.deleteMany({ where: { user: { username: { in: [USERNAME, OTHER] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [USERNAME, OTHER] } } });

    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });

    const other = await prisma.user.create({
      data: { username: OTHER, passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;

    const chain = await prisma.lodgingChain.upsert({
      where: { name: CHAIN },
      update: {},
      create: { name: CHAIN, isUserAdded: true },
    });
    chainId = chain.id;

    // Four houses whose figures deliberately disagree with their row order, so
    // a sort that silently fell back to "whatever the database returned" would
    // be visible rather than plausible.
    const houses: Array<{
      name: string;
      data?: Partial<Prisma.LodgingUncheckedCreateInput>;
      stays: Array<Partial<Prisma.LodgingStayUncheckedCreateInput>>;
    }> = [
      {
        // 5 nights that count, 300 EUR, rating 4, last stay 2024-05-06.
        name: "Alpha Haus",
        data: { city: "Bern", country: "CH", isoCountryCode: "CH", chainId },
        stays: [
          {
            status: "completed",
            checkIn: day("2024-05-01"),
            checkOut: day("2024-05-06"),
            totalPrice: 300,
            currency: "EUR",
            ratingOverall: 4,
          },
        ],
      },
      {
        // A booking for the future: it names the newest date, and contributes
        // nothing to nights, stays or spend. Both halves are the counting rule.
        name: "Beta Lodge",
        data: { city: "Oslo", country: "NO", isoCountryCode: "NO" },
        stays: [
          {
            status: "completed",
            checkIn: day("2023-01-01"),
            checkOut: day("2023-01-03"),
            totalPrice: 100,
            currency: "EUR",
            ratingOverall: 2,
          },
          {
            status: "scheduled",
            checkIn: day("2030-01-01"),
            checkOut: day("2030-01-20"),
            totalPrice: 5000,
            currency: "EUR",
          },
        ],
      },
      {
        // Undated but recorded: 7 nights, no anchor at all, so it sorts last on
        // the date key in both directions.
        name: "Gamma Pension",
        data: { city: "Porto", country: "PT", isoCountryCode: "PT" },
        stays: [
          {
            status: "completed",
            checkIn: null,
            checkOut: null,
            datePrecision: "NONE",
            nights: 7,
            totalPrice: 700,
            currency: "EUR",
            ratingOverall: 5,
          },
        ],
      },
      {
        // Bookmarked only: no stays, so every derived figure is zero or absent.
        name: "Delta Bookmark",
        data: { city: "Lisbon", country: "PT", isoCountryCode: "PT", visited: false },
        stays: [],
      },
    ];

    for (const house of houses) {
      const lodging = await prisma.lodging.create({
        data: { userId, name: house.name, ...house.data },
      });
      for (const stay of house.stays) {
        await prisma.lodgingStay.create({
          data: {
            userId,
            lodgingId: lodging.id,
            datePrecision: "DAY",
            ...stay,
          } as Prisma.LodgingStayUncheckedCreateInput,
        });
      }
    }

    // Another account's house with a name that would match every search here —
    // the filter must never reach it.
    await prisma.lodging.create({ data: { userId: otherUserId, name: "Alpha Haus (foreign)" } });
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.lodgingChain.deleteMany({ where: { name: CHAIN } });
    await prisma.$disconnect();
  });

  describe("the page is a page", () => {
    it("answers with only the rows asked for, and the unsliced total beside them", async () => {
      const body = await list({ limit: 2, offset: 0, sort: "name", order: "asc" });
      expect(names(body)).toEqual(["Alpha Haus", "Beta Lodge"]);
      expect(body.meta).toEqual({ total: 4, limit: 2, offset: 0 });
    });

    it("walks the same order across pages, skipping and repeating nothing", async () => {
      const whole = await list({ limit: 100, sort: "nights", order: "desc" });
      const walked: string[] = [];
      for (let offset = 0; offset < whole.meta.total; offset += 1) {
        const page = await list({ limit: 1, offset, sort: "nights", order: "desc" });
        walked.push(...names(page));
      }
      expect(walked).toEqual(names(whole));
      expect(new Set(walked).size).toBe(walked.length);
    });

    it("never carries another account's house, whatever it is sorted or filtered by", async () => {
      // The ids come from a query already scoped to the account; the read that
      // turns them into rows asks again, because a foreign key proves
      // existence and not ownership, and that read cannot see where its ids
      // came from.
      for (const sort of ["name", "nights", "spend", "rating", "lastStay", "status"]) {
        const body = await list({ limit: 100, sort });
        expect(names(body)).not.toContain("Alpha Haus (foreign)");
        expect(body.meta.total).toBe(4);
      }
    });

    it("still reports the total for a page past the end of the set", async () => {
      // `COUNT(*) OVER ()` rides on the rows, so an empty page carries none —
      // answering 0 would tell a client that had paged too far that its filter
      // matches nothing.
      const body = await list({ limit: 10, offset: 999, sort: "name" });
      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(4);
    });
  });

  describe("the derived sort keys, computed over the stays that COUNT", () => {
    it("orders by nights, ignoring the nights of a booking that has not happened", async () => {
      // Beta Lodge's 19 future nights would put it first if the sort counted
      // them; the rule is that a stay counts once its check-out is past.
      const body = await list({ sort: "nights", order: "desc" });
      expect(names(body)).toEqual(["Gamma Pension", "Alpha Haus", "Beta Lodge", "Delta Bookmark"]);
      expect(body.data.map((r) => r.nights)).toEqual([7, 5, 2, 0]);
    });

    it("orders by spend in the base currency, excluding the unhappened booking", async () => {
      const body = await list({ sort: "spend", order: "desc" });
      expect(names(body)).toEqual(["Gamma Pension", "Alpha Haus", "Beta Lodge", "Delta Bookmark"]);
      expect(body.data.map((r) => r.totalSpendBase)).toEqual([700, 300, 100, 0]);
    });

    it("orders by rating and sorts the unrated below every real rating", async () => {
      const body = await list({ sort: "rating", order: "desc" });
      expect(names(body)).toEqual(["Gamma Pension", "Alpha Haus", "Beta Lodge", "Delta Bookmark"]);
      expect(body.data.map((r) => r.overallRating)).toEqual([5, 4, 2, null]);
    });

    it("orders by the newest stay, planned included, and keeps the undated last both ways", async () => {
      const descending = await list({ sort: "lastStay", order: "desc" });
      expect(names(descending).slice(0, 2)).toEqual(["Beta Lodge", "Alpha Haus"]);
      expect(names(descending).slice(2)).toEqual(["Delta Bookmark", "Gamma Pension"]);

      const ascending = await list({ sort: "lastStay", order: "asc" });
      expect(names(ascending).slice(0, 2)).toEqual(["Alpha Haus", "Beta Lodge"]);
      // Not "the oldest thing in the library" — no date at all, so still last.
      expect(names(ascending).slice(2)).toEqual(["Delta Bookmark", "Gamma Pension"]);
    });

    it("accepts `checkIn`, the old spelling of the date sort, unchanged", async () => {
      const legacy = await list({ sort: "checkIn" });
      const current = await list({ sort: "lastStay" });
      expect(names(legacy)).toEqual(names(current));
    });

    it("orders by the status pill's own rank, booked before past before stayless", async () => {
      const body = await list({ sort: "status", order: "asc" });
      expect(names(body)).toEqual([
        "Beta Lodge", // has a scheduled stay
        "Alpha Haus",
        "Gamma Pension",
        "Delta Bookmark", // no stays at all
      ]);
    });
  });

  describe("the filters, applied to the set rather than to the page", () => {
    it("searches the house, its chain and its town — and never another account's", async () => {
      expect(names(await list({ search: "alpha" }))).toEqual(["Alpha Haus"]);
      expect(names(await list({ search: "Parity Chain" }))).toEqual(["Alpha Haus"]);
      expect(names(await list({ search: "porto" }))).toEqual(["Gamma Pension"]);
      expect((await list({ search: "alpha" })).meta.total).toBe(1);
    });

    it("treats a percent sign in the search as a character, not a wildcard", async () => {
      expect(await list({ search: "%" }).then(names)).toEqual([]);
    });

    it("filters by the lifecycle status over the whole house", async () => {
      expect(names(await list({ status: "scheduled" }))).toEqual(["Beta Lodge"]);
      const completed = await list({ status: "completed", sort: "name", order: "asc" });
      expect(names(completed)).toEqual(["Alpha Haus", "Gamma Pension"]);
      expect(completed.meta.total).toBe(2);
    });

    it("filters by country through the derived ISO code", async () => {
      const body = await list({ country: "PT", sort: "name", order: "asc" });
      expect(names(body)).toEqual(["Delta Bookmark", "Gamma Pension"]);
    });

    it("selects houses by year WITHOUT narrowing the figures they report", async () => {
      // Beta Lodge is here for its 2023 stay; the nights it reports are still
      // its own total, not 2023's. Folding the year into the stay join is the
      // mistake this pins.
      const body = await list({ year: 2023 });
      expect(names(body)).toEqual(["Beta Lodge"]);
      expect(body.data[0].nights).toBe(2);
      expect(body.data[0].stayCount).toBe(1);
    });
  });
});
