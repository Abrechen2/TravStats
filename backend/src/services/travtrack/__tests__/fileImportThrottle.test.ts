import fs from "node:fs";

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
import { FairSlot } from "../imports/writeSlot";
import logger, { dbLogger } from "../../../utils/logger";
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
    let crashedSpool = "";
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
        onSpool: (path) => (crashedSpool = path),
      }
    );
    expect(crashed.status).toBe("partial");
    // A stop removes the points file as well.
    expect(fs.existsSync(crashedSpool)).toBe(false);
    const stopped = await rowOf(row.id);
    expect(stopped.status).toBe("partial");
    expect(stopped.cursor).toBe(3000);
    expect((stopped.report as { stored: number }).stored).toBe(3000);
    expect(await pointCount()).toBe(3000);

    await prisma.travTrackImport.update({ where: { id: row.id }, data: { status: "running" } });
    const resumedAt: number[] = [];
    let parses = 0;
    const resumed = await runGpxImport(
      row.id,
      userId,
      { buffer: file },
      {
        sleep,
        batchSize: 1000,
        resume: true,
        onBatch: ({ at }) => resumedAt.push(at),
        onParse: () => (parses += 1),
      }
    );
    // Read from the points file at the stored cursor, after one parse.
    expect(resumedAt).toEqual([3000, 4000]);
    expect(parses).toBe(1);
    expect(resumed.status).toBe("succeeded");
    // Continued at the cursor: nothing re-read as a duplicate, the report counts the whole file.
    expect(resumed.report.stored).toBe(total);
    expect(resumed.report.duplicate).toBe(0);
    expect(await pointCount()).toBe(total);
    expect((await rowOf(row.id)).cursor).toBe(total);
  });

  it("a cancelled import removes its points file too", async () => {
    const row = await newRow();
    const { sleep } = noWait();
    let spool = "";
    const outcome = await runGpxImport(
      row.id,
      userId,
      { buffer: records(3_000) },
      {
        sleep,
        batchSize: 1000,
        onSpool: (path) => {
          spool = path;
          expect(fs.statSync(path).mode & 0o777).toBe(0o600);
        },
        afterBatch: async (done) => {
          if (done === 1) {
            await prisma.travTrackImport.update({
              where: { id: row.id },
              data: { status: "cancelled" },
            });
          }
        },
      }
    );
    expect(outcome.status).toBe("cancelled");
    expect(spool).not.toBe("");
    expect(fs.existsSync(spool)).toBe(false);
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

  it("a resume with another file than the import was started with is refused", async () => {
    const row = await newRow();
    const { sleep } = noWait();
    await runGpxImport(row.id, userId, { buffer: records(1_500) }, { sleep, batchSize: 1000 });
    await prisma.travTrackImport.update({ where: { id: row.id }, data: { status: "partial" } });
    const code = await startGpxImport(
      userId,
      { buffer: records(1_500, 50_000), originalName: "other.json" },
      { resumeOf: row.id, sleep }
    ).then(
      () => null,
      (err: unknown) => (err instanceof AppError ? err.code : String(err))
    );
    expect(code).toBe("TRAVTRACK_IMPORT_FILE_MISMATCH");
    expect((await rowOf(row.id)).status).toBe("partial");
    expect(await pointCount()).toBe(1_500);
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
    const dbError = jest.spyOn(dbLogger, "error");
    const warn = jest.spyOn(logger, "warn");
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
    // An expected retry is one warning with its attempt, not an error.
    expect(dbError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "travtrack.import.batch_busy", attempt: 1 })
    );
    dbError.mockRestore();
    warn.mockRestore();
  });

  it("a lock-timeout retry logs no error; only the last failed try does", async () => {
    const row = await newRow();
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
    let spool = "";
    const dbError = jest.spyOn(dbLogger, "error");
    const appError = jest.spyOn(logger, "error");
    const warn = jest.spyOn(logger, "warn");
    try {
      await expect(
        runGpxImport(
          row.id,
          userId,
          { buffer: records(50) },
          { lockTimeoutMs: 100, sleep: async () => {}, onSpool: (path) => (spool = path) }
        )
      ).rejects.toBeDefined();
    } finally {
      release();
      await holder;
    }
    const busyWarnings = warn.mock.calls.filter(
      ([e]) => (e as { operation?: string }).operation === "travtrack.import.batch_busy"
    );
    expect(busyWarnings.map(([e]) => (e as { attempt: number }).attempt)).toEqual([1, 2, 3]);
    // The fourth and last try: one database error and one import error, nothing before it.
    expect(dbError).toHaveBeenCalledTimes(1);
    expect(appError).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "travtrack.import.batch_failed", attempt: 4 })
    );
    expect((await rowOf(row.id)).status).toBe("failed");
    // A failed import removes its points file as well.
    expect(spool).not.toBe("");
    expect(fs.existsSync(spool)).toBe(false);
    dbError.mockRestore();
    appError.mockRestore();
    warn.mockRestore();
  });

  it("a run that stores nothing new says so in its report", async () => {
    const { sleep } = noWait();
    const file = records(500);
    const first = await newRow();
    await runGpxImport(first.id, userId, { buffer: file }, { sleep });
    const again = await newRow();
    const outcome = await runGpxImport(again.id, userId, { buffer: file }, { sleep });
    expect(outcome.report).toMatchObject({ stored: 0, duplicate: 500, noNewPoints: true });
    expect((await rowOf(again.id)).report).toMatchObject({ noNewPoints: true });
    expect((await rowOf(first.id)).report).not.toHaveProperty("noNewPoints");
  });
});

describe("TravTrack — file imports take turns across accounts", () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    a = await makeUser(`${PREFIX}turn-a`);
    b = await makeUser(`${PREFIX}turn-b`);
  });

  beforeEach(async () => {
    await wipeTravTrack([a, b]);
    await prisma.travTrackImport.deleteMany({ where: { userId: { in: [a, b] } } });
  });

  afterAll(async () => {
    await wipeTravTrack([a, b]);
  });

  const rowFor = (userId: string) =>
    prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "Records.json", status: "running" },
    });

  /**
   * A's import starts and holds the turn; B's arrives while A stores its first
   * batch. Slices of two batches of 100, no pauses.
   */
  async function race(aFixes: number, bFixes: number) {
    const slot = new FairSlot(1);
    const order: Array<{ who: "A" | "B"; at: number }> = [];
    const parses = { A: 0, B: 0 };
    const spools: Record<"A" | "B", string> = { A: "", B: "" };
    const doneAt: Record<"A" | "B", number> = { A: -1, B: -1 };
    const [rowA, rowB] = await Promise.all([rowFor(a), rowFor(b)]);
    const common = { slot, sliceBatches: 2, batchSize: 100, sleep: async () => {} };
    let aHolds!: () => void;
    const aStarted = new Promise<void>((r) => (aHolds = r));
    const runA = runGpxImport(
      rowA.id,
      a,
      { buffer: records(aFixes) },
      {
        ...common,
        onBatch: ({ at }) => {
          order.push({ who: "A", at });
          aHolds();
        },
        // Hold A's first slice open until B is queued behind it.
        afterBatch: async (done) => {
          while (done === 1 && slot.waiting() === 0) await new Promise((r) => setTimeout(r, 5));
        },
        onParse: () => (parses.A += 1),
        onSpool: (path) => (spools.A = path),
      }
    ).then((o) => ((doneAt.A = order.length), o));
    // B arrives once A holds the turn.
    const runB = aStarted
      .then(() =>
        runGpxImport(
          rowB.id,
          b,
          { buffer: records(bFixes, 1_000_000) },
          {
            ...common,
            onBatch: ({ at }) => order.push({ who: "B", at }),
            onParse: () => (parses.B += 1),
            onSpool: (path) => (spools.B = path),
          }
        )
      )
      .then((o) => ((doneAt.B = order.length), o));
    const [outA, outB] = await Promise.all([runA, runB]);
    return { order, doneAt, outA, outB, rowA, rowB, parses, spools };
  }

  it("two accounts' imports interleave in slices", async () => {
    const { order, outA, outB } = await race(800, 800);
    expect(outA.status).toBe("succeeded");
    expect(outB.status).toBe("succeeded");
    expect(order.map((o) => o.who).join("")).toBe("AABBAABBAABBAABB");
  });

  it("each import parses its file once however many turns it takes, and its points file goes at the end", async () => {
    const { parses, spools, order } = await race(800, 800);
    // Four turns each (slices of two batches), one parse each.
    expect(order.map((o) => o.who).join("")).toBe("AABBAABBAABBAABB");
    expect(parses).toEqual({ A: 1, B: 1 });
    expect(spools.A).not.toBe("");
    expect(fs.existsSync(spools.A)).toBe(false);
    expect(fs.existsSync(spools.B)).toBe(false);
  });

  it("one account's large import cannot starve another's", async () => {
    const { order, doneAt, outB } = await race(4_000, 200);
    expect(outB.report.stored).toBe(200);
    // B was done after A's first slice, with 38 of A's 40 batches still to go.
    expect(doneAt.B).toBe(4);
    expect(order.filter((o) => o.who === "A")).toHaveLength(40);
  });

  it("a slice end resumes exactly where the import stopped", async () => {
    const { order, outA, outB, rowA, rowB } = await race(1_000, 600);
    const atsOf = (who: "A" | "B") => order.filter((o) => o.who === who).map((o) => o.at);
    expect(atsOf("A")).toEqual(Array.from({ length: 10 }, (_, i) => i * 100));
    expect(atsOf("B")).toEqual(Array.from({ length: 6 }, (_, i) => i * 100));
    expect(outA.report).toMatchObject({ stored: 1_000, duplicate: 0 });
    expect(outB.report).toMatchObject({ stored: 600, duplicate: 0 });
    expect(await prisma.travTrackPoint.count({ where: { userId: a } })).toBe(1_000);
    expect(await prisma.travTrackPoint.count({ where: { userId: b } })).toBe(600);
    expect(
      (await prisma.travTrackImport.findUniqueOrThrow({ where: { id: rowA.id } })).cursor
    ).toBe(1_000);
    expect(
      (await prisma.travTrackImport.findUniqueOrThrow({ where: { id: rowB.id } })).cursor
    ).toBe(600);
  });

  it("with nobody waiting a slice end keeps the turn, and the turn is freed at the end", async () => {
    const slot = new FairSlot(1);
    await slot.acquire("x");
    expect(await slot.yieldTurn("x")).toBe(false);
    slot.release();
    let got = false;
    await slot.acquire("y").then(() => (got = true));
    expect(got).toBe(true);
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
