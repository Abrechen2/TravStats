import fs from "fs";
import path from "path";

import { prisma } from "../../../db";
import {
  makeFlight,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../travtrack/__tests__/fixtures";
import { readTravTrackDerivation } from "../derivationRead";
import { bumpHistoryGeneration, historyGeneration } from "../generation";
import { observationKey, pointDigest } from "../key";

/**
 * The one read of TravTrack everything derived from it starts with (TravTrack
 * plan E2): every page to the end, the history generation captured before the
 * first, anomalies masked, flight windows marked, keys and digests attached.
 * TravTrack only — Dawarich keeps its own reads.
 */

const PREFIX = "evidence-derivation-read-";
const BASE = Date.parse("2026-10-12T03:00:00Z");
const SEOUL = { lat: 37.5665, lon: 126.978 };
const BUSAN = { lat: 35.1796, lon: 129.0756 };
const WINDOW = { fromMs: BASE, untilMs: BASE + 86_400_000 };

beforeAll(() => {
  // CI sets one; a bare local run has none, and the key module must not mint
  // and persist a real one for a test.
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("readTravTrackDerivation", () => {
  let userId: string;

  const walk = async (minutes: number[], device = "phone-1") => {
    for (const m of minutes) {
      await storePoint(userId, {
        t: BASE + m * 60_000,
        lat: SEOUL.lat + m * 0.0001,
        lon: SEOUL.lon,
        device,
      });
    }
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a window larger than one page is read to the end, oldest first", async () => {
    await walk([4, 0, 3, 1, 2, 6, 5]);
    const read = await readTravTrackDerivation(userId, WINDOW, { pageSize: 2 });
    expect(read.cancelled).toBe(false);
    expect(read.coverage).toBe("complete");
    expect(read.next).toBeNull();
    expect(read.points.map((p) => p.atMs)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((m) => BASE + m * 60_000)
    );
  });

  it("stopping at maxPoints says truncated and keeps the cursor", async () => {
    await walk([0, 1, 2, 3, 4]);
    const first = await readTravTrackDerivation(userId, WINDOW, { pageSize: 2, maxPoints: 3 });
    expect(first.coverage).toBe("truncated");
    expect(first.points.map((p) => p.atMs)).toEqual([0, 1, 2].map((m) => BASE + m * 60_000));
    expect(first.next).not.toBeNull();

    // The cursor continues where the read stopped — nothing skipped, nothing twice.
    const rest = await readTravTrackDerivation(userId, WINDOW, {
      pageSize: 2,
      cursor: first.next ?? undefined,
    });
    expect(rest.coverage).toBe("complete");
    expect(rest.points.map((p) => p.atMs)).toEqual([3, 4].map((m) => BASE + m * 60_000));
  });

  it("a window holding exactly maxPoints is complete", async () => {
    await walk([0, 1, 2]);
    const read = await readTravTrackDerivation(userId, WINDOW, { pageSize: 2, maxPoints: 3 });
    expect(read.coverage).toBe("complete");
    expect(read.next).toBeNull();
    expect(read.points).toHaveLength(3);
  });

  it("the generation is captured before the first page", async () => {
    await walk([0, 1, 2, 3]);
    await prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId));
    const before = await prisma.$transaction((tx) => historyGeneration(tx, userId));
    const read = await readTravTrackDerivation(userId, WINDOW, {
      pageSize: 2,
      // A removal lands while the read is between pages.
      isAllowed: async () => {
        await prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId));
        return true;
      },
    });
    expect(read.generation).toBe(before);
    expect(await prisma.$transaction((tx) => historyGeneration(tx, userId))).toBeGreaterThan(
      before
    );
  });

  it("isAllowed false between pages cancels", async () => {
    await walk([0, 1, 2, 3, 4]);
    let asked = 0;
    const read = await readTravTrackDerivation(userId, WINDOW, {
      pageSize: 2,
      isAllowed: async () => {
        asked += 1;
        return false;
      },
    });
    expect(asked).toBe(1);
    expect(read.cancelled).toBe(true);
    // A cancelled read hands nothing on to derive from.
    expect(read.points).toEqual([]);
  });

  it("a frozen-fix teleport is masked, the points around it stay", async () => {
    await walk([0, 1, 2, 3, 4]);
    await storePoint(userId, { t: BASE + 4.5 * 60_000, ...BUSAN });
    await walk([5, 6, 7, 8]);
    const read = await readTravTrackDerivation(userId, WINDOW);
    expect(read.points.map((p) => p.atMs)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((m) => BASE + m * 60_000)
    );
    // Masked, never deleted.
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(10);
  });

  it("a point inside a flight window is inFlight", async () => {
    // makeFlight: ICN 00:30Z -> CJU 01:30Z, armed 00:00Z..02:00Z.
    await makeFlight(userId);
    const day = Date.parse("2026-10-12T00:00:00Z");
    for (const at of ["2026-10-11T23:50:00Z", "2026-10-12T01:00:00Z", "2026-10-12T02:30:00Z"]) {
      await storePoint(userId, { t: Date.parse(at), lat: 36, lon: 127 });
    }
    const read = await readTravTrackDerivation(userId, {
      fromMs: day - 3_600_000,
      untilMs: day + 6 * 3_600_000,
    });
    expect(read.points.map((p) => [new Date(p.atMs).toISOString(), p.inFlight])).toEqual([
      ["2026-10-11T23:50:00.000Z", false],
      ["2026-10-12T01:00:00.000Z", true],
      ["2026-10-12T02:30:00.000Z", false],
    ]);
  });

  it("a cancelled flight marks nothing in flight", async () => {
    const flightId = await makeFlight(userId);
    await prisma.flight.update({ where: { id: flightId }, data: { status: "cancelled" } });
    await storePoint(userId, { t: Date.parse("2026-10-12T01:00:00Z"), lat: 36, lon: 127 });
    const read = await readTravTrackDerivation(userId, {
      fromMs: Date.parse("2026-10-12T00:00:00Z"),
      untilMs: Date.parse("2026-10-12T06:00:00Z"),
    });
    expect(read.points.map((p) => p.inFlight)).toEqual([false]);
  });

  it("each point carries its neutral key and this account's digest", async () => {
    await walk([0]);
    const [p] = (await readTravTrackDerivation(userId, WINDOW)).points;
    expect(p.key).toBe(observationKey(p));
    expect(p.digest).toBe(pointDigest(userId, p.key));
    expect(p.digest).toMatch(/^[0-9a-f]{32}$/);
  });

  it("reads only this account's points", async () => {
    const otherId = await makeUser(`${PREFIX}b`);
    await wipeTravTrack([otherId]);
    await storePoint(otherId, { t: BASE, ...SEOUL });
    await walk([1]);
    const read = await readTravTrackDerivation(userId, WINDOW);
    expect(read.points.map((p) => p.atMs)).toEqual([BASE + 60_000]);
    await wipeTravTrack([otherId]);
  });
});

/** Relative imports of a source file, resolved to absolute paths. */
function relativeImports(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const specs = [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith("./") || s.startsWith("../"));
  return specs.map((s) => {
    const base = path.resolve(path.dirname(file), s);
    const candidates = [`${base}.ts`, path.join(base, "index.ts")];
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) throw new Error(`unresolved import ${s} in ${file}`);
    return found;
  });
}

describe("the TravTrack derivation read stays TravTrack's", () => {
  const MODULE = ["derivationRead.ts", "anomaly.ts", "toDetectorInput.ts"].map((f) =>
    path.resolve(__dirname, "..", f)
  );
  const DAWARICH_DIR = path.resolve(__dirname, "../../dawarich") + path.sep;
  // The generated Prisma client is not ours to scan, and it reaches no service.
  const GENERATED_DIR = path.resolve(__dirname, "../../../generated") + path.sep;

  it("nothing in this module imports the Dawarich client", () => {
    // Every file the module reaches, transitively: a Dawarich read could hide
    // one import away just as well as in the module itself.
    const seen = new Set<string>();
    const queue = [...MODULE];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!file.startsWith(GENERATED_DIR)) queue.push(...relativeImports(file));
    }
    const reached = [...seen].filter(
      (f) => f.startsWith(DAWARICH_DIR) || /dawarich/i.test(path.basename(f))
    );
    expect(reached).toEqual([]);
  });
});
