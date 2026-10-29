import { DIAGNOSTICS_RETENTION_DAYS } from "../../../schemas/travtrackDiagnostics";

/**
 * One diagnostics event, judged on its own (spec
 * 2026-10-29-travtrack-diagnostics, "Per event"). The log must not carry a
 * position, and a blacklist of key names alone could not hold that — a note's
 * free text or a fix id (`atMs:lat:lon`) would slip through — so values are
 * typed: identifiers, numbers of at most two decimals, booleans, null, and one
 * level of integer counts. Two decimals of a degree are ~1 km, so a
 * coordinate cannot travel even under an innocent key.
 */

export type RejectReason = "time" | "kind" | "data" | "coordinates";

export type DiagnosticValue = string | number | boolean | null | Record<string, number>;

export interface JudgedEvent {
  t: Date;
  kind: string;
  data: Record<string, DiagnosticValue>;
}

const KIND = /^[a-z][a-zA-Z0-9.]{0,39}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const IDENT = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
/** An ISO instant that names its zone (`Z` or an offset). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_KEYS = 24;
const MAX_DATA_BYTES = 2048;
const FUTURE_SLACK_MS = 10 * 60_000;

/** Keys that name a position; the phone's fix ids embed one too. */
const COORDINATE_KEYS = new Set([
  "lat",
  "lon",
  "lng",
  "latitude",
  "longitude",
  "coords",
  "coordinate",
  "coordinates",
  "location",
  "position",
  "fixid",
  "originref",
]);

/** At most two decimals, tolerating binary noise (`0.45` is `0.450000…01`). */
function twoDecimals(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

function scalar(value: unknown): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return twoDecimals(value);
  return typeof value === "string" && IDENT.test(value);
}

function counts(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_KEYS &&
    entries.every(([k, n]) => IDENT.test(k) && typeof n === "number" && Number.isSafeInteger(n))
  );
}

function judgeData(raw: unknown): Record<string, DiagnosticValue> | RejectReason {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "data";
  const entries = Object.entries(raw);
  if (entries.length > MAX_KEYS) return "data";
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_DATA_BYTES) return "data";
  for (const [key, value] of entries) {
    if (COORDINATE_KEYS.has(key.toLowerCase())) return "coordinates";
    if (!KEY.test(key)) return "data";
    if (!scalar(value) && !counts(value)) return "data";
  }
  return Object.fromEntries(entries) as Record<string, DiagnosticValue>;
}

export function judgeEvent(
  raw: Record<string, unknown>,
  nowMs: number
): JudgedEvent | RejectReason {
  const { t, kind, data, ...rest } = raw;
  if (Object.keys(rest).length > 0) return "data";
  if (typeof t !== "string" || !INSTANT.test(t)) return "time";
  const tMs = Date.parse(t);
  if (
    !Number.isFinite(tMs) ||
    tMs < nowMs - DIAGNOSTICS_RETENTION_DAYS * 86_400_000 ||
    tMs > nowMs + FUTURE_SLACK_MS
  ) {
    return "time";
  }
  if (typeof kind !== "string" || !KIND.test(kind)) return "kind";
  const judged = judgeData(data);
  if (typeof judged === "string") return judged;
  return { t: new Date(tMs), kind, data: judged };
}
