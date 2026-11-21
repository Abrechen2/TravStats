import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

type Asset = Record<string, unknown>;
const search = {
  immich: jest.fn<() => Promise<{ assets: Asset[]; truncated: boolean }>>(),
  photoprism: jest.fn<() => Promise<{ assets: Asset[]; truncated: boolean }>>(),
};
const connected = { immich: true, photoprism: true };
jest.mock("../../services/photoSource", () => {
  const actual = jest.requireActual("../../services/photoSource") as object;
  return {
    ...actual,
    createPhotoSource: (kind: "immich" | "photoprism") => ({
      kind,
      searchAssetsByTime: () => search[kind](),
    }),
  };
});
jest.mock("../../services/photoSource/connection", () => {
  const actual = jest.requireActual("../../services/photoSource/connection") as object;
  return {
    ...actual,
    getPhotoSourceConnection: async (kind: "immich" | "photoprism") =>
      connected[kind] ? { baseUrl: `http://${kind}.test`, apiKey: "k", source: "user" } : null,
  };
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearImmichAssetCache } from "../../services/immich/immichAssetCache";
import { VISIT_PHOTO_SUGGESTION_CAP } from "../../schemas/place";
import { ImmichError } from "../../services/immich/types";
import { settleAllJobs } from "../../services/jobs/jobRegistry";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Automatic photo links for place visits (owner, 2026-11-21). The visit is a
 * 1 May 2024 visit at the Trevi fountain (Rome clock).
 */
const TREVI = { lat: 41.9009, lon: 12.4833 };
const IMMICH_NEAR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRISM_NEAR = "0123456789abcdef0123456789abcdef";
const UNDATED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NO_POSITION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FAR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const IN_ZONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_DAY = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2024-05-01T10:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 100,
  lat: 41.9011,
  lon: 12.4835,
  ...over,
});

describe("automatic place-visit photo links", () => {
  const stamp = Date.now();
  let cookie: string;
  let strangerCookie: string;
  let userId: string;
  let visitId: string;
  let placeId: string;

  const run = async (): Promise<Record<string, unknown>> => {
    const res = await request(app)
      .post("/api/v1/places/visits/photos/auto-link/run")
      .set("Cookie", cookie);
    expect(res.status).toBe(202);
    await settleAllJobs();
    const job = await request(app).get(`/api/v1/jobs/${res.body.data.jobId}`).set("Cookie", cookie);
    return job.body.data ?? job.body;
  };
  const linked = () =>
    prisma.placeVisitPhoto.findMany({
      where: { placeVisitId: visitId },
      orderBy: { sortIdx: "asc" },
    });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `vpa-${stamp}`, passwordHash } });
    const stranger = await prisma.user.create({
      data: { username: `vpa-o-${stamp}`, passwordHash },
    });
    userId = user.id;
    for (const id of [user.id, stranger.id]) {
      await prisma.userSettings.upsert({
        where: { userId: id },
        create: { userId: id, data: {} },
        update: {},
      });
    }
    cookie = `auth_token=${generateToken(user.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    const place = await prisma.place.create({ data: { userId, name: "Trevi", ...TREVI } });
    placeId = place.id;
    visitId = (
      await prisma.placeVisit.create({
        data: { userId, placeId, visitedAt: new Date("2024-05-01T15:00:00Z") },
      })
    ).id;
    // The user's own privacy zone: a 100 m circle around IN_ZONE's position.
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", lat: 41.9012, lon: 12.4836, radiusM: 100 },
    });
  });

  afterAll(async () => {
    await settleAllJobs();
    await prisma.user.deleteMany({ where: { username: { startsWith: "vpa-" } } });
  });

  beforeEach(async () => {
    clearImmichAssetCache();
    connected.immich = true;
    connected.photoprism = true;
    await prisma.placeVisitPhoto.deleteMany({ where: { placeVisitId: visitId } });
    await prisma.visitPhotoRefusal.deleteMany({ where: { placeVisitId: visitId } });
    await prisma.travTrackPrivacyZone.updateMany({ where: { userId }, data: { radiusM: 1 } });
    await prisma.userSettings.update({ where: { userId }, data: { autoLinkVisitPhotos: true } });
    search.immich.mockReset();
    search.photoprism.mockReset();
    search.immich.mockResolvedValue({
      assets: [
        asset(IMMICH_NEAR),
        asset(UNDATED, { fileCreatedAt: null }),
        asset(NO_POSITION, { lat: null, lon: null }),
        asset(FAR, { lat: 41.95, lon: 12.5 }),
        asset(OTHER_DAY, { fileCreatedAt: "2024-05-03T10:00:00.000Z" }),
      ],
      truncated: false,
    });
    search.photoprism.mockResolvedValue({ assets: [asset(PRISM_NEAR)], truncated: false });
  });

  it("links the visit's day photos near the place from Immich AND PhotoPrism, as auto links", async () => {
    await run();
    const rows = await linked();
    expect(rows.map((r) => [r.provider, r.immichAssetId, r.provenance, r.filename])).toEqual([
      ["photoprism", PRISM_NEAR, "auto", null],
      ["immich", IMMICH_NEAR, "auto", null],
    ]);
  });

  it("never matches an undated, position-less, far or other-day photo", async () => {
    await run();
    const ids = (await linked()).map((r) => r.immichAssetId);
    for (const bad of [UNDATED, NO_POSITION, FAR, OTHER_DAY]) expect(ids).not.toContain(bad);
  });

  it("never links a photo whose position lies inside a TravTrack privacy zone", async () => {
    await prisma.travTrackPrivacyZone.updateMany({ where: { userId }, data: { radiusM: 100 } });
    search.immich.mockResolvedValue({ assets: [asset(IN_ZONE)], truncated: false });
    search.photoprism.mockResolvedValue({ assets: [], truncated: false });
    await run();
    expect(await linked()).toHaveLength(0);
  });

  it("is idempotent: a second pass links nothing new", async () => {
    await run();
    const first = await linked();
    const second = await run();
    expect((await linked()).map((r) => r.id)).toEqual(first.map((r) => r.id));
    expect((second.result as { linked: number }).linked).toBe(0);
  });

  it("does not bring back a photo the user removed (refusal persists across passes)", async () => {
    await run();
    const row = (await linked()).find((r) => r.provider === "photoprism")!;
    const del = await request(app)
      .delete(`/api/v1/places/visits/${visitId}/photos/${row.id}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(204);
    await run();
    expect((await linked()).map((r) => r.immichAssetId)).toEqual([IMMICH_NEAR]);
  });

  it("removes every automatically linked photo of one visit and keeps them away", async () => {
    await run();
    const res = await request(app)
      .delete(`/api/v1/places/visits/${visitId}/photos/auto`)
      .set("Cookie", cookie);
    expect(res.body.data.removed).toBe(2);
    await run();
    expect(await linked()).toHaveLength(0);
  });

  it("does not let another account remove a visit's automatic links", async () => {
    await run();
    const res = await request(app)
      .delete(`/api/v1/places/visits/${visitId}/photos/auto`)
      .set("Cookie", strangerCookie);
    expect(res.status).toBe(404);
    expect(await linked()).toHaveLength(2);
  });

  it("does nothing while the account switch is off, and refuses the manual run", async () => {
    const off = await request(app)
      .put("/api/v1/places/visits/photos/auto-link")
      .set("Cookie", cookie)
      .send({ enabled: false });
    expect(off.body.data).toEqual({ enabled: false, jobId: null });
    const res = await request(app)
      .post("/api/v1/places/visits/photos/auto-link/run")
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(await linked()).toHaveLength(0);
  });

  it("switching on runs the pass over existing visits", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { autoLinkVisitPhotos: false } });
    const on = await request(app)
      .put("/api/v1/places/visits/photos/auto-link")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect(on.body.data.jobId).toEqual(expect.any(String));
    await settleAllJobs();
    expect(await linked()).toHaveLength(2);
  });

  it("links on its own when a visit is saved with the switch on", async () => {
    const res = await request(app)
      .post(`/api/v1/places/${placeId}/visits`)
      .set("Cookie", cookie)
      .send({ visitedAt: { local: "2024-05-01T18:00", zone: "Europe/Rome" } });
    expect(res.status).toBe(201);
    // The pass starts after the reply; wait for the link rows, not for a job handle.
    let rows: { provider: string }[] = [];
    for (let i = 0; i < 40 && rows.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 50));
      rows = await prisma.placeVisitPhoto.findMany({ where: { placeVisitId: res.body.data.id } });
    }
    await settleAllJobs();
    expect(rows.map((r) => r.provider).sort()).toEqual(["immich", "photoprism"]);
  });

  it("drops automatic links of the old day when the visit moves, and keeps the user's own", async () => {
    await run();
    await prisma.placeVisitPhoto.create({
      data: {
        placeVisitId: visitId,
        filename: null,
        mimetype: "image/jpeg",
        sizeBytes: 0,
        immichAssetId: "own-pick",
        takenAt: new Date("2024-05-01T09:00:00Z"),
      },
    });
    await prisma.placeVisit.update({
      where: { id: visitId },
      data: {
        visitedAt: new Date("2024-05-09T15:00:00Z"),
        visitedAtUtc: new Date("2024-05-09T15:00:00Z"),
      },
    });
    await run();
    expect((await linked()).map((r) => r.immichAssetId)).toEqual(["own-pick"]);
    await prisma.placeVisit.update({
      where: { id: visitId },
      data: {
        visitedAt: new Date("2024-05-01T15:00:00Z"),
        visitedAtUtc: new Date("2024-05-01T15:00:00Z"),
      },
    });
  });

  it("holds a visit to the cap however many passes run", async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      asset(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, {
        fileCreatedAt: `2024-05-01T10:${String(i).padStart(2, "0")}:00.000Z`,
      })
    );
    search.immich.mockResolvedValue({ assets: many, truncated: false });
    search.photoprism.mockResolvedValue({ assets: [], truncated: false });
    await run();
    await run();
    expect(await linked()).toHaveLength(VISIT_PHOTO_SUGGESTION_CAP);
  });

  it("shows a failing source instead of 'no photos', and still links the other", async () => {
    search.photoprism.mockRejectedValue(new ImmichError("auth", "rejected", 401));
    const job = await run();
    expect(job.status).toBe("succeeded");
    expect((await linked()).map((r) => r.provider)).toEqual(["immich"]);
    const status = await request(app)
      .get("/api/v1/places/visits/photos/auto-link")
      .set("Cookie", cookie);
    expect(status.body.data.lastRun.sources).toEqual({ immich: "ok", photoprism: "auth" });
  });

  it("says so when a source had more photos than one search reads, instead of a silent miss", async () => {
    search.immich.mockResolvedValue({ assets: [asset(IMMICH_NEAR)], truncated: true });
    await run();
    expect((await linked()).map((r) => r.immichAssetId)).toContain(IMMICH_NEAR);
    const status = await request(app)
      .get("/api/v1/places/visits/photos/auto-link")
      .set("Cookie", cookie);
    expect(status.body.data.lastRun.sources.immich).toBe("truncated");
    expect(status.body.data.lastRun.truncatedVisits).toBeGreaterThan(0);
  });

  it("offers PhotoPrism photos among the suggestions, with their source", async () => {
    search.immich.mockResolvedValue({ assets: [asset(IMMICH_NEAR)], truncated: false });
    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photo-suggestions`)
      .set("Cookie", cookie);
    const lib = res.body.data.suggestions.map((s: { provider: string; id: string }) => [
      s.provider,
      s.id,
    ]);
    expect(lib).toEqual([
      ["immich", IMMICH_NEAR],
      ["photoprism", PRISM_NEAR],
    ]);
    expect(res.body.data.sources).toEqual({ immich: "ok", photoprism: "ok" });
  });
});
