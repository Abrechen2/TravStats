import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { readFindings } from "../../services/photoJourneys/scan";
import type { PhotoCluster } from "../../services/photoJourneys/cluster";

/**
 * Answering a photo journey (forgejo#94). A `place` finding is accepted by
 * recording a visit, a `stay` finding by a stay — and whatever the caller links
 * must be THEIR entry: the columns have no foreign key, so without a check a
 * journey could be pointed at a stranger's trip.
 */
describe("PATCH /api/v1/photo-journeys/:id", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;

  const journey = (owner: string, fingerprint: string) =>
    prisma.photoJourney.create({
      data: {
        userId: owner,
        fingerprint,
        kind: "place",
        startDate: new Date("2024-05-01T09:00:00Z"),
        endDate: new Date("2024-05-01T18:00:00Z"),
        photoCount: 5,
        locatedCount: 5,
        lat: 38.72,
        lon: -9.14,
        previewAssetIds: [],
      },
    });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `pj-patch-${stamp}`, passwordHash } })).id;
    strangerId = (await prisma.user.create({ data: { username: `pj-patch-other-${stamp}`, passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("records the visit a place finding was accepted with", async () => {
    const row = await journey(userId, `own-${stamp}`);
    const place = await prisma.place.create({ data: { userId, name: "Café Norte", lat: 38.72, lon: -9.14 } });
    const visit = await prisma.placeVisit.create({ data: { userId, placeId: place.id } });

    const res = await request(app)
      .patch(`/api/v1/photo-journeys/${row.id}`)
      .set("Cookie", cookie)
      .send({ status: "accepted", createdPlaceVisitId: visit.id });

    expect(res.status).toBe(200);
    const stored = await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored).toMatchObject({ status: "accepted", createdPlaceVisitId: visit.id });
  });

  it("refuses to link another user's trip, and leaves the row unanswered", async () => {
    const row = await journey(userId, `foreign-${stamp}`);
    const foreignTrip = await prisma.trip.create({ data: { userId: strangerId, name: "Not yours" } });

    const res = await request(app)
      .patch(`/api/v1/photo-journeys/${row.id}`)
      .set("Cookie", cookie)
      .send({ status: "accepted", createdTripId: foreignTrip.id });

    expect(res.status).toBe(404);
    expect((await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("pending");
  });
});

describe("readFindings", () => {
  const cluster = (overrides: Partial<PhotoCluster>): PhotoCluster => ({
    startMs: Date.UTC(2024, 4, 1),
    endMs: Date.UTC(2024, 4, 3),
    photoIds: ["a", "b", "c", "d"],
    photoCount: 4,
    position: { lat: 38.72, lon: -9.14 },
    locatedCount: 4,
    samples: [{ lat: 38.72, lon: -9.14 }],
    ...overrides,
  });

  it("drops a burst without a single coordinate and orders the rest biggest first", () => {
    const flights = [{ depIata: "MUC", depLat: 48.35, depLon: 11.79, arrIata: "LIS", arrLat: 38.77, arrLon: -9.13 }];
    const findings = readFindings(
      [
        cluster({ samples: [], position: null, locatedCount: 0 }),
        cluster({ photoCount: 4 }),
        cluster({ photoCount: 40, startMs: Date.UTC(2024, 6, 1), endMs: Date.UTC(2024, 6, 2) }),
      ],
      flights,
      [],
      [],
    );
    expect(findings.map((f) => [f.kind, f.cluster.photoCount])).toEqual([
      ["trip", 40],
      ["trip", 4],
    ]);
    expect(findings[0].airportIata).toBe("LIS");
    expect(findings[0].located.nights).toBe(1);
  });
});
