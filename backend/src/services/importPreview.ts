import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { prisma } from "../db";
import { getCachedAirport } from "./airportCache";
import { normalizeFlightNumber } from "../schemas/flight";
import logger from "../utils/logger";

export type PreviewSource = "fr24" | "generic_csv";

export interface PreviewRowInput {
  date: string;
  depTimeLocal?: string;
  arrTimeLocal?: string;
  durationSeconds?: number;
  fromIata: string;
  toIata: string;
  flightNumber?: string;
  airline?: string;
  aircraft?: string;
  registration?: string;
  seatNumber?: string;
  seatClass?: "economy" | "premium_economy" | "business" | "first";
  category?: "business" | "vacation" | "private" | "training" | "ferry" | "other";
  notes?: string;
  source: PreviewSource;
  sourceRowIndex: number;
}

export type PreviewFlag =
  | "duration_mismatch"
  | "unresolvable_airport"
  | "malformed_datetime"
  | "missing_required";
export type DedupeHint = "exact_match" | "same_day_same_route" | "none";

export interface PreviewRowEnriched extends PreviewRowInput {
  depUtc: Date;
  arrUtc: Date;
  arrivalLocalCorrected: string;
  depTimezone: string;
  arrTimezone: string;
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  flightNumberNormalised?: string;
  statusDefault: "flown" | "scheduled";
  flags: PreviewFlag[];
  dedupeHint: DedupeHint;
}

export interface PreviewSummary {
  ok: number;
  problems: number;
  duplicates: number;
  unresolvable: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HMS_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const SAFE_DATE = new Date(0);

export const MAX_PREVIEW_ROWS = 1000;

function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Build the enriched preview rows for a user upload. Auth-gated by the
 * caller — `userId` MUST come from the request session (req.userId), never
 * from the request body.
 */
export async function buildPreviewRows(
  userId: string,
  rows: PreviewRowInput[]
): Promise<{ rows: PreviewRowEnriched[]; summary: PreviewSummary }> {
  if (rows.length > MAX_PREVIEW_ROWS) {
    throw new Error(`Too many rows: ${rows.length} > ${MAX_PREVIEW_ROWS}`);
  }

  // Step 1: pre-warm the airport cache by issuing parallel getCachedAirport
  // calls for every unique IATA/ICAO code. The cache de-dupes; subsequent
  // per-row lookups inside the loop are cache hits.
  const codes = new Set<string>();
  for (const r of rows) {
    if (r.fromIata) codes.add(r.fromIata.toUpperCase());
    if (r.toIata) codes.add(r.toIata.toUpperCase());
  }
  await Promise.all([...codes].map((c) => getCachedAirport(c)));

  // Step 2: per-row enrich
  const enriched: PreviewRowEnriched[] = [];
  for (const row of rows) {
    const flags: PreviewFlag[] = [];

    const dateValid = ISO_DATE_RE.test(row.date);
    const depTimeValid = !row.depTimeLocal || HMS_RE.test(row.depTimeLocal);
    const arrTimeValid = !row.arrTimeLocal || HMS_RE.test(row.arrTimeLocal);
    if (!dateValid || !depTimeValid || !arrTimeValid) {
      flags.push("malformed_datetime");
    }

    const dep = await getCachedAirport(row.fromIata);
    const arr = await getCachedAirport(row.toIata);
    if (!dep || !arr || !dep.timezone || !arr.timezone) {
      flags.push("unresolvable_airport");
    }

    const depTz = dep?.timezone ?? "UTC";
    const arrTz = arr?.timezone ?? "UTC";

    let depUtc: Date = SAFE_DATE;
    let arrUtc: Date = SAFE_DATE;
    let arrivalLocalCorrected = "";

    if (!flags.includes("malformed_datetime") && !flags.includes("unresolvable_airport")) {
      try {
        depUtc = fromZonedTime(`${row.date}T${row.depTimeLocal ?? "00:00:00"}`, depTz);
        if (!isValidDate(depUtc)) throw new Error("invalid dep");

        // Authoritative arrival signal is `arr_local + arr_tz`, NOT
        // `dep_utc + Duration`. FR24's `Duration` field is a derived/cached
        // value that's known-broken on some routes (e.g. BLR-international:
        // FR24 uses UTC+4 instead of Asia/Kolkata +5:30, off by 1h30 — see
        // issue #99). When both signals are present we anchor on arr_local
        // and use Duration only to pick the calendar day for trans-meridian
        // flights. The duration_mismatch flag still fires for transparency.
        const hasDuration =
          typeof row.durationSeconds === "number" && row.durationSeconds > 0;
        if (hasDuration && row.arrTimeLocal) {
          const target = depUtc.getTime() + row.durationSeconds! * 1000;
          const naiveMs = fromZonedTime(
            `${row.date}T${row.arrTimeLocal}`,
            arrTz
          ).getTime();
          let bestMs = naiveMs;
          let bestDiff = Math.abs(naiveMs - target);
          const dayMs = 24 * 3600 * 1000;
          for (let day = 1; day <= 3; day++) {
            const candidate = naiveMs + day * dayMs;
            const diff = Math.abs(candidate - target);
            if (diff < bestDiff) {
              bestMs = candidate;
              bestDiff = diff;
            }
          }
          arrUtc = new Date(bestMs);
          if (bestDiff > 30 * 60 * 1000) {
            flags.push("duration_mismatch");
          }
        } else if (hasDuration) {
          arrUtc = new Date(depUtc.getTime() + row.durationSeconds! * 1000);
        } else if (row.arrTimeLocal) {
          arrUtc = fromZonedTime(`${row.date}T${row.arrTimeLocal}`, arrTz);
          let safety = 0;
          while (arrUtc.getTime() < depUtc.getTime() && safety < 2) {
            arrUtc = new Date(arrUtc.getTime() + 24 * 3600 * 1000);
            safety++;
          }
        }

        if (isValidDate(arrUtc)) {
          arrivalLocalCorrected = formatInTimeZone(arrUtc, arrTz, "yyyy-MM-dd'T'HH:mm:ss");
        }
      } catch (err) {
        logger.warn({
          operation: "import_preview_tz_math_failed",
          rowIndex: row.sourceRowIndex,
          err: err instanceof Error ? err.message : String(err),
        });
        flags.push("malformed_datetime");
      }
    }

    const flightNumberNormalised = normalizeFlightNumber(row.flightNumber);

    const statusDefault: "flown" | "scheduled" =
      isValidDate(depUtc) && depUtc.getTime() < Date.now() ? "flown" : "scheduled";

    let dedupeHint: DedupeHint = "none";
    if (isValidDate(depUtc) && flightNumberNormalised) {
      const dayStart = new Date(depUtc);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
      const sameDay = await prisma.flight.findMany({
        where: {
          userId,
          departureTime: { gte: dayStart, lt: dayEnd },
        },
        select: { flightNumber: true, depIata: true, arrIata: true },
      });
      for (const f of sameDay) {
        if (normalizeFlightNumber(f.flightNumber) === flightNumberNormalised) {
          dedupeHint = "exact_match";
          break;
        }
        if (
          f.depIata?.toUpperCase() === row.fromIata.toUpperCase() &&
          f.arrIata?.toUpperCase() === row.toIata.toUpperCase()
        ) {
          dedupeHint = "same_day_same_route";
        }
      }
    }

    enriched.push({
      ...row,
      depUtc,
      arrUtc,
      arrivalLocalCorrected,
      depTimezone: depTz,
      arrTimezone: arrTz,
      depLat: dep?.lat ?? null,
      depLon: dep?.lon ?? null,
      arrLat: arr?.lat ?? null,
      arrLon: arr?.lon ?? null,
      flightNumberNormalised,
      statusDefault,
      flags,
      dedupeHint,
    });
  }

  const summary: PreviewSummary = {
    ok: enriched.filter((r) => r.flags.length === 0 && r.dedupeHint === "none").length,
    problems: enriched.filter((r) => r.flags.length > 0).length,
    duplicates: enriched.filter((r) => r.dedupeHint !== "none").length,
    unresolvable: enriched.filter((r) => r.flags.includes("unresolvable_airport")).length,
  };

  return { rows: enriched, summary };
}
