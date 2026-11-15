import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { BULK_EDIT_PATHS, type BulkDomain } from "../../schemas/domainBulkEdit";
import * as propagation from "../../services/sharing/propagate";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * forgejo#405 A4 — the flights bulk edit on rail, bus, ferry, rentals, cruises
 * and stays. One result per row, a foreign id is refused like a missing one, a
 * moved-on row answers VERSION_CONFLICT, and the members' copies follow.
 */

const PAST = new Date("2024-05-01T08:00:00Z");
const PAST_END = new Date("2024-05-01T10:00:00Z");
const ride = {
  depStationName: "A",
  depLat: 50,
  depLon: 8,
  depTimezone: "Europe/Berlin",
  arrStationName: "B",
  arrLat: 51,
  arrLon: 9,
  arrTimezone: "Europe/Berlin",
  departureTime: PAST,
  arrivalTime: PAST_END,
};
const station = {
  pickupStationName: "P",
  pickupLat: 41.9,
  pickupLon: 12.5,
  pickupTimezone: "Europe/Rome",
  returnStationName: "P",
  returnLat: 41.9,
  returnLon: 12.5,
  returnTimezone: "Europe/Rome",
};

type Make = (userId: string, over?: Record<string, unknown>) => Promise<{ id: string }>;

async function stayRow(userId: string, over: Record<string, unknown> = {}) {
  const lodging = await prisma.lodging.create({ data: { userId, name: "Casa" } });
  return prisma.lodgingStay.create({
    data: {
      userId,
      lodgingId: lodging.id,
      checkIn: new Date("2024-05-01T00:00:00Z"),
      checkOut: new Date("2024-05-03T00:00:00Z"),
      status: "completed",
      ...over,
    },
  });
}

const MAKE: Record<BulkDomain, Make> = {
  rail: (userId, over) =>
    prisma.railJourney.create({ data: { userId, status: "completed", ...ride, ...over } }),
  bus: (userId, over) =>
    prisma.busJourney.create({ data: { userId, status: "completed", ...ride, ...over } }),
  ferry: (userId, over) =>
    prisma.ferryJourney.create({ data: { userId, status: "completed", ...ride, ...over } }),
  rental: (userId, over) =>
    prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Testcar",
        ...station,
        pickupTime: PAST,
        returnTime: PAST_END,
        status: "completed",
        ...over,
      },
    }),
  cruise: (userId, over) =>
    prisma.cruise.create({
      data: {
        userId,
        startDate: new Date("2024-05-01T00:00:00Z"),
        endDate: new Date("2024-05-03T00:00:00Z"),
        status: "completed",
        ...over,
      },
    }),
  stay: stayRow,
};

const READ: Record<BulkDomain, (id: string) => Promise<Record<string, unknown> | null>> = {
  rail: (id) => prisma.railJourney.findUnique({ where: { id } }),
  bus: (id) => prisma.busJourney.findUnique({ where: { id } }),
  ferry: (id) => prisma.ferryJourney.findUnique({ where: { id } }),
  rental: (id) => prisma.rentalBooking.findUnique({ where: { id } }),
  cruise: (id) => prisma.cruise.findUnique({ where: { id } }),
  stay: (id) => prisma.lodgingStay.findUnique({ where: { id } }),
};

const DOMAINS = Object.keys(MAKE) as BulkDomain[];
const WITH_TAGS = DOMAINS.filter((d) => d !== "stay");
const TRANSPORT: BulkDomain[] = ["rail", "bus", "ferry"];
const LINKS: Partial<Record<BulkDomain, (id: string) => Promise<number>>> = {
  rail: (id) => prisma.railJourneyCompanion.count({ where: { railJourneyId: id } }),
  bus: (id) => prisma.busJourneyCompanion.count({ where: { busJourneyId: id } }),
  ferry: (id) => prisma.ferryJourneyCompanion.count({ where: { ferryJourneyId: id } }),
  rental: (id) => prisma.rentalBookingCompanion.count({ where: { rentalBookingId: id } }),
  cruise: (id) => prisma.cruiseCompanion.count({ where: { cruiseId: id } }),
};

describe("POST /<domain>/bulk-edit", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;

  const send = (domain: BulkDomain, body: unknown) =>
    request(app)
      .post(`/api/v1${BULK_EDIT_PATHS[domain]}`)
      .set("Cookie", cookie)
      .send(body as object);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["dombulk", "dombulkother"] } } });
    const u = await prisma.user.create({
      data: { username: "dombulk", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "dombulkother", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    const both = { userId: { in: [userId, otherUserId] } };
    await prisma.railJourney.deleteMany({ where: both });
    await prisma.busJourney.deleteMany({ where: both });
    await prisma.ferryJourney.deleteMany({ where: both });
    await prisma.rentalBooking.deleteMany({ where: both });
    await prisma.cruise.deleteMany({ where: both });
    await prisma.lodgingStay.deleteMany({ where: both });
    await prisma.lodging.deleteMany({ where: both });
    await prisma.trip.deleteMany({ where: both });
    await prisma.companion.deleteMany({ where: both });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  describe.each(DOMAINS)("%s", (domain) => {
    it("sets the trip and the companions per row, and a repeat changes nothing", async () => {
      const trip = await prisma.trip.create({ data: { userId, name: "Herbst" } });
      const a = await MAKE[domain](userId, { companions: ["Bo"] });
      const b = await MAKE[domain](userId);
      const body = {
        ids: [a.id, b.id],
        trip: { mode: "set", tripId: trip.id },
        companions: { mode: "add", values: ["Anna"] },
      };
      const res = await send(domain, body);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary).toEqual({ updated: 2, unchanged: 0, failed: 0 });
      expect((await READ[domain](a.id))?.tripId).toBe(trip.id);
      expect((await READ[domain](a.id))?.companions).toEqual(["Bo", "Anna"]);
      expect((await READ[domain](b.id))?.companions).toEqual(["Anna"]);
      const links = LINKS[domain];
      if (links) expect(await links(a.id)).toBe(2);

      const again = await send(domain, body);
      expect(again.body.data.summary).toEqual({ updated: 0, unchanged: 2, failed: 0 });
    });

    it("cancels rows and reinstates them to the status their dates give", async () => {
      const a = await MAKE[domain](userId);
      const cancelled = await send(domain, { ids: [a.id], status: { mode: "cancel" } });
      expect(cancelled.body.data.summary.updated).toBe(1);
      expect((await READ[domain](a.id))?.status).toBe("cancelled");
      const back = await send(domain, { ids: [a.id], status: { mode: "reinstate" } });
      expect(back.body.data.summary.updated).toBe(1);
      expect((await READ[domain](a.id))?.status).toBe("completed");
      const noop = await send(domain, { ids: [a.id], status: { mode: "reinstate" } });
      expect(noop.body.data.summary.unchanged).toBe(1);
    });

    it("names a foreign or missing id per row and never touches the foreign row", async () => {
      const mine = await MAKE[domain](userId);
      const foreign = await MAKE[domain](otherUserId, { companions: ["Fremd"] });
      const ghost = "3b0f6a52-1c0e-4d7e-9a53-6f3c1d7c0a11";
      const res = await send(domain, {
        ids: [mine.id, foreign.id, ghost],
        companions: { mode: "add", values: ["Anna"] },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([
        { id: mine.id, status: "updated" },
        { id: foreign.id, status: "failed", code: "NOT_FOUND" },
        { id: ghost, status: "failed", code: "NOT_FOUND" },
      ]);
      expect((await READ[domain](foreign.id))?.companions).toEqual(["Fremd"]);
    });

    it("refuses another account's trip before writing anything", async () => {
      const theirs = await prisma.trip.create({ data: { userId: otherUserId, name: "Fremd" } });
      const a = await MAKE[domain](userId);
      const res = await send(domain, {
        ids: [a.id],
        trip: { mode: "set", tripId: theirs.id },
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("TRIP_NOT_FOUND");
      expect((await READ[domain](a.id))?.tripId).toBeNull();
    });

    it("answers VERSION_CONFLICT for a row that moved on and writes the others", async () => {
      const stale = await MAKE[domain](userId);
      const fresh = await MAKE[domain](userId);
      const readVersion = async (id: string) =>
        ((await READ[domain](id))?.updatedAt as Date).toISOString();
      const staleBase = await readVersion(stale.id);
      const freshBase = await readVersion(fresh.id);
      // Someone else edits `stale` after the client read it.
      await prisma.$executeRawUnsafe(
        `UPDATE "${
          {
            rail: "rail_journeys",
            bus: "bus_journeys",
            ferry: "ferry_journeys",
            rental: "rental_bookings",
            cruise: "cruises",
            stay: "lodging_stays",
          }[domain]
        }" SET notes = 'moved' WHERE id = $1`,
        stale.id
      );
      const res = await send(domain, {
        ids: [stale.id, fresh.id],
        companions: { mode: "add", values: ["Anna"] },
        baseVersions: { [stale.id]: staleBase, [fresh.id]: freshBase },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([
        { id: stale.id, status: "failed", code: "VERSION_CONFLICT" },
        { id: fresh.id, status: "updated" },
      ]);
      expect((await READ[domain](stale.id))?.companions).toEqual([]);
      expect((await READ[domain](fresh.id))?.companions).toEqual(["Anna"]);
    });

    it("re-derives the status of the trip a row moves into", async () => {
      const trip = await prisma.trip.create({ data: { userId, name: "Alt", status: "scheduled" } });
      const a = await MAKE[domain](userId);
      await send(domain, { ids: [a.id], trip: { mode: "set", tripId: trip.id } });
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe(
        "completed"
      );
    });

    it("refuses a body that names no field of this domain, or a field of another", async () => {
      const a = await MAKE[domain](userId);
      expect((await send(domain, { ids: [a.id] })).status).toBe(400);
      expect((await send(domain, { ids: [a.id], visited: true, tags: undefined })).status).toBe(
        400
      );
    });
  });

  describe.each(WITH_TAGS)("%s tags", (domain) => {
    it("adds to and replaces the tags", async () => {
      const a = await MAKE[domain](userId, { tags: ["x"] });
      await send(domain, { ids: [a.id], tags: { mode: "add", values: ["y", "x"] } });
      expect((await READ[domain](a.id))?.tags).toEqual(["x", "y"]);
      await send(domain, { ids: [a.id], tags: { mode: "replace", values: [] } });
      expect((await READ[domain](a.id))?.tags).toEqual([]);
    });
  });

  describe.each(TRANSPORT)("%s operator and class", (domain) => {
    const classColumn = domain === "rail" ? "travelClass" : "fareClass";
    const classValue = domain === "rail" ? "second" : "Lounge";

    it("sets and clears them", async () => {
      const a = await MAKE[domain](userId, { operator: "Alt" });
      await send(domain, {
        ids: [a.id],
        operator: { mode: "set", value: "Neu" },
        serviceClass: { mode: "set", value: classValue },
      });
      const set = await READ[domain](a.id);
      expect(set?.operator).toBe("Neu");
      expect(set?.[classColumn]).toBe(classValue);
      await send(domain, {
        ids: [a.id],
        operator: { mode: "clear" },
        serviceClass: { mode: "clear" },
      });
      const cleared = await READ[domain](a.id);
      expect(cleared?.operator).toBeNull();
      expect(cleared?.[classColumn]).toBeNull();
    });
  });

  it("a rail class outside the rail vocabulary is refused", async () => {
    const a = await MAKE.rail(userId);
    const res = await send("rail", { ids: [a.id], serviceClass: { mode: "set", value: "Lounge" } });
    expect(res.status).toBe(400);
  });

  it("a rental keeps the bulk-edited fields away from a later mail import", async () => {
    const a = await MAKE.rental(userId);
    await send("rental", { ids: [a.id], tags: { mode: "add", values: ["x"] } });
    const row = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.userEditedFields).toContain("tags");
  });

  it("names the row the database refused and writes the next one (never all-or-nothing)", async () => {
    const a = await MAKE.ferry(userId);
    const b = await MAKE.ferry(userId);
    const real = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
    const spy = jest
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce((() => Promise.reject(new Error("boom"))) as never)
      .mockImplementation(((...args: unknown[]) => real(...args)) as never);
    try {
      const res = await send("ferry", {
        ids: [a.id, b.id],
        tags: { mode: "add", values: ["x"] },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([
        { id: a.id, status: "failed", code: "UPDATE_FAILED" },
        { id: b.id, status: "updated" },
      ]);
      expect(res.body.data.summary).toEqual({ updated: 1, unchanged: 0, failed: 1 });
    } finally {
      spy.mockRestore();
    }
    expect((await READ.ferry(a.id))?.tags).toEqual([]);
    const retry = await send("ferry", { ids: [a.id, b.id], tags: { mode: "add", values: ["x"] } });
    expect(retry.body.data.summary).toEqual({ updated: 1, unchanged: 1, failed: 0 });
  });

  it("takes the version claim back when the write fails, so the retry is not a conflict", async () => {
    const a = await MAKE.rail(userId);
    const base = ((await READ.rail(a.id))?.updatedAt as Date).toISOString();
    // Postgres refuses a NUL byte in text: a real failure of the write itself.
    const bad = await send("rail", {
      ids: [a.id],
      tags: { mode: "add", values: ["a\u0000b"] },
      baseVersions: { [a.id]: base },
    });
    expect(bad.body.data.results).toEqual([{ id: a.id, status: "failed", code: "UPDATE_FAILED" }]);
    expect(((await READ.rail(a.id))?.updatedAt as Date).toISOString()).toBe(base);
    const retry = await send("rail", {
      ids: [a.id],
      tags: { mode: "add", values: ["ok"] },
      baseVersions: { [a.id]: base },
    });
    expect(retry.body.data.results).toEqual([{ id: a.id, status: "updated" }]);
  });

  it("refuses more than 200 ids and a repeated id", async () => {
    const a = await MAKE.rail(userId);
    expect(
      (await send("rail", { ids: [a.id, a.id], tags: { mode: "add", values: ["x"] } })).status
    ).toBe(400);
  });
});

describe("POST /<domain>/bulk-edit — sharing", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  const send = (domain: BulkDomain, body: object) =>
    request(app).post(`/api/v1${BULK_EDIT_PATHS[domain]}`).set("Cookie", anna.cookie).send(body);

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    pair = await sharedPair(anna, ben);
    // Settle what the fixture left underived (a stay's status), then start from a clean inbox.
    await request(app)
      .patch(`/api/v1/lodging/${pair.full.lodging.id}/stays/${pair.full.stay.id}`)
      .set("Cookie", anna.cookie)
      .send({ notes: "settle" })
      .expect(200);
    await prisma.shareNotice.deleteMany({ where: { userId: { in: [anna.id, ben.id] } } });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const ids = (): Record<"rail" | "rental" | "cruise" | "stay", string> => ({
    rail: pair.full.rail.id,
    rental: pair.full.rental.id,
    cruise: pair.full.cruise.id,
    stay: pair.full.stay.id,
  });
  const bens = {
    rail: () => prisma.railJourney.findFirstOrThrow({ where: { userId: ben.id } }),
    rental: () => prisma.rentalBooking.findFirstOrThrow({ where: { userId: ben.id } }),
    cruise: () => prisma.cruise.findFirstOrThrow({ where: { userId: ben.id } }),
    stay: () => prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id } }),
  };

  it.each(["rail", "rental", "cruise", "stay"] as const)(
    "a cancelled %s reaches the member's copy with a notice",
    async (domain) => {
      const res = await send(domain, { ids: [ids()[domain]], status: { mode: "cancel" } });
      expect(res.body.data.summary.updated).toBe(1);
      expect((await bens[domain]()).status).toBe("cancelled");
      expect(
        (await prisma.shareNotice.findMany({ where: { userId: ben.id } })).length
      ).toBeGreaterThan(0);
    }
  );

  it.each(["rail", "rental", "cruise", "stay"] as const)(
    "tags and companions on a %s stay private",
    async (domain) => {
      const body =
        domain === "stay"
          ? { companions: { mode: "add", values: ["Zed"] } }
          : {
              tags: { mode: "add", values: ["secret"] },
              companions: { mode: "add", values: ["Zed"] },
            };
      await send(domain, { ids: [ids()[domain]], ...body }).expect(200);
      expect((await bens[domain]()).companions).toEqual([]);
      expect(await prisma.shareNotice.count({ where: { userId: ben.id } })).toBe(0);
    }
  );

  it("takes the row's write back when its propagation fails, and says so", async () => {
    const spy = jest
      .spyOn(propagation, "propagateWrite")
      .mockRejectedValueOnce(new Error("share is down"));
    try {
      const res = await send("rail", { ids: [ids().rail], status: { mode: "cancel" } });
      expect(res.body.data.results).toEqual([
        { id: ids().rail, status: "failed", code: "UPDATE_FAILED" },
      ]);
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.railJourney.findUniqueOrThrow({ where: { id: ids().rail } })).status).toBe(
      "completed"
    );
    expect((await bens.rail()).status).toBe("completed");
  });

  it("taking a rail journey out of the shared trip tells the member, exactly as the single edit does", async () => {
    await send("rail", { ids: [ids().rail], trip: { mode: "clear" } }).expect(200);
    const notices = await prisma.shareNotice.findMany({ where: { userId: ben.id } });
    expect(notices.map((n) => [n.kind, n.entityType])).toContainEqual(["deleted", "rail"]);
    // The member keeps their own, now detached, copy (the single edit's outcome).
    expect(await prisma.railJourney.count({ where: { userId: ben.id } })).toBe(1);
  });
});
