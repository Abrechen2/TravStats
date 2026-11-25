import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { generateToken } from "../../../utils/jwt";
import { queueSuggestionReconcile, reconcileSuggestions } from "../reconcile";

jest.mock("../../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

/**
 * forgejo#439 acceptance: a pending photo suggestion closes as `covered` once
 * the visit that holds it is logged — without a scan, without an accept — and
 * opens again on undo (and when the covering visit is deleted).
 */
const RATHAUS = { lat: 47.9961, lon: 7.8494 };
const PHOTOS = { lat: RATHAUS.lat + 331 / 111_195, lon: RATHAUS.lon };

let userId: string;
let cookie: string;
let tripId: string;
let placeId: string;

async function finding(over: Record<string, unknown> = {}) {
  return prisma.photoJourney.create({
    data: {
      userId,
      fingerprint: `fp-${Math.random()}`,
      kind: "visit",
      tripId,
      suggestedName: "Stadtverwaltung Freiburg",
      startDate: new Date("2026-11-11T12:10:00Z"),
      endDate: new Date("2026-11-11T12:55:00Z"),
      photoCount: 18,
      locatedCount: 18,
      ...PHOTOS,
      ...over,
    },
  });
}

async function logVisit(): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/places/${placeId}/visits`)
    .set("Cookie", cookie)
    .send({ tripId, visitedAt: { local: "2026-11-11T09:30" } });
  expect(res.status).toBe(201);
  await queueSuggestionReconcile(userId);
  return res.body.data.id;
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `sugg-cover-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.photoJourney.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  tripId = (
    await prisma.trip.create({
      data: {
        userId,
        name: "Dienstreise Freiburg",
        startDate: new Date("2026-11-10T00:00:00Z"),
        endDate: new Date("2026-11-12T00:00:00Z"),
      },
    })
  ).id;
  placeId = (
    await prisma.place.create({
      data: { userId, name: "Rathaus Verw.geb., Freiburg", category: "landmark", ...RATHAUS },
    })
  ).id;
});

describe("suggestions reconcile — forgejo#439", () => {
  it("closes a pending photo suggestion as covered once the covering visit is logged, and re-opens it on undo", async () => {
    const row = await finding();
    const visitId = await logVisit();

    const closed = await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } });
    expect(closed.status).toBe("covered");
    expect(closed.resolvedAt).not.toBeNull();
    expect(closed.resolution).toMatchObject({
      resolution: "covered",
      coveredBy: { kind: "visit", id: visitId, name: "Rathaus Verw.geb., Freiburg" },
    });
    const pending = await request(app).get("/api/v1/photo-journeys").set("Cookie", cookie);
    expect(pending.body.data).toEqual([]);
    const covered = await request(app)
      .get("/api/v1/photo-journeys?status=covered")
      .set("Cookie", cookie);
    expect(covered.body.data.map((r: { id: string }) => r.id)).toEqual([row.id]);

    const undo = await request(app)
      .post(`/api/v1/photo-journeys/${row.id}/reopen`)
      .set("Cookie", cookie)
      .send({});
    expect(undo.status).toBe(200);
    // The user said "not covered": the next reconcile believes it.
    await reconcileSuggestions(userId);
    const reopened = await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } });
    expect(reopened.status).toBe("pending");
    expect(reopened.resolvedAt).toBeNull();
    const again = await request(app)
      .post(`/api/v1/photo-journeys/${row.id}/reopen`)
      .set("Cookie", cookie)
      .send({});
    expect(again.status).toBe(404);
  });

  it("re-opens a covered suggestion when its covering visit is deleted", async () => {
    const row = await finding();
    const visitId = await logVisit();
    expect((await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "covered"
    );
    const del = await request(app).delete(`/api/v1/places/visits/${visitId}`).set("Cookie", cookie);
    expect(del.status).toBeLessThan(300);
    await queueSuggestionReconcile(userId);
    const back = await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } });
    expect(back.status).toBe("pending");
    expect(back.resolution).toBeNull();
  });

  it("leaves a finding on another trip pending", async () => {
    const other = await prisma.trip.create({
      data: {
        userId,
        name: "Other",
        startDate: new Date("2026-11-11T00:00:00Z"),
        endDate: new Date("2026-11-11T00:00:00Z"),
      },
    });
    const row = await finding({ tripId: other.id });
    await logVisit();
    expect((await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "pending"
    );
  });

  it("pre-fills the existing place when only the visit is missing", async () => {
    const row = await finding();
    const summary = await reconcileSuggestions(userId);
    expect(summary.photos).toMatchObject({ covered: 0, prefilled: 1 });
    const filled = await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } });
    expect(filled.status).toBe("pending");
    expect(filled.placeId).toBe(placeId);
  });

  it("counts without writing in a dry run", async () => {
    const row = await finding();
    await prisma.placeVisit.create({
      data: {
        userId,
        placeId,
        tripId,
        visitedAt: new Date("2026-11-11T00:00:00Z"),
        visitedAtUtc: new Date("2026-11-10T23:00:00Z"),
        visitedZone: "Europe/Berlin",
        visitedPrecision: "day",
      },
    });
    const summary = await reconcileSuggestions(userId, { dryRun: true });
    expect(summary.photos.covered).toBe(1);
    expect((await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "pending"
    );
  });
});
