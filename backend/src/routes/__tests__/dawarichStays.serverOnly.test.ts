import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { buildAccountExport } from "../../services/export/allDataExport";
import { projectRow } from "../../services/federation/e2e/source";
import { TRAVEL_GRAPH } from "../../services/federation/e2e/graph";

/**
 * What a stay row keeps server-side (TravTrack plan E1, Codex review): the
 * neutral evidence key, the accept protocol's claim and the point digests a
 * TravTrack finding stores in its evidence never leave the server — not
 * through the stays API, the account export (which the WebDAV sync uploads)
 * or a federation publication. A Dawarich user's output is what it was
 * before those columns existed.
 */

/** The columns a stay row had before E1 — what every reader saw then. */
const PRE_E1_COLUMNS = [
  "id",
  "userId",
  "fingerprint",
  "sourceStartAt",
  "sourceEndAt",
  "sourceLat",
  "sourceLon",
  "status",
  "startAt",
  "endAt",
  "lat",
  "lon",
  "zone",
  "pointCount",
  "evidence",
  "placeId",
  "tripId",
  "name",
  "visitId",
  "detectedAt",
  "resolvedAt",
];
const SERVER_ONLY = [
  "evidenceKey",
  "claimToken",
  "claimedAt",
  "provider",
  "providerRev",
  "algorithmVersion",
];

let userId: string;
let cookie: string;

const stay = (evidence: object, extra: object = {}) =>
  prisma.dawarichStay.create({
    data: {
      userId,
      fingerprint: `fp-${Math.random()}`,
      sourceStartAt: new Date("2026-10-10T14:50:00Z"),
      sourceEndAt: new Date("2026-10-10T15:20:00Z"),
      sourceLat: 37.57,
      sourceLon: 126.97,
      status: "rejected",
      startAt: new Date("2026-10-10T14:50:00Z"),
      endAt: new Date("2026-10-10T15:20:00Z"),
      lat: 37.57,
      lon: 126.97,
      zone: "Asia/Seoul",
      pointCount: 4,
      evidence,
      evidenceKey: "k".repeat(64),
      claimToken: "claim-token",
      claimedAt: new Date("2026-10-11T00:00:00Z"),
      ...extra,
    },
  });

const DAWARICH_EVIDENCE = { zone: "Asia/Seoul", pointIds: [1, 2, 3, 4] };
const TRAVTRACK_EVIDENCE = {
  zone: "Asia/Seoul",
  source: "travtrack",
  pointDigests: ["00112233445566778899aabbccddeeff"],
};

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-server-only-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
  await prisma.userSettings.create({ data: { userId, enabledDomains: ["poi"], data: {} } });
});

beforeEach(async () => {
  await prisma.dawarichStay.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("a stay row's server-side fields", () => {
  it("never reach the stays API, and a Dawarich row reads as before", async () => {
    await stay(DAWARICH_EVIDENCE);
    await stay(TRAVTRACK_EVIDENCE, { provider: "travtrack", algorithmVersion: 1 });
    const res = await request(app)
      .get("/api/v1/dawarich-stays?status=rejected")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([...PRE_E1_COLUMNS, "times", "visit"].sort());
      expect(JSON.stringify(row)).not.toContain("pointDigests");
    }
    const dawarich = rows.find((r) => (r.evidence as { pointIds?: unknown }).pointIds);
    expect(dawarich?.evidence).toEqual(DAWARICH_EVIDENCE);
  });

  it("never reach the account export (and with it the WebDAV sync)", async () => {
    await stay(DAWARICH_EVIDENCE);
    await stay(TRAVTRACK_EVIDENCE, { provider: "travtrack" });
    const exported = await buildAccountExport(userId, "test");
    const stays = (exported?.user as { dawarichStays: Array<Record<string, unknown>> })
      .dawarichStays;
    expect(stays).toHaveLength(2);
    for (const row of stays) {
      expect(Object.keys(row).sort()).toEqual([...PRE_E1_COLUMNS].sort());
      for (const field of SERVER_ONLY) expect(row).not.toHaveProperty(field);
    }
    expect(JSON.stringify(stays)).not.toContain("pointDigests");
    expect(stays.map((s) => s.evidence)).toContainEqual(DAWARICH_EVIDENCE);
  });

  it("never reach a federation publication", async () => {
    const row = await stay(TRAVTRACK_EVIDENCE, { provider: "travtrack" });
    const projected = await projectRow(
      userId,
      row as unknown as Record<string, unknown>,
      TRAVEL_GRAPH.dawarichStays,
      {} as Parameters<typeof projectRow>[3],
      new Map()
    );
    expect(projected).not.toBeNull();
    for (const field of SERVER_ONLY) expect(projected).not.toHaveProperty(field);
    expect(JSON.stringify(projected)).not.toContain("pointDigests");
    expect(projected?.evidence).toEqual({ zone: "Asia/Seoul", source: "travtrack" });
  });
});
