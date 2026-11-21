import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

type Asset = Record<string, unknown>;
const search = {
  immich: jest.fn<() => Promise<{ assets: Asset[]; truncated: boolean }>>(),
  photoprism: jest.fn<() => Promise<{ assets: Asset[]; truncated: boolean }>>(),
};
const connectionSource = { value: "user" as "user" | "global" };
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
      kind === "immich"
        ? { baseUrl: "http://immich.test", apiKey: "k", source: connectionSource.value }
        : null,
  };
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearImmichAssetCache } from "../../services/immich/immichAssetCache";
import { ImmichError } from "../../services/immich/types";
import { settleAllJobs } from "../../services/jobs/jobRegistry";
import { autoLinkEntry } from "../../services/photoLinking/entryPhotos";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Cap, choose and trim (owner, 2026-11-21: "5–10 max pro Aufenthalt … es muss
 * Auswahlmöglichkeit geben"). A place visit at the Trevi fountain and a stay in
 * Rome, each with a day of photos far over the cap.
 */
const TREVI = { lat: 41.9009, lon: 12.4833 };
const aid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const asset = (n: number, minutes: number, over: Partial<Asset> = {}): Asset => ({
  id: aid(n),
  type: "IMAGE",
  fileCreatedAt: new Date(Date.UTC(2024, 4, 1, 8, 0) + minutes * 60_000).toISOString(),
  originalFileName: `${n}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 100,
  lat: 41.9011,
  lon: 12.4835,
  ...over,
});
/** 40 photos, 20 minutes apart from 08:00 UTC (10:00 Rome) — ten hours of a day. */
const DAY = Array.from({ length: 40 }, (_, i) => asset(i + 1, i * 15));

describe("photo cap, choose and trim", () => {
  const stamp = Date.now();
  let cookie: string;
  let userId: string;
  let visitId: string;
  let stayId: string;

  const visitLinks = () =>
    prisma.placeVisitPhoto.findMany({
      where: { placeVisitId: visitId },
      orderBy: { sortIdx: "asc" },
    });
  const stayLinks = () =>
    prisma.entryPhotoLink.findMany({ where: { userId, lodgingStayId: stayId, refused: false } });
  const runJob = async (path: string) => {
    const res = await request(app).post(path).set("Cookie", cookie);
    expect(res.status).toBe(202);
    await settleAllJobs();
    const job = await request(app).get(`/api/v1/jobs/${res.body.data.jobId}`).set("Cookie", cookie);
    return (job.body.data ?? job.body).result as Record<string, number>;
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `pcc-${stamp}`, passwordHash } });
    userId = user.id;
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {} },
      update: {},
    });
    cookie = `auth_token=${generateToken(userId)}`;
    const place = await prisma.place.create({ data: { userId, name: "Trevi", ...TREVI } });
    visitId = (
      await prisma.placeVisit.create({
        data: { userId, placeId: place.id, visitedAt: new Date("2024-05-01T15:00:00Z") },
      })
    ).id;
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel", lat: TREVI.lat, lon: TREVI.lon },
    });
    stayId = (
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkInAt: new Date("2024-05-01T06:00:00Z"),
          checkOutAt: new Date("2024-05-01T20:00:00Z"),
          checkInDate: new Date("2024-05-01"),
          checkOutDate: new Date("2024-05-01"),
          stayZone: "Europe/Rome",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await settleAllJobs();
    await prisma.user.deleteMany({ where: { username: { startsWith: "pcc-" } } });
  });

  beforeEach(async () => {
    clearImmichAssetCache();
    await settleAllJobs();
    await prisma.placeVisitPhoto.deleteMany({ where: { placeVisitId: visitId } });
    await prisma.visitPhotoRefusal.deleteMany({ where: { placeVisitId: visitId } });
    await prisma.entryPhotoLink.deleteMany({ where: { userId } });
    await prisma.userSettings.update({
      where: { userId },
      data: { autoLinkVisitPhotos: true, photoAutoLinkCap: 6 },
    });
    search.immich.mockReset();
    search.photoprism.mockReset();
    search.immich.mockResolvedValue({ assets: DAY, truncated: false });
    search.photoprism.mockResolvedValue({ assets: [], truncated: false });
  });

  it("links at most the cap per visit and spreads the picks over the day", async () => {
    await runJob("/api/v1/places/visits/photos/auto-link/run");
    const rows = await visitLinks();
    expect(rows).toHaveLength(6);
    const times = rows.map((r) => r.takenAt!.getTime()).sort((a, b) => a - b);
    expect((times[5]! - times[0]!) / 60_000).toBeGreaterThan(8 * 60);
  });

  it("links at most the cap per entry and never sends anything to an inbox", async () => {
    const out = await autoLinkEntry(userId, "stay", stayId);
    expect(out!.linked).toBe(6);
    expect(await stayLinks()).toHaveLength(6);
    await autoLinkEntry(userId, "stay", stayId);
    expect(await stayLinks()).toHaveLength(6);
  });

  it("honours a larger cap from the setting", async () => {
    const put = await request(app)
      .put("/api/v1/places/visits/photos/auto-link/cap")
      .set("Cookie", cookie)
      .send({ cap: 9 });
    expect(put.body.data.cap).toBe(9);
    await settleAllJobs();
    await runJob("/api/v1/places/visits/photos/auto-link/run");
    expect(await visitLinks()).toHaveLength(9);
  });

  it.each([4, 11, 6.5, "7"])("rejects the cap %p outside 5-10 or not an integer", async (cap) => {
    const res = await request(app)
      .put("/api/v1/places/visits/photos/auto-link/cap")
      .set("Cookie", cookie)
      .send({ cap });
    expect(res.status).toBe(400);
  });

  it("choose view lists every candidate with time and distance, the linked ones ticked, plus open-in links", async () => {
    await runJob("/api/v1/places/visits/photos/auto-link/run");
    const res = await request(app)
      .get(`/api/v1/places/visits/${visitId}/photo-choices`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const { choices, cap, openIn } = res.body.data;
    expect(cap).toBe(6);
    expect(choices.length).toBeGreaterThan(6);
    expect(choices.filter((c: { chosen: boolean }) => c.chosen)).toHaveLength(6);
    // 08:00Z is 10:00 on the Rome clock: the place's wall clock, never UTC.
    expect(choices[0].takenAtLocal).toBe("2024-05-01T10:00:00");
    expect(choices[0]).toEqual(
      expect.objectContaining({
        provider: "immich",
        takenAt: expect.any(String),
        distanceM: expect.any(Number),
      })
    );
    expect(openIn).toEqual([
      { provider: "immich", url: expect.stringContaining("http://immich.test/search?query=") },
    ]);
  });

  it("gives a non-admin on a shared connection no open-in URL, an admin or an own connection one", async () => {
    const url = () =>
      request(app)
        .get(`/api/v1/places/visits/${visitId}/photo-choices`)
        .set("Cookie", cookie)
        .then((r) => r.body.data.openIn as unknown[]);
    connectionSource.value = "global";
    try {
      expect(await url()).toEqual([]);
      await prisma.user.update({ where: { id: userId }, data: { isAdmin: true } });
      expect(await url()).toHaveLength(1);
      await prisma.user.update({ where: { id: userId }, data: { isAdmin: false } });
      connectionSource.value = "user";
      expect(await url()).toHaveLength(1);
    } finally {
      connectionSource.value = "user";
      await prisma.user.update({ where: { id: userId }, data: { isAdmin: false } });
    }
  });

  it("swapping a visit's automatic link for another photo makes it a user pick and records no refusal", async () => {
    await runJob("/api/v1/places/visits/photos/auto-link/run");
    const before = await visitLinks();
    const dropped = before[0]!;
    const unlinked = DAY.find((a) => !before.some((r) => r.immichAssetId === a.id))!;
    const put = await request(app)
      .put(`/api/v1/places/visits/${visitId}/photo-choices`)
      .set("Cookie", cookie)
      .send({
        select: [{ provider: "immich", assetId: unlinked.id }],
        deselect: [{ provider: "immich", assetId: dropped.immichAssetId }],
      });
    expect(put.body.data).toEqual({ picked: 1, swapped: 1, refused: 0, skipped: 0 });
    const after = await visitLinks();
    expect(after).toHaveLength(6);
    expect(after.find((r) => r.immichAssetId === unlinked.id)!.provenance).toBe("manual");
    expect(await prisma.visitPhotoRefusal.count({ where: { placeVisitId: visitId } })).toBe(0);
    // Re-runs add nothing (the total is at the cap) and keep the user's pick.
    await runJob("/api/v1/places/visits/photos/auto-link/run");
    const rerun = await visitLinks();
    expect(rerun).toHaveLength(6);
    expect(rerun.some((r) => r.immichAssetId === unlinked.id && r.provenance === "manual")).toBe(
      true
    );
  });

  it("an untick with no replacement is an explicit removal and stays removed", async () => {
    await runJob("/api/v1/places/visits/photos/auto-link/run");
    const dropped = (await visitLinks())[0]!;
    const put = await request(app)
      .put(`/api/v1/places/visits/${visitId}/photo-choices`)
      .set("Cookie", cookie)
      .send({ deselect: [{ provider: "immich", assetId: dropped.immichAssetId }] });
    expect(put.body.data.refused).toBe(1);
    await runJob("/api/v1/places/visits/photos/auto-link/run");
    expect((await visitLinks()).some((r) => r.immichAssetId === dropped.immichAssetId)).toBe(false);
  });

  it("refuses to pick a photo that is not a candidate of the visit", async () => {
    const put = await request(app)
      .put(`/api/v1/places/visits/${visitId}/photo-choices`)
      .set("Cookie", cookie)
      .send({ select: [{ provider: "immich", assetId: aid(999) }] });
    expect(put.body.data).toEqual({ picked: 0, swapped: 0, refused: 0, skipped: 1 });
    expect(await visitLinks()).toHaveLength(0);
  });

  it("entry choose and swap: pick replaces an automatic link, user pick survives a re-run", async () => {
    await autoLinkEntry(userId, "stay", stayId);
    const before = await stayLinks();
    const list = await request(app)
      .get(`/api/v1/entry-photos/stay/${stayId}/photo-choices`)
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.choices.filter((c: { chosen: boolean }) => c.chosen)).toHaveLength(6);
    const dropped = before[0]!;
    const pick = DAY.find((a) => !before.some((r) => r.assetId === a.id))!;
    const put = await request(app)
      .put(`/api/v1/entry-photos/stay/${stayId}/photo-choices`)
      .set("Cookie", cookie)
      .send({
        select: [{ provider: "immich", assetId: pick.id }],
        deselect: [{ provider: "immich", assetId: dropped.assetId }],
      });
    expect(put.body.data).toEqual({ picked: 1, swapped: 1, refused: 0, skipped: 0 });
    await autoLinkEntry(userId, "stay", stayId);
    const after = await stayLinks();
    expect(after).toHaveLength(6);
    expect(after.find((r) => r.assetId === pick.id)!.provenance).toBe("manual");
    expect(await prisma.entryPhotoLink.count({ where: { userId, refused: true } })).toBe(0);
  });

  it("trim keeps user picks, cuts automatic links to the cap, reports the count and is idempotent", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { photoAutoLinkCap: 10 } });
    await runJob("/api/v1/places/visits/photos/auto-link/run");
    await autoLinkEntry(userId, "stay", stayId);
    // The user's own pick on top of the ten automatic links of each.
    await request(app)
      .put(`/api/v1/places/visits/${visitId}/photo-choices`)
      .set("Cookie", cookie)
      .send({ select: [{ provider: "immich", assetId: aid(2) }] });
    await prisma.userSettings.update({ where: { userId }, data: { photoAutoLinkCap: 5 } });
    const first = await runJob("/api/v1/places/visits/photos/auto-link/trim");
    expect(first.removed).toBeGreaterThan(0);
    const rows = await visitLinks();
    expect(rows.filter((r) => r.provenance === "manual").length).toBeGreaterThanOrEqual(1);
    // The pick counts toward the cap, so the total is the cap or the pick plus its automatic share.
    expect(rows.length).toBeLessThanOrEqual(5);
    expect((await stayLinks()).length).toBe(5);
    const second = await runJob("/api/v1/places/visits/photos/auto-link/trim");
    expect(second.removed).toBe(0);
  });

  it("trims existing links by distance plus spread, not by spread alone", async () => {
    // Ten links, 15 minutes apart. The first one sits ~230 m from the place, its
    // neighbour ~20 m; spread alone would keep the earlier of the two.
    const far = asset(1, 0, { lat: 41.903 });
    search.immich.mockResolvedValue({ assets: [far, ...DAY.slice(1)], truncated: false });
    await prisma.placeVisitPhoto.createMany({
      data: DAY.slice(0, 10).map((a, i) => ({
        placeVisitId: visitId,
        filename: null,
        mimetype: "image/jpeg",
        sizeBytes: 0,
        immichAssetId: a.id as string,
        provider: "immich",
        provenance: "auto",
        takenAt: new Date(a.fileCreatedAt as string),
        sortIdx: i,
      })),
    });
    await prisma.userSettings.update({ where: { userId }, data: { photoAutoLinkCap: 5 } });
    const result = await runJob("/api/v1/places/visits/photos/auto-link/trim");
    expect(result.removed).toBe(5);
    expect(result.skipped).toBe(0);
    const kept = (await visitLinks()).map((r) => r.immichAssetId);
    expect(kept).not.toContain(aid(1));
    expect(kept).toContain(aid(2));
  });

  it("does not trim on a guess when a photo source failed to answer, and says so", async () => {
    await prisma.placeVisitPhoto.createMany({
      data: DAY.slice(0, 10).map((a, i) => ({
        placeVisitId: visitId,
        filename: null,
        mimetype: "image/jpeg",
        sizeBytes: 0,
        immichAssetId: a.id as string,
        provider: "immich",
        provenance: "auto",
        takenAt: new Date(a.fileCreatedAt as string),
        sortIdx: i,
      })),
    });
    await prisma.userSettings.update({ where: { userId }, data: { photoAutoLinkCap: 5 } });
    search.immich.mockRejectedValue(new ImmichError("unreachable", "down", 502));
    const result = await runJob("/api/v1/places/visits/photos/auto-link/trim");
    expect(result.removed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(await visitLinks()).toHaveLength(10);
  });
});
