import { createHash } from "node:crypto";

/**
 * One point of a TravTrack upload, read and judged on its own (TravTrack plan
 * T2; ported from the archived location history, spec 2026-10-20 §10.1,
 * §10.2): pure, so the rules are testable without a database.
 *
 * Besides the position a point names what the phone recorded it for
 * (`purpose`, informational) and which flights and trips it belongs to
 * (`entries`): one fix the flight and the trip recorder both hand over is one
 * point with two links, never two points.
 */

export type DropReason = "invalid" | "null_island" | "deleted_range" | "privacy_zone";

export const POINT_PURPOSES = ["everyday", "flight", "trip"] as const;
export type PointPurpose = (typeof POINT_PURPOSES)[number];

export const ENTRY_KINDS = ["flight", "trip"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export type EntryRef = { kind: EntryKind; id: string };

/** Entries one point may name: a flight inside a trip, and some headroom. */
export const MAX_POINT_ENTRIES = 4;
/** The longest entry id: a uuid, or a client id of the same order. */
export const MAX_ENTRY_ID_LENGTH = 64;

export type ParsedPoint = {
  index: number;
  /** The origin's own id for the point. */
  ref: string;
  tMs: number;
  tS: number;
  lat: number;
  lon: number;
  accuracyM: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  course: number | null;
  motion: string | null;
  purpose: PointPurpose;
  /** Distinct, in the order sent. */
  entries: EntryRef[];
};

export type Judged =
  | { kind: "point"; point: ParsedPoint }
  | { kind: "dropped"; index: number; ref: string | null; reason: DropReason };

const MOTIONS = new Set(["stationary", "walking", "running", "cycling", "automotive", "unknown"]);

const finiteIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** An optional number: absent or null is null; present and out of range makes the point invalid. */
function optional(v: unknown, min: number, max: number): number | null | undefined {
  if (v === undefined || v === null) return null;
  return finiteIn(v, min, max) ?? undefined;
}

/** Not before 2000 and not more than a day ahead: a phone with a reset clock. */
export const acceptedInstant = (ms: number): boolean =>
  Number.isFinite(ms) && ms >= Date.UTC(2000, 0, 1) && ms <= Date.now() + 86_400_000;

/** An instant WITH an offset, as the rest of the API takes it. */
export function instantMs(v: unknown): number | null {
  if (typeof v !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  return acceptedInstant(ms) ? ms : null;
}

const hasControlChar = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 0x20);

/** `purpose`: absent or null is `everyday`; anything but the three makes the point invalid. */
function readPurpose(v: unknown): PointPurpose | undefined {
  if (v === undefined || v === null) return "everyday";
  return (POINT_PURPOSES as readonly unknown[]).includes(v) ? (v as PointPurpose) : undefined;
}

/** `entries`: absent or null is none; one malformed entry makes the point invalid. */
function readEntries(v: unknown): EntryRef[] | undefined {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_POINT_ENTRIES) return undefined;
  const out: EntryRef[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) return undefined;
    const { kind, id } = e as Record<string, unknown>;
    if (!(ENTRY_KINDS as readonly unknown[]).includes(kind)) return undefined;
    if (typeof id !== "string" || id.trim() === "" || id.length > MAX_ENTRY_ID_LENGTH) {
      return undefined;
    }
    if (hasControlChar(id)) return undefined;
    if (!out.some((x) => x.kind === kind && x.id === id)) out.push({ kind: kind as EntryKind, id });
  }
  return out;
}

export function judgePoint(raw: Record<string, unknown>, index: number): Judged {
  // No control characters: PostgreSQL cannot store a NUL in text, and one bad id
  // must cost its own point, not the batch's transaction.
  const ref =
    typeof raw.id === "string" &&
    raw.id.trim() !== "" &&
    raw.id.length <= 200 &&
    !hasControlChar(raw.id)
      ? raw.id
      : null;
  const tMs = instantMs(raw.t);
  const lat = finiteIn(raw.lat, -90, 90);
  const lon = finiteIn(raw.lon, -180, 180);
  const accuracyM = optional(raw.accuracy, 0, 100_000);
  const altitudeM = optional(raw.altitude, -1_000, 30_000);
  const speedMps = optional(raw.speed, 0, 1_000);
  const course = optional(raw.course, 0, 360);
  const motion = raw.motion === undefined || raw.motion === null ? null : raw.motion;
  const purpose = readPurpose(raw.purpose);
  const entries = readEntries(raw.entries);
  if (
    ref === null ||
    tMs === null ||
    lat === null ||
    lon === null ||
    accuracyM === undefined ||
    altitudeM === undefined ||
    speedMps === undefined ||
    course === undefined ||
    purpose === undefined ||
    entries === undefined ||
    (motion !== null && (typeof motion !== "string" || !MOTIONS.has(motion)))
  ) {
    return { kind: "dropped", index, ref, reason: "invalid" };
  }
  // 0/0 is where a fix without a position lands (Dawarich drops it too).
  if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) {
    return { kind: "dropped", index, ref, reason: "null_island" };
  }
  return {
    kind: "point",
    point: {
      index,
      ref,
      tMs,
      tS: Math.floor(tMs / 1000),
      lat,
      lon,
      accuracyM,
      altitudeM,
      speedMps,
      course,
      motion: motion as string | null,
      purpose,
      entries,
    },
  };
}

/** Dawarich's key: whole second and the exact coordinates. */
export const positionKey = (p: { tS: number; lat: number; lon: number }) =>
  `${p.tS}|${p.lon}|${p.lat}`;

/** An object's keys in a fixed order, recursively, so key order never changes a hash. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .map((k) => [k, canonical(o[k])]);
  }
  return v;
}

/**
 * The upload's content as received, canonicalised: the same points and gaps in
 * the same order always hash the same, whatever order the client wrote their
 * keys in. A retry with the same uploadId must carry exactly this content.
 */
export function payloadHash(
  points: readonly Record<string, unknown>[],
  gaps: readonly Record<string, unknown>[]
): string {
  return createHash("sha256")
    .update(JSON.stringify([canonical(points), canonical(gaps)]))
    .digest("hex");
}

/** Whether an instant lies in one of the deleted spans (`toAt` exclusive). */
export function inDeletedRange(
  tMs: number,
  ranges: readonly { fromAt: Date; toAt: Date }[]
): boolean {
  return ranges.some((r) => tMs >= r.fromAt.getTime() && tMs < r.toAt.getTime());
}

export type ZoneCircle = { lat: number; lon: number; radiusM: number };

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whether a position lies inside one of the privacy zones (edge included). */
export function inPrivacyZone(
  p: { lat: number; lon: number },
  zones: readonly ZoneCircle[]
): boolean {
  return zones.some((z) => distanceM(p, z) <= z.radiusM);
}
