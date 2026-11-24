import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { settleAllJobs } from "../../jobs/jobRegistry";
import {
  listTravTrackImports,
  runGpxImport,
  startGpxImport,
  type RunOptions,
} from "../imports/fileImport";
import {
  adaptivePacer,
  importEndStatus,
  isTransientDbError,
  paceAfter,
  PACE_MAX_MS,
  PACE_MIN_MS,
} from "../imports/importPacing";
import { makeUser, wipeTravTrack } from "./fixtures";

/**
 * A large file import shares the database (2026-11-24: a 45 MB Google
 * Timeline held prod at load 15 for seven minutes, then failed on a 347 s
 * transaction with most of its points stored and the import marked failed).
 * Every fixture is synthetic: invented coordinates, invented times.
 */

const PREFIX = "travtrack-throttle-";
const e7 = (deg: number) => Math.round(deg * 1e7);
const START_MS = Date.parse("2020-01-01T00:00:00Z");

/** A Google `Records.json` of `count` fixes a minute apart, each at its own position. */
function records(count: number, offset = 0): Buffer {
  const locations = Array.from({ length: count }, (_, k) => {
    const i = k + offset;
    return {
      latitudeE7: e7(37 + (i % 1000) * 0.0001),
      longitudeE7: e7(127 + Math.floor(i / 1000) * 0.0001),
      timestamp: new Date(START_MS + i * 60_000).toISOString(),
    };
  });
  return Buffer.from(JSON.stringify({ locations }));
}

const noWait = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

describe("TravTrack — a large file import shares the database", () => {
  let userId: string;

  async function newRow() {
    return prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "Records.json", status: "running" },
    });
  }
  const rowOf = (id: string) => prisma.travTrackImport.findUniqueOrThrow({ where: { id } });
  const pointCount = () => prisma.travTrackPoint.count({ where: { userId } });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await settleAllJobs();
    await wipeTravTrack([userId]);
    await prisma.travTrackImport.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await settleAllJobs();
    await wipeTravTrack([userId]);
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("stores 200,000 points in small batches, none held open for more than a few seconds, pausing after each", async () => {
    const total = 200_000;
    const row = await newRow();
    const batches: Array<{ at: number; size: number; durationMs: number }> = [];
    const { waits, sleep } = noWait();
    const outcome = await runGpxImport(
      row.id,
      userId,
      { buffer: records(total) },
      { sleep, onBatch: (b) => batches.push(b) }
    );
    expect(outcome.status).toBe("succeeded");
    expect(outcome.report.stored).toBe(total);
    expect(await pointCount()).toBe(total);
    expect(Math.max(...batches.map((b) => b.size))).toBeLessThanOrEqual(2000);
    expect(batches.length).toBeGreaterThanOrEqual(100);
    // Each batch's own transaction: the old run held one for 347 s.
    expect(Math.max(...batches.map((b) => b.durationMs))).toBeLessThan(5_000);
    // A pause after every batch but the last, never under the floor.
    expect(waits).toHaveLength(batches.length - 1);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(PACE_MIN_MS);
    const after = await rowOf(row.id);
    expect(after.status).toBe("succeeded");
    expect(after.cursor).toBe(total);
    // Days are marked per batch: every day of the file is dirty.
    expect(await prisma.travTrackDirtyDay.count({ where: { userId } })).toBeGreaterThanOrEqual(
      Math.floor((total * 60_000) / 86_400_000)
    );
  }, 300_000);

  it("a crash at batch N leaves the import partial at its cursor; a resume with the same file stores exactly the rest", async () => {
    const total = 5_000;
    const file = records(total);
    const row = await newRow();
    const { sleep } = noWait();
    const crashed = await runGpxImport(
      row.id,
      userId,
      { buffer: file },
      {
        sleep,
        batchSize: 1000,
        afterBatch: async (done) => {
          if (done === 3) throw new Error("the process went away");
        },
      }
    );
    expect(crashed.status).toBe("partial");
    const stopped = await rowOf(row.id);
    expect(stopped.status).toBe("partial");
    expect(stopped.cursor).toBe(3000);
    expect((stopped.report as { stored: number }).stored).toBe(3000);
    expect(await pointCount()).toBe(3000);

    await prisma.travTrackImport.update({ where: { id: row.id }, data: { status: "running" } });
    const resumed = await runGpxImport(
      row.id,
      userId,
      { buffer: file },
      { sleep, batchSize: 1000, resume: true }
    );
    expect(resumed.status).toBe("succeeded");
    // Continued at the cursor: nothing re-read as a duplicate, the report counts the whole file.
    expect(resumed.report.stored).toBe(total);
    expect(resumed.report.duplicate).toBe(0);
    expect(await pointCount()).toBe(total);
    expect((await rowOf(row.id)).cursor).toBe(total);
  });

  it("a restart mid-import leaves a partial import, not an interrupted one, when a batch had committed", async () => {
    const row = await newRow();
    await prisma.travTrackImport.update({ where: { id: row.id }, data: { cursor: 2000 } });
    const empty = await newRow();
    await listTravTrackImports(userId);
    const settled = await rowOf(row.id);
    expect(settled.status).toBe("partial");
    expect((settled.report as { error?: string }).error).toBe("TRAVTRACK_IMPORT_INTERRUPTED");
    expect((await rowOf(empty.id)).status).toBe("interrupted");
  });

  it("re-running a failed import without a cursor (the prod repair) adds only the missing points", async () => {
    const total = 4_000;
    const file = records(total);
    const row = await newRow();
    const { sleep } = noWait();
    // As on prod: an earlier run stored most of the file and ended `failed`,
    // with no cursor or file digest on the row.
    await runGpxImport(row.id, userId, { buffer: records(3_000) }, { sleep, batchSize: 1000 });
    await prisma.travTrackImport.update({
      where: { id: row.id },
      data: { status: "failed", cursor: 0, fileSha256: null },
    });
    const started = await startGpxImport(
      userId,
      { buffer: file, originalName: "Records.json" },
      { resumeOf: row.id, sleep, batchSize: 1000 }
    );
    expect(started.importId).toBe(row.id);
    await settleAllJobs();
    const after = await rowOf(row.id);
    expect(after.status).toBe("succeeded");
    expect(after.report).toMatchObject({ stored: 1000, duplicate: 3000 });
    expect(await pointCount()).toBe(total);
  });

  it("a succeeded import or a Dawarich copy cannot be resumed", async () => {
    const row = await newRow();
    await prisma.travTrackImport.update({ where: { id: row.id }, data: { status: "succeeded" } });
    const code = await startGpxImport(
      userId,
      { buffer: records(10), originalName: "r.json" },
      { resumeOf: row.id }
    ).then(
      () => null,
      (err: unknown) => (err instanceof AppError ? err.code : String(err))
    );
    expect(code).toBe("TRAVTRACK_IMPORT_NOT_RESUMABLE");
  });

  it("a batch that cannot get the account's lock in time is retried after a pause, not held open", async () => {
    const row = await newRow();
    const { waits, sleep } = noWait();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`travtrack:${userId}`}, 0))`;
        locked();
        await held;
      },
      { timeout: 20_000 }
    );
    await isLocked;
    const opts: RunOptions = {
      lockTimeoutMs: 200,
      // The first retry pause is where the lock is let go.
      sleep: async (ms) => {
        await sleep(ms);
        release();
        await holder;
      },
    };
    const outcome = await runGpxImport(row.id, userId, { buffer: records(50) }, opts);
    expect(outcome.status).toBe("succeeded");
    expect(outcome.report.stored).toBe(50);
    expect(waits[0]).toBeGreaterThanOrEqual(1000);
  });
});

describe("TravTrack import pacing", () => {
  it("pauses as long as the work took, within its floor and ceiling", () => {
    expect(paceAfter(0)).toBe(PACE_MIN_MS);
    expect(paceAfter(10)).toBe(PACE_MIN_MS);
    expect(paceAfter(Number.NaN)).toBe(PACE_MIN_MS);
    expect(paceAfter(300)).toBe(300);
    expect(paceAfter(10_000_000)).toBe(PACE_MAX_MS);
    expect(paceAfter(300, { factor: 2 })).toBe(600);
  });

  it("a pacer sleeps after each piece of work in proportion to its duration", async () => {
    const waits: number[] = [];
    let clock = 0;
    const pace = adaptivePacer(
      async (ms) => void waits.push(ms),
      () => clock
    );
    const out = await pace(async () => {
      clock += 400;
      return "done";
    });
    expect(out).toBe("done");
    expect(waits).toEqual([400]);
  });

  it("an import ends succeeded when complete, partial with anything committed, failed only with nothing stored", () => {
    expect(importEndStatus({ completed: true, cursor: 10, stored: 10 })).toBe("succeeded");
    expect(importEndStatus({ completed: false, cursor: 3000, stored: 2500 })).toBe("partial");
    expect(importEndStatus({ completed: false, cursor: 1000, stored: 0 })).toBe("partial");
    expect(importEndStatus({ completed: false, cursor: 0, stored: 0 })).toBe("failed");
  });

  it("knows a busy database from a real failure", () => {
    expect(isTransientDbError({ code: "P2028" })).toBe(true);
    expect(isTransientDbError({ code: "P2010", meta: { code: "55P03" } })).toBe(true);
    expect(isTransientDbError({ cause: { originalCode: "57014" } })).toBe(true);
    expect(isTransientDbError(new Error("canceling statement due to lock timeout"))).toBe(true);
    expect(isTransientDbError({ code: "P2002" })).toBe(false);
    expect(isTransientDbError(new Error("the process went away"))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});
