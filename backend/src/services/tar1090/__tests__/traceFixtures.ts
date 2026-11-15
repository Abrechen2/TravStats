/**
 * Synthetic trace files in the real tar1090 / readsb format (see
 * `../traceFormat.ts` for the format source): `timestamp` + rows of
 * `[secsAfterTimestamp, lat, lon, alt_baro|"ground"|null, gs, track, flags, vrate, detail, type]`.
 */

export const DAY_START_S = Date.parse("2026-10-12T00:00:00Z") / 1000;

/** `count` fixes, one per minute from `startOffsetS`, flying east at 35 000 ft. */
export function cruiseRows(startOffsetS: number, count: number, firstFlags = 2): unknown[][] {
  return Array.from({ length: count }, (_, i) => [
    startOffsetS + i * 60,
    50 + i * 0.01,
    8 + i * 0.2,
    i === 0 ? "ground" : 35_000,
    i === 0 ? 5 : 450,
    90,
    i === 0 ? firstFlags : 0,
    0,
    null,
    "adsb_icao",
  ]);
}

export function traceFile(rows: unknown[][], over: Record<string, unknown> = {}) {
  return { icao: "3c6444", r: "d-aixa", t: "A359", timestamp: DAY_START_S, trace: rows, ...over };
}
