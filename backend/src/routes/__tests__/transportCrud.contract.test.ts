/**
 * The CRUD skeleton rail, bus, ferry and rental share (forgejo#382): list
 * page, delete, concurrent edit and receipt filing, driven through the real
 * routers so a shared implementation cannot change what any of them answers.
 *
 * The list snapshots record the TYPE of every field, not its value: the
 * response shape (ADR 0001) is what must stay byte-identical per router.
 */
jest.mock("../../services/fx/snapshot", () => {
  const actual = jest.requireActual("../../services/fx/snapshot");
  return { ...actual, fxColumnsFor: jest.fn(async () => actual.CLEARED_FX_COLUMNS) };
});
jest.mock("../../services/schematicRouter", () => ({
  ...jest.requireActual("../../services/schematicRouter"),
  computeSchematicRoute: jest.fn(async () => ({
    waypoints: [],
    protectedPrefixCount: 0,
    protectedSuffixCount: 0,
    routed: false,
    method: "straight",
  })),
}));
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  busCreationLimiter,
  railCreationLimiter,
  rentalCreationLimiter,
} from "../../middleware/rateLimit";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";

const A = { name: "Alpha Terminal", lat: 37.5048, lon: 127.0046, country: "KR" };
const B = { name: "Beta Terminal", lat: 38.1911, lon: 128.5918, country: "KR" };
const STATIONS = {
  departureStation: A,
  arrivalStation: B,
  departureLocal: "2026-09-20T09:00",
  arrivalLocal: "2026-09-20T11:20",
};

interface Domain {
  name: string;
  path: string;
  body: Record<string, unknown>;
  delegate: "railJourney" | "busJourney" | "ferryJourney" | "rentalBooking";
  docColumn: string;
  limiter: { resetKey: (key: string) => unknown };
  notFound: string;
}

const DOMAINS: Domain[] = [
  {
    name: "rail",
    path: "/api/v1/rail",
    body: { operator: "Rail Co", trainNumber: "1", ...STATIONS },
    delegate: "railJourney",
    docColumn: "railJourneyId",
    limiter: railCreationLimiter,
    notFound: "Rail journey not found",
  },
  {
    name: "bus",
    path: "/api/v1/bus",
    body: { operator: "Bus Co", ...STATIONS },
    delegate: "busJourney",
    docColumn: "busJourneyId",
    limiter: busCreationLimiter,
    notFound: "Bus ride not found",
  },
  {
    name: "ferry",
    path: "/api/v1/ferry",
    body: { operator: "Ferry Co", vesselName: "Vessel", ...STATIONS },
    delegate: "ferryJourney",
    docColumn: "ferryJourneyId",
    limiter: ferryCreationLimiter,
    notFound: "Ferry ride not found",
  },
  {
    name: "rental",
    path: "/api/v1/rentals",
    body: {
      provider: "Testcar",
      confirmationNumber: "1234567890",
      pickupStation: { name: "Stadtbüro", lat: 48.137, lon: 11.575 },
      pickupLocal: "2026-07-01T10:00",
      returnLocal: "2026-07-05T09:30",
    },
    delegate: "rentalBooking",
    docColumn: "rentalBookingId",
    limiter: rentalCreationLimiter,
    notFound: "Rental not found",
  },
];

/** Every key with the type of its value, arrays by their first element. */
function shapeOf(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "[]" : [shapeOf(value[0])];
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shapeOf(v)])
    );
  }
  return typeof value;
}

describe("Transport CRUD skeleton (forgejo#382)", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;

  beforeAll(async () => {
    const names = ["tcrudtest", "tcrudother"];
    await prisma.user.deleteMany({ where: { username: { in: names } } });
    const user = await prisma.user.create({
      data: { username: names[0], passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({
      data: { username: names[1], passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterEach(async () => {
    const owners = { userId: { in: [userId, otherUserId] } };
    await prisma.document.deleteMany({ where: owners });
    await prisma.railJourney.deleteMany({ where: owners });
    await prisma.busJourney.deleteMany({ where: owners });
    await prisma.ferryJourney.deleteMany({ where: owners });
    await prisma.rentalBooking.deleteMany({ where: owners });
    for (const d of DOMAINS) {
      await d.limiter.resetKey(`user:${userId}`);
      await d.limiter.resetKey(`user:${otherUserId}`);
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  const create = (d: Domain, extra: Record<string, unknown> = {}, as = cookie) =>
    request(app)
      .post(d.path)
      .set("Cookie", as)
      .send({ ...d.body, ...extra });

  const makeDocument = (tag: string) =>
    prisma.document.create({
      data: {
        userId,
        storedName: `${tag}.pdf`,
        mimetype: "application/pdf",
        sizeBytes: 10,
        sha256: tag.padEnd(64, "0"),
        format: "pdf",
      },
    });

  describe.each(DOMAINS)("$name", (d) => {
    it("keeps the list page response shape (data, meta.total/limit/offset/summary)", async () => {
      expect((await create(d)).status).toBe(201);
      const res = await request(app).get(d.path).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(["data", "meta", "success"]);
      expect(res.body.data).toHaveLength(1);
      expect(shapeOf({ ...res.body, data: res.body.data[0] })).toMatchSnapshot();
    });

    it("pages with limit/offset and reports the unpaged total", async () => {
      await create(d);
      await create(d);
      const res = await request(app).get(`${d.path}?limit=1&offset=1`).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toMatchObject({ total: 2, limit: 1, offset: 1 });
    });

    it("lists only the caller's own rows", async () => {
      await create(d);
      const res = await request(app).get(d.path).set("Cookie", otherCookie);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it("deletes with 204, then answers the domain's own 404 body", async () => {
      const id = (await create(d)).body.data.id;
      await request(app).delete(`${d.path}/${id}`).set("Cookie", cookie).expect(204);
      const again = await request(app).delete(`${d.path}/${id}`).set("Cookie", cookie);
      expect(again.status).toBe(404);
      expect(again.body.error).toBe(d.notFound);
    });

    it("answers a stranger's delete with 404 and keeps the row", async () => {
      const id = (await create(d)).body.data.id;
      await request(app).delete(`${d.path}/${id}`).set("Cookie", otherCookie).expect(404);
      await request(app).get(`${d.path}/${id}`).set("Cookie", cookie).expect(200);
    });

    it("lets exactly one of two concurrent edits on the same version through (409 for the other)", async () => {
      const row = (await create(d)).body.data;
      const edit = (notes: string) =>
        request(app)
          .patch(`${d.path}/${row.id}`)
          .set("Cookie", cookie)
          .send({ notes, baseVersion: row.updatedAt });
      const replies = await Promise.all([edit("one"), edit("two")]);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = replies.find((r) => r.status === 409)!;
      expect(loser.body.code).toBe("VERSION_CONFLICT");
      expect(loser.body.id).toBe(row.id);
    });

    it("refuses a stale edit and a stale delete, and keeps the row untouched", async () => {
      const row = (await create(d)).body.data;
      await request(app)
        .patch(`${d.path}/${row.id}`)
        .set("Cookie", cookie)
        .send({ notes: "first", baseVersion: row.updatedAt })
        .expect(200);
      await request(app)
        .delete(`${d.path}/${row.id}`)
        .set("Cookie", cookie)
        .set("If-Match", row.updatedAt)
        .expect(409);
      await request(app).get(`${d.path}/${row.id}`).set("Cookie", cookie).expect(200);
    });

    it("keeps unconditional edits working for a client that sends no version", async () => {
      const row = (await create(d)).body.data;
      const res = await request(app)
        .patch(`${d.path}/${row.id}`)
        .set("Cookie", cookie)
        .send({ notes: "no version" });
      expect(res.status).toBe(200);
    });

    it("files a receipt with the new entry, and refuses one already filed elsewhere", async () => {
      const doc = await makeDocument(`${d.name}-a`);
      const created = await create(d, { documentIds: [doc.id] });
      expect(created.status).toBe(201);
      const filed = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      expect((filed as unknown as Record<string, unknown>)[d.docColumn]).toBe(created.body.data.id);

      const again = await create(d, { documentIds: [doc.id] });
      expect(again.status).toBe(409);
      const count = await (
        prisma[d.delegate] as unknown as { count: (a: unknown) => Promise<number> }
      ).count({ where: { userId } });
      expect(count).toBe(1);
    });

    it("refuses a create naming a stranger's document, and writes no row", async () => {
      const doc = await prisma.document.create({
        data: {
          userId: otherUserId,
          storedName: `${d.name}-x.pdf`,
          mimetype: "application/pdf",
          sizeBytes: 10,
          sha256: `${d.name}-x`.padEnd(64, "0"),
          format: "pdf",
        },
      });
      const res = await create(d, { documentIds: [doc.id] });
      expect(res.status).toBeGreaterThanOrEqual(400);
      const count = await (
        prisma[d.delegate] as unknown as { count: (a: unknown) => Promise<number> }
      ).count({ where: { userId } });
      expect(count).toBe(0);
    });
  });
});
