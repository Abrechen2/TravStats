import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

jest.mock("../services/fx/frankfurter", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
    source: "ecb" as const,
  })),
  getRate: jest.fn(async () => ({ rate: 1, source: "ecb" as const })),
}));

const backfillSpy = jest.fn(async () => ({ attempted: 0, filled: 0 }));
jest.mock("../services/lodging/geocodeBackfill", () => ({
  MAX_BACKFILL_ROWS: 500,
  backfillMissingCoordinates: () => backfillSpy(),
  completeMissingAddresses: () => backfillSpy(),
  // What the commit route actually fires since location resolution runs in
  // BOTH directions. Leaving it out made every commit 500 — the route called
  // an undefined mock export.
  backfillLodgingLocations: async () => ({
    coordinates: await backfillSpy(),
    addresses: { attempted: 0, filled: 0 },
  }),
}));

jest.mock("../services/lodging/mappingSuggestion", () => {
  const actual = jest.requireActual("../services/lodging/mappingSuggestion");
  return { ...actual, suggestLodgingCsvMapping: jest.fn(async () => ({ name: "Hotel" })) };
});

describe("/api/v1/lodging-import", () => {
  let token: string;
  let userId: string;
  let otherToken: string;
  let otherUserId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `lodging-import-routes-test-${Date.now()}`,
        passwordHash: await hashPassword("pw123456"),
      },
    });
    userId = user.id;
    token = generateToken(user.id);

    const other = await prisma.user.create({
      data: {
        username: `lodging-import-routes-other-${Date.now()}`,
        passwordHash: await hashPassword("pw123456"),
      },
    });
    otherUserId = other.id;
    otherToken = generateToken(other.id);
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.lodgingImportBatch.deleteMany({
      where: { userId: { in: [userId, otherUserId] } },
    });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.user.delete({ where: { id: otherUserId } });
    await prisma.$disconnect();
  });

  const auth = (): [string] => [`auth_token=${token}`];
  const authOther = (): [string] => [`auth_token=${otherToken}`];

  it("rejects an unauthenticated preview", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-import/preview")
      .send({ candidates: [{ sourceRowIndex: 0, lodging: { name: "X" }, stay: null }] });
    expect(res.status).toBe(401);
  });

  it("previews, commits, lists and reverts a batch", async () => {
    const preview = await request(app)
      .post("/api/v1/lodging-import/preview")
      .set("Cookie", auth())
      .send({
        candidates: [
          {
            sourceRowIndex: 0,
            lodging: { name: "Route Hotel", city: "Wien", lat: 48.2, lon: 16.3 },
            stay: { checkIn: "2026-09-01", checkOut: "2026-09-03", totalPrice: 200, currency: "EUR" },
          },
        ],
      });

    expect(preview.status).toBe(200);
    expect(preview.body.success).toBe(true);
    expect(preview.body.data.rows).toHaveLength(1);
    expect(preview.body.data.summary).toEqual({ newRows: 1, alreadyPresent: 0, needsInput: 0 });

    const commit = await request(app)
      .post("/api/v1/lodging-import/commit")
      .set("Cookie", auth())
      .send({
        source: "csv",
        fileName: "routes.csv",
        rows: [
          {
            sourceRowIndex: 0,
            action: "create",
            lodging: { name: "Route Hotel", city: "Wien", lat: 48.2, lon: 16.3 },
            stay: { checkIn: "2026-09-01", checkOut: "2026-09-03", totalPrice: 200, currency: "EUR" },
          },
        ],
      });

    expect(commit.status).toBe(201);
    expect(commit.body.data.createdLodgings).toBe(1);
    expect(commit.body.data.createdStays).toBe(1);
    const batchId = commit.body.data.batchId;

    // The commit must kick off the background geocode pass, not await it.
    expect(backfillSpy).toHaveBeenCalled();

    const list = await request(app)
      .get("/api/v1/lodging-import/batches")
      .set("Cookie", auth());
    expect(list.status).toBe(200);
    expect(list.body.data.some((b: { id: string }) => b.id === batchId)).toBe(true);

    const revert = await request(app)
      .delete(`/api/v1/lodging-import/batches/${batchId}`)
      .set("Cookie", auth());
    expect(revert.status).toBe(200);
    expect(revert.body.data.deletedLodgings).toBe(1);
    expect(revert.body.data.deletedStays).toBe(1);
    expect(revert.body.data.detachedLodgings).toBe(0);

    expect(await prisma.lodging.count({ where: { userId, name: "Route Hotel" } })).toBe(0);
  });

  it("400s on a commit row whose action is needs_input", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-import/commit")
      .set("Cookie", auth())
      .send({
        source: "csv",
        fileName: null,
        rows: [{ sourceRowIndex: 0, action: "needs_input", lodging: { name: "X" }, stay: null }],
      });
    expect(res.status).toBe(400);
  });

  it("404s when reverting an unknown batch", async () => {
    const res = await request(app)
      .delete("/api/v1/lodging-import/batches/00000000-0000-0000-0000-000000000000")
      .set("Cookie", auth());
    expect(res.status).toBe(404);
  });

  it("returns a mapping suggestion", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-import/suggest-mapping")
      .set("Cookie", auth())
      .send({ headers: ["Hotel", "Anreise"], sampleRows: [{ Hotel: "NH", Anreise: "2026-03-30" }] });
    expect(res.status).toBe(200);
    expect(res.body.data.mapping).toEqual({ name: "Hotel" });
  });

  // ---- Cross-user isolation (IDOR) ----
  // Task 7 shipped a CRITICAL IDOR on this exact seam: `Lodging`/`LodgingStay`
  // carry independent `userId` columns with no compound FK, so a plain Prisma
  // FK existence check proves a row EXISTS, not who OWNS it. These tests use a
  // REAL second user's REAL rows — a non-existent UUID would not exercise the
  // ownership check at all, only the 404-for-missing-row path.

  it("does not dedupe a preview against another user's lodging", async () => {
    const theirs = await prisma.lodging.create({
      data: {
        userId: otherUserId,
        name: "Their Secret Hotel",
        externalRef: "google:ChIJcrossuser",
      },
    });

    const res = await request(app)
      .post("/api/v1/lodging-import/preview")
      .set("Cookie", auth())
      .send({
        candidates: [
          {
            sourceRowIndex: 0,
            lodging: { name: "Their Secret Hotel", externalRef: "google:ChIJcrossuser" },
            stay: null,
          },
        ],
      });

    expect(res.status).toBe(200);
    // Must NOT match the other user's row — a real exactRef dedupe would
    // otherwise leak the existence (and id) of another user's lodging.
    expect(res.body.data.rows[0].matchedLodgingId).not.toBe(theirs.id);
    expect(res.body.data.rows[0].dedupeHint).toBe("none");
    expect(res.body.data.rows[0].action).toBe("create");

    await prisma.lodging.delete({ where: { id: theirs.id } });
  });

  it("fails (not attaches) a commit row whose matchedLodgingId belongs to another user", async () => {
    const theirs = await prisma.lodging.create({
      data: { userId: otherUserId, name: "Their Attach Target" },
    });

    const res = await request(app)
      .post("/api/v1/lodging-import/commit")
      .set("Cookie", auth())
      .send({
        source: "csv",
        fileName: "idor.csv",
        rows: [
          {
            sourceRowIndex: 0,
            action: "create",
            matchedLodgingId: theirs.id,
            lodging: null,
            stay: { checkIn: "2026-10-01", checkOut: "2026-10-02" },
          },
        ],
      });

    // The batch itself still succeeds (per-row isolation) — the offending
    // row surfaces in `failed`, not as a 500 or a silent attach.
    expect(res.status).toBe(201);
    expect(res.body.data.createdStays).toBe(0);
    expect(res.body.data.failed).toHaveLength(1);
    expect(res.body.data.failed[0].sourceRowIndex).toBe(0);

    // The other user's lodging must remain untouched — no stay attached.
    expect(await prisma.lodgingStay.count({ where: { lodgingId: theirs.id } })).toBe(0);

    await prisma.lodgingImportBatch.delete({ where: { id: res.body.data.batchId } });
    await prisma.lodging.delete({ where: { id: theirs.id } });
  });

  it("does not list another user's import batches", async () => {
    const theirCommit = await request(app)
      .post("/api/v1/lodging-import/commit")
      .set("Cookie", authOther())
      .send({
        source: "csv",
        fileName: "theirs.csv",
        rows: [
          {
            sourceRowIndex: 0,
            action: "create",
            lodging: { name: "Other User Batch Hotel" },
            stay: null,
          },
        ],
      });
    expect(theirCommit.status).toBe(201);
    const theirBatchId = theirCommit.body.data.batchId;

    const mine = await request(app)
      .get("/api/v1/lodging-import/batches")
      .set("Cookie", auth());
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((b: { id: string }) => b.id === theirBatchId)).toBe(false);

    const theirs = await request(app)
      .get("/api/v1/lodging-import/batches")
      .set("Cookie", authOther());
    expect(theirs.body.data.some((b: { id: string }) => b.id === theirBatchId)).toBe(true);

    await prisma.lodgingImportBatch.delete({ where: { id: theirBatchId } });
    await prisma.lodging.deleteMany({ where: { userId: otherUserId, name: "Other User Batch Hotel" } });
  });

  it("404s reverting another user's batch, and the batch survives", async () => {
    const theirCommit = await request(app)
      .post("/api/v1/lodging-import/commit")
      .set("Cookie", authOther())
      .send({
        source: "csv",
        fileName: "theirs-revert.csv",
        rows: [
          {
            sourceRowIndex: 0,
            action: "create",
            lodging: { name: "Other User Revert Hotel" },
            stay: null,
          },
        ],
      });
    expect(theirCommit.status).toBe(201);
    const theirBatchId = theirCommit.body.data.batchId;

    const revert = await request(app)
      .delete(`/api/v1/lodging-import/batches/${theirBatchId}`)
      .set("Cookie", auth());
    expect(revert.status).toBe(404);

    expect(
      await prisma.lodgingImportBatch.findUnique({ where: { id: theirBatchId } }),
    ).not.toBeNull();

    await prisma.lodgingImportBatch.delete({ where: { id: theirBatchId } });
    await prisma.lodging.deleteMany({ where: { userId: otherUserId, name: "Other User Revert Hotel" } });
  });
});
