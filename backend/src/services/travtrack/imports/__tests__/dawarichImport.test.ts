import { jest } from "@jest/globals";

import { prisma } from "../../../../db";
import { AppError } from "../../../../middleware/errorHandler";
import { encryptApiKey } from "../../../../utils/encryption";
import type {
  DawarichClient,
  DawarichPoint,
  DawarichPointsWindow,
} from "../../../dawarich/dawarichClient";
import { DawarichError, type DawarichErrorKind } from "../../../dawarich/errors";
import { settleAllJobs } from "../../../jobs/jobRegistry";
import { deleteTravTrackRange } from "../../deleteRange";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { deleteTravTrackImport } from "../fileImport";
import {
  getDawarichCopy,
  resumeDawarichCopy,
  startDawarichCopy,
  stopDawarichCopy,
  type CopyRunOptions,
} from "../dawarichImport";

/**
 * Copying an account's own Dawarich history into TravTrack (TravTrack plan
 * L6, review focus 30). Dawarich is only read, through the account's own
 * connection; every point goes through the one ingest (zones, deleted spans,
 * duplicates); a day is one transaction and the checkpoint, fenced by the
 * copy's status under the lock, so a deletion wins every race; and the report
 * says `incomplete` with the hours and days it could not get.
 */

const PREFIX = "travtrack-dwcopy-";
const HOUR = 3_600_000;

type Fake = {
  id: number;
  tMs: number;
  lat: number;
  lon: number;
  velocity?: number | null;
  bad?: boolean;
};

const at = (iso: string) => Date.parse(iso);

/** Two months of history: three days in March and one in April. */
function history(): Fake[] {
  let id = 100;
  const day = (iso: string, hours: number[], lat: number, lon: number) =>
    hours.map((h, i) => ({
      id: (id += 1),
      tMs: at(iso) + h * HOUR,
      lat: lat + i * 0.001,
      lon: lon + i * 0.001,
    }));
  return [
    ...day("2026-03-30T00:00:00Z", [1, 5, 9], 37.5, 127.0),
    ...day("2026-03-31T00:00:00Z", [2, 3], 35.1, 129.0),
    ...day("2026-04-02T00:00:00Z", [0, 6, 12, 23], 33.4, 126.5),
  ];
}

/**
 * A Dawarich that answers from a list, inclusively on both ends as the real
 * one does, newest first trimmed to `cap` with `truncated` when a window holds
 * more. `fail` decides per window whether it throws.
 */
function fakeDawarich(
  points: Fake[],
  opts: { cap?: number; fail?: (w: DawarichPointsWindow) => DawarichErrorKind | null } = {}
): DawarichClient & { windows: DawarichPointsWindow[] } {
  const windows: DawarichPointsWindow[] = [];
  return {
    windows,
    checkHealth: async () => ({ reachable: true, version: "1.9.2" }),
    async getPoints(w) {
      windows.push(w);
      const kind = opts.fail?.(w) ?? null;
      if (kind) throw new DawarichError(kind, "fake");
      const inside = points.filter(
        (p) => p.tMs >= w.startAt.getTime() && p.tMs <= w.endAt.getTime()
      );
      const newest = [...inside].sort((a, b) => b.tMs - a.tMs);
      const truncated = opts.cap !== undefined && newest.length > opts.cap;
      const kept = truncated ? newest.slice(0, opts.cap) : newest;
      const usable = kept.filter((p) => !p.bad);
      const mapped: DawarichPoint[] = usable.map((p) => ({
        id: p.id,
        latitude: p.lat,
        longitude: p.lon,
        timestampMs: p.tMs,
        altitude: null,
        accuracy: 8,
        velocity: p.velocity ?? null,
        trackId: null,
      }));
      return {
        points: mapped.sort((a, b) => a.timestampMs - b.timestampMs),
        truncated,
        unusable: kept.length - usable.length,
      };
    },
  };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof AppError ? err.code : String(err);
  }
};

describe("TravTrack — copying the Dawarich history", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const range = { fromDay: "2026-03-29", untilDay: "2026-04-03" };

  async function copy(client: DawarichClient, opts: CopyRunOptions = {}, r = range) {
    const started = await startDawarichCopy(userId, r, {
      clientFor: () => client,
      pauseMs: 0,
      ...opts,
    });
    await settleAllJobs();
    return started;
  }

  const stored = () => prisma.travTrackPoint.findMany({ where: { userId }, orderBy: { t: "asc" } });

  async function ownConnection() {
    await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        data: {},
        dawarichBaseUrl: "http://dawarich.test",
        dawarichApiKey: encryptApiKey("key"),
      },
      update: { dawarichBaseUrl: "http://dawarich.test", dawarichApiKey: encryptApiKey("key") },
    });
  }

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await settleAllJobs();
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackDawarichImport.deleteMany({ where: { userId } });
    await prisma.travTrackImport.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await ownConnection();
    delete process.env.DAWARICH_BASE_URL;
    delete process.env.DAWARICH_API_KEY;
  });

  afterAll(async () => {
    await settleAllJobs();
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("copies a two-month fake history day by day with the report per month", async () => {
    const { importId } = await copy(fakeDawarich(history()));
    const points = await stored();
    expect(points).toHaveLength(9);
    expect(new Set(points.map((p) => p.origin))).toEqual(new Set([`dawarich:${importId}`]));
    expect(new Set(points.map((p) => p.deviceId))).toEqual(new Set(["dawarich"]));
    expect(points[0].originRef).toBe("101");
    const view = await getDawarichCopy(userId);
    expect(view.copy).toMatchObject({
      importId,
      status: "complete",
      fromDay: "2026-03-29",
      untilDay: "2026-04-03",
      nextDay: "2026-04-04",
      daysDone: 6,
      daysTotal: 6,
      totals: { read: 9, stored: 9, duplicate: 0, truncatedHours: 0, unreachableDays: 0 },
    });
    expect(view.copy?.months).toEqual([
      expect.objectContaining({
        month: "2026-03",
        read: 5,
        stored: 5,
        daysWithPoints: 2,
        truncatedHours: [],
        unreachableDays: [],
      }),
      expect.objectContaining({ month: "2026-04", read: 4, stored: 4, daysWithPoints: 1 }),
    ]);
    // The list of imports shows it like a file import.
    const row = await prisma.travTrackImport.findUniqueOrThrow({ where: { id: importId } });
    expect(row).toMatchObject({ kind: "dawarich", status: "succeeded" });
    expect(row.report).toMatchObject({ read: 9, stored: 9, duplicate: 0 });
  });

  it("reads a month in one window when it is whole", async () => {
    const client = fakeDawarich(history());
    await copy(client);
    // March (from the 29th) and April (until the 3rd): two reads, nothing else.
    expect(client.windows.map((w) => [w.startAt.toISOString(), w.endAt.toISOString()])).toEqual([
      ["2026-03-29T00:00:00.000Z", "2026-03-31T23:59:59.000Z"],
      ["2026-04-01T00:00:00.000Z", "2026-04-03T23:59:59.000Z"],
    ]);
  });

  it("subdivides a truncated day, lists an hour still truncated, and ends incomplete", async () => {
    const busy = Array.from({ length: 5 }, (_, i) => ({
      id: 900 + i,
      tMs: at("2026-03-30T05:00:00Z") + i * 60_000,
      lat: 37.6 + i * 0.001,
      lon: 127.1,
    }));
    const points = [...history().filter((p) => p.tMs < at("2026-03-31T00:00:00Z")), ...busy];
    await copy(fakeDawarich(points, { cap: 3 }));
    const view = await getDawarichCopy(userId);
    expect(view.copy?.status).toBe("incomplete");
    expect(view.copy?.months[0]).toMatchObject({
      month: "2026-03",
      truncatedHours: ["2026-03-30T05:00Z"],
    });
    // The hours that came back whole are stored, and the newest slice of the busy one.
    const times = (await stored()).map((p) => p.t.toISOString());
    expect(times).toEqual(
      expect.arrayContaining([
        "2026-03-30T01:00:00.000Z",
        "2026-03-30T09:00:00.000Z",
        "2026-03-30T05:04:00.000Z",
      ])
    );
    expect(times).not.toContain("2026-03-30T05:00:00.000Z");
  });

  it("pauses with the checkpoint kept when Dawarich is unreachable; resume stores nothing twice", async () => {
    let down = true;
    const client = fakeDawarich(history(), {
      fail: (w) => (down && w.startAt >= new Date("2026-04-01T00:00:00Z") ? "unreachable" : null),
    });
    await copy(client);
    let view = await getDawarichCopy(userId);
    expect(view.copy).toMatchObject({
      status: "paused",
      lastErrorKind: "unreachable",
      nextDay: "2026-04-01",
    });
    expect(await stored()).toHaveLength(5);
    down = false;
    await resumeDawarichCopy(userId, { clientFor: () => client, pauseMs: 0 });
    await settleAllJobs();
    view = await getDawarichCopy(userId);
    expect(view.copy).toMatchObject({
      status: "complete",
      lastErrorKind: null,
      totals: { stored: 9, duplicate: 0 },
    });
    expect(await stored()).toHaveLength(9);
  });

  it("a crash after a day's commit repeats nothing on resume", async () => {
    const client = fakeDawarich(history());
    let crashed = false;
    await copy(client, {
      afterDay: async () => {
        if (crashed) return;
        crashed = true;
        throw new Error("process died");
      },
    });
    let view = await getDawarichCopy(userId);
    expect(view.copy).toMatchObject({ status: "failed", nextDay: "2026-03-31" });
    expect(await stored()).toHaveLength(3);
    await resumeDawarichCopy(userId, { clientFor: () => client, pauseMs: 0 });
    await settleAllJobs();
    view = await getDawarichCopy(userId);
    expect(view.copy).toMatchObject({ status: "complete", totals: { stored: 9, duplicate: 0 } });
  });

  it("a crash before a day's commit stores nothing of it, and resume copies it once", async () => {
    const client = fakeDawarich(history());
    let crashed = false;
    await copy(client, {
      beforeCommit: async () => {
        if (crashed) return;
        crashed = true;
        throw new Error("process died");
      },
    });
    expect(await stored()).toHaveLength(0);
    expect((await getDawarichCopy(userId)).copy?.nextDay).toBe("2026-03-29");
    await resumeDawarichCopy(userId, { clientFor: () => client, pauseMs: 0 });
    await settleAllJobs();
    expect(await stored()).toHaveLength(9);
    expect((await getDawarichCopy(userId)).copy?.totals).toMatchObject({ read: 9, stored: 9 });
  });

  it("a running copy with a stale heartbeat reads as interrupted and resumes", async () => {
    const imp = await prisma.travTrackImport.create({
      data: { userId, kind: "dawarich", fileName: "Dawarich", status: "running" },
    });
    await prisma.travTrackDawarichImport.create({
      data: {
        userId,
        importId: imp.id,
        status: "running",
        runId: "a-run-of-a-process-that-died",
        fromDay: new Date("2026-03-29"),
        untilDay: new Date("2026-04-03"),
        nextDay: new Date("2026-03-31"),
        daysDone: 2,
        heartbeatAt: new Date(Date.now() - HOUR),
      },
    });
    expect((await getDawarichCopy(userId)).copy?.status).toBe("interrupted");
    await resumeDawarichCopy(userId, { clientFor: () => fakeDawarich(history()), pauseMs: 0 });
    await settleAllJobs();
    const view = await getDawarichCopy(userId);
    expect(view.copy?.status).toBe("complete");
    // From the checkpoint: March 30 was never read again.
    expect((await stored()).map((p) => p.t.toISOString().slice(0, 10))).not.toContain("2026-03-30");
  });

  it("a range deleted while the copy runs stays empty", async () => {
    let deleted = false;
    await copy(fakeDawarich(history()), {
      afterDay: async () => {
        if (deleted) return;
        deleted = true;
        await deleteTravTrackRange(
          userId,
          new Date("2026-04-02T00:00:00Z"),
          new Date("2026-04-03T00:00:00Z")
        );
      },
    });
    const days = (await stored()).map((p) => p.t.toISOString().slice(0, 10));
    expect(days).not.toContain("2026-04-02");
    const view = await getDawarichCopy(userId);
    expect(view.copy?.months[1]).toMatchObject({
      month: "2026-04",
      stored: 0,
      dropped: expect.objectContaining({ deleted_range: 4 }),
    });
  });

  it("deleting the copy while it runs cancels it: no later day stores a point", async () => {
    let importId = "";
    const started = await startDawarichCopy(userId, range, {
      clientFor: () => fakeDawarich(history()),
      pauseMs: 0,
      afterDay: async () => {
        await deleteTravTrackImport(userId, importId);
      },
    });
    importId = started.importId;
    await settleAllJobs();
    expect(await stored()).toHaveLength(0);
    expect((await getDawarichCopy(userId)).copy?.status).toBe("cancelled");
    expect(
      (await prisma.travTrackImport.findUniqueOrThrow({ where: { id: importId } })).status
    ).toBe("cancelled");
  });

  it("counts a point inside a privacy zone as dropped", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", lat: 35.1, lon: 129.0, radiusM: 1000 },
    });
    await copy(fakeDawarich(history()));
    const view = await getDawarichCopy(userId);
    expect(view.copy?.months[0]).toMatchObject({
      read: 5,
      stored: 3,
      dropped: expect.objectContaining({ privacy_zone: 2 }),
    });
    expect(view.copy?.status).toBe("complete");
  });

  it("counts rows Dawarich sent without a usable position as invalid, and drops a negative speed only", async () => {
    const points: Fake[] = [
      ...history(),
      { id: 1, tMs: at("2026-03-30T12:00:00Z"), lat: 0, lon: 0, bad: true },
      { id: 2, tMs: at("2026-03-30T13:00:00Z"), lat: 37.7, lon: 127.2, velocity: -1 },
    ];
    await copy(fakeDawarich(points));
    const view = await getDawarichCopy(userId);
    expect(view.copy?.months[0]).toMatchObject({
      read: 7,
      stored: 6,
      dropped: expect.objectContaining({ invalid: 1 }),
    });
    const slow = (await stored()).find((p) => p.originRef === "2");
    expect(slow?.speedMps).toBeNull();
  });

  it("a Dawarich point equal to a Companion fix is a duplicate, and the Companion's stays", async () => {
    const first = history()[0];
    await storePoint(userId, { t: first.tMs, lat: first.lat, lon: first.lon });
    await copy(fakeDawarich(history()));
    const view = await getDawarichCopy(userId);
    expect(view.copy?.totals).toMatchObject({ read: 9, stored: 8, duplicate: 1 });
    const companion = await prisma.travTrackPoint.count({
      where: { userId, origin: "companion:phone-1" },
    });
    expect(companion).toBe(1);
  });

  it("leaves the provider unchanged and creates no finding", async () => {
    const before = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    await copy(fakeDawarich(history()));
    const after = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(after.locationProvider).toBe(before.locationProvider);
    expect(after.locationProviderRev).toBe(before.locationProviderRev);
    expect(await prisma.locationSuggestion.count({ where: { userId } })).toBe(0);
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
  });

  it("sends nothing to Dawarich but GET /api/v1/points", async () => {
    const realFetch = global.fetch;
    const spy = jest.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const start = Date.parse(url.searchParams.get("start_at") ?? "");
      const end = Date.parse(url.searchParams.get("end_at") ?? "");
      const page = Number(url.searchParams.get("page"));
      const rows =
        page > 1
          ? []
          : history()
              .filter((p) => p.tMs >= start && p.tMs <= end)
              .reverse()
              .map((p) => ({
                id: p.id,
                latitude: String(p.lat),
                longitude: String(p.lon),
                timestamp: p.tMs / 1000,
              }));
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    global.fetch = spy as unknown as typeof fetch;
    try {
      await startDawarichCopy(userId, range, { pauseMs: 0 });
      await settleAllJobs();
    } finally {
      global.fetch = realFetch;
    }
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [input, init] of spy.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe("http://dawarich.test");
      expect(url.pathname).toBe("/api/v1/points");
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
    }
    expect(await stored()).toHaveLength(9);
  });

  it("refuses an admin-global or ENV connection: only the account's own", async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    process.env.DAWARICH_BASE_URL = "http://shared-dawarich.test";
    process.env.DAWARICH_API_KEY = "shared";
    expect(await codeOf(startDawarichCopy(userId, range))).toBe("DAWARICH_NOT_CONFIGURED");
    expect(await prisma.travTrackImport.count({ where: { userId } })).toBe(0);
    expect((await getDawarichCopy(userId)).connection).toBe("shared");
  });

  it("refuses a second copy while one runs, and a range it cannot read", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await startDawarichCopy(userId, range, {
      clientFor: () => fakeDawarich(history()),
      pauseMs: 0,
      afterDay: () => held,
    });
    expect(await codeOf(startDawarichCopy(userId, range))).toBe("TRAVTRACK_IMPORT_RUNNING");
    release();
    await settleAllJobs();
    expect(
      await codeOf(startDawarichCopy(userId, { fromDay: "2026-04-03", untilDay: "2026-03-29" }))
    ).toBe("VALIDATION_FAILED");
    expect(
      await codeOf(startDawarichCopy(userId, { fromDay: "2026-03-01", untilDay: "2999-01-01" }))
    ).toBe("VALIDATION_FAILED");
  });

  it("stop pauses between two days, and resume goes on from there", async () => {
    const client = fakeDawarich(history());
    let stopped = false;
    await copy(client, {
      afterDay: async () => {
        if (stopped) return;
        stopped = true;
        await stopDawarichCopy(userId);
      },
    });
    let view = await getDawarichCopy(userId);
    expect(view.copy).toMatchObject({ status: "paused", nextDay: "2026-03-31" });
    expect(await stored()).toHaveLength(3);
    expect(await codeOf(stopDawarichCopy(userId))).toBe("TRAVTRACK_IMPORT_NOT_RUNNING");
    await resumeDawarichCopy(userId, { clientFor: () => client, pauseMs: 0 });
    await settleAllJobs();
    view = await getDawarichCopy(userId);
    expect(view.copy?.status).toBe("complete");
    expect(await stored()).toHaveLength(9);
  });

  it("pauses when TravTrack is switched off, and stores nothing more", async () => {
    let off = false;
    await copy(fakeDawarich(history()), {
      afterDay: async () => {
        if (off) return;
        off = true;
        await switches.set({ beta: true, config: false });
      },
    });
    const view = await getDawarichCopy(userId);
    expect(view.copy).toMatchObject({ status: "paused", lastErrorKind: "disabled" });
    expect(await stored()).toHaveLength(3);
  });
});
