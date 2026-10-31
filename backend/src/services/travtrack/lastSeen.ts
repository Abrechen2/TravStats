/**
 * „Zuletzt gesehen" (TravTrack plan L2): where the account's own history last
 * placed it — the newest stored point that is a real fix.
 *
 *   - Anomalies are skipped by the derivations' own rules (`anomaly.ts`): a
 *     bad fix and a masked run are never the last position. A jump at the
 *     very end that has not come back yet is held back as well — the mask
 *     leaves it alone because it cannot tell which side is wrong, and a
 *     position shown as "where you are" must not be the doubtful side. A
 *     step inside one of the account's flight windows is an aircraft's, not
 *     a jump. Six fixes after the jump settle it.
 *   - Privacy: points inside a privacy zone are never stored, so this is the
 *     last position before a zone (spec §3). The read does not rely on that:
 *     a row inside a zone in force, inside a former zone's circle it was
 *     recorded under, or inside a deleted span is dropped here once more.
 *   - Owner only. Nothing in sharing, a public link, a `.travstats` file, a
 *     comparison or federation reads this (`lastSeen.separation.test.ts`),
 *     and the answer keeps the `/api` default `no-store`.
 *
 * TravTrack only: a Dawarich equivalent would read Dawarich unfiltered and is
 * not built (the plan's open decision (a)).
 */
import { prisma } from "../../db";
import type { LocationObservation } from "../locationProvider/types";
import { anomalyMask, stableCut, type FlightWindow } from "../locationEvidence/anomaly";
import { flightsNear } from "../locationEvidence/flightsNear";
import { flightRecorderWindows } from "../tripRecording/bounds";
import { inDeletedRange, inPrivacyZone } from "./classify";
import { privacyCircleSet } from "./privacyCircles";

export type LastSeen = {
  atMs: number;
  lat: number;
  lon: number;
  accuracyM: number | null;
  deviceId: string | null;
  /** The paired phone's, the file's or the live source's own name; null when none is known. */
  deviceLabel: string | null;
  /** Where the point came from: `companion:<deviceId>`, `gpx:<importId>`, … */
  origin: string;
};

/** Points read per page, newest first. */
export const LAST_SEEN_PAGE = 500;
/** At most this many points are judged; past it the answer abstains (null). */
export const LAST_SEEN_MAX = 2_000;

type Row = {
  id: string;
  seq: bigint;
  t: Date;
  lat: number;
  lon: number;
  accuracyM: number | null;
  deviceId: string | null;
  origin: string;
};

const SELECT = {
  id: true,
  seq: true,
  t: true,
  lat: true,
  lon: true,
  accuracyM: true,
  deviceId: true,
  origin: true,
} as const;

const observation = (r: Row): LocationObservation => ({
  ref: r.seq.toString(),
  atMs: r.t.getTime(),
  lat: r.lat,
  lon: r.lon,
  accuracyM: r.accuracyM,
  altitudeM: null,
  speedMps: null,
  courseDeg: null,
  deviceId: r.deviceId,
});

/**
 * The flight windows of a read that only ever reaches further back: the span
 * ends at the newest point, each page moves its start earlier, and only the
 * stretch not asked yet is queried and resolved.
 */
function flightWindowReader(userId: string, untilMs: number) {
  const seen = new Set<string>();
  const windows: FlightWindow[] = [];
  let loadedFrom: number | null = null;
  return async (fromMs: number): Promise<FlightWindow[]> => {
    if (loadedFrom === null || fromMs < loadedFrom) {
      const near = await flightsNear(userId, fromMs, loadedFrom ?? untilMs);
      const fresh = near.filter((f) => !seen.has(f.id));
      fresh.forEach((f) => seen.add(f.id));
      windows.push(...(await flightRecorderWindows(fresh)));
      loadedFrom = fromMs;
    }
    return windows.filter(([from, to]) => from <= untilMs && to >= fromMs);
  };
}

const newer = (a: Row, b: Row): boolean => a.t > b.t || (+a.t === +b.t && a.seq > b.seq);

/**
 * The newest acceptable row of `rows` (oldest first, privacy-safe already),
 * judged per device: masked fixes are out, and so is a device's still-open
 * run at its end (`stableCut`).
 */
function newestAcceptable(rows: readonly Row[], windows: readonly FlightWindow[]): Row | null {
  const byDevice = new Map<string | null, Row[]>();
  for (const r of rows) byDevice.set(r.deviceId, [...(byDevice.get(r.deviceId) ?? []), r]);
  let best: Row | null = null;
  for (const deviceRows of byDevice.values()) {
    const obs = deviceRows.map(observation);
    const mask = anomalyMask(obs, { flightWindows: windows });
    const { until } = stableCut(obs, { flightWindows: windows });
    for (let i = Math.min(until, obs.length) - 1; i >= 0; i -= 1) {
      if (mask[i]) continue;
      if (!best || newer(deviceRows[i], best)) best = deviceRows[i];
      break;
    }
  }
  return best;
}

/** The device's own name, read from this account's rows only. */
async function deviceLabelOf(userId: string, deviceId: string | null): Promise<string | null> {
  if (!deviceId) return null;
  if (deviceId.startsWith("file:")) {
    const row = await prisma.travTrackImport.findFirst({
      where: { userId, id: deviceId.slice(5) },
      select: { fileName: true },
    });
    return row?.fileName ?? null;
  }
  const live = /^(owntracks|overland):(.+)$/.exec(deviceId);
  if (live) {
    const row = await prisma.travTrackIngestToken.findFirst({
      where: { userId, kind: live[1], id: live[2] },
      select: { label: true },
    });
    return row?.label ?? null;
  }
  const token = await prisma.apiToken.findFirst({
    where: { userId, deviceId },
    orderBy: { createdAt: "desc" },
    select: { label: true },
  });
  return token?.label ?? null;
}

export async function lastSeen(userId: string): Promise<LastSeen | null> {
  const circlesAt = await privacyCircleSet(userId);
  const rows: Row[] = [];
  let before: { t: Date; seq: bigint } | null = null;
  let windowsFrom: ReturnType<typeof flightWindowReader> | null = null;
  while (rows.length < LAST_SEEN_MAX) {
    const page: Row[] = await prisma.travTrackPoint.findMany({
      where: {
        userId,
        ...(before
          ? { OR: [{ t: { lt: before.t } }, { t: before.t, seq: { lt: before.seq } }] }
          : {}),
      },
      orderBy: [{ t: "desc" }, { seq: "desc" }],
      take: LAST_SEEN_PAGE,
      select: SELECT,
    });
    if (page.length === 0) break;
    const last = page[page.length - 1];
    before = { t: last.t, seq: last.seq };
    rows.push(...page);

    const oldest = rows[rows.length - 1].t;
    const deleted = await prisma.travTrackDeletedRange.findMany({
      where: { userId, toAt: { gt: oldest } },
      select: { fromAt: true, toAt: true },
    });
    const safe = rows
      .filter((r) => !inDeletedRange(r.t.getTime(), deleted))
      .filter((r) => !inPrivacyZone(r, circlesAt(r.t.getTime())))
      .reverse();
    windowsFrom ??= flightWindowReader(userId, rows[0].t.getTime());
    const found = newestAcceptable(safe, await windowsFrom(oldest.getTime()));
    if (found) {
      return {
        atMs: found.t.getTime(),
        lat: found.lat,
        lon: found.lon,
        accuracyM: found.accuracyM,
        deviceId: found.deviceId,
        deviceLabel: await deviceLabelOf(userId, found.deviceId),
        origin: found.origin,
      };
    }
    if (page.length < LAST_SEEN_PAGE) break;
  }
  return null;
}
