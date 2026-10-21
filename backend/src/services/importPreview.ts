import { toInstant, type Fold } from "../shared/time/instant";
import { formatWallClockIn } from "../shared/zonedWallClock";
import { prisma } from "../db";
import { getCachedAirport } from "./airportCache";
import { normalizeFlightNumber } from "../schemas/flight";
import logger from "../utils/logger";
import type { TrackerFormat } from "./parsers/trackers/formats";

/**
 * A provider row's wall clock at an airport, as an instant — through
 * `shared/time` (ADR 0002). A machine source: an hour the zone skipped is not
 * refused, it lands where an unadjusted clock would put it. Throws on a
 * malformed reading, which the caller's try/catch turns into a flag.
 */
function machineInstant(local: string, zone: string, fold: Fold = "earlier"): Date {
  return toInstant(local, zone, { origin: "machine", fold }).utc;
}

/**
 * Whether an instant is the SECOND time its zone showed that wall clock (the
 * autumn hour). Stored as `fold: "later"` beside the wall clock; without it
 * the clock reads back at the first occurrence, an hour early.
 */
function isLaterOccurrence(utc: Date, zone: string): boolean {
  const local = formatWallClockIn(utc, zone);
  if (local === null) return false;
  const first = toInstant(local, zone, { origin: "machine" });
  return first.ambiguous && first.utc.getTime() !== utc.getTime();
}

/** Which occurrence a row's wall clock means — the one its stated instant names, if any. */
function foldFor(stated: string | undefined, zone: string): Fold {
  if (!stated) return "earlier";
  const ms = Date.parse(stated);
  return !Number.isNaN(ms) && isLaterOccurrence(new Date(ms), zone) ? "later" : "earlier";
}

export type PreviewSource = "fr24" | "generic_csv" | TrackerFormat;

export interface PreviewRowInput {
  date: string;
  depTimeLocal?: string;
  arrTimeLocal?: string;
  /**
   * The arrival's own calendar day, for a source that knows it (forgejo#311).
   * When present it is authoritative: the arrival is this day + arrTimeLocal
   * at the arrival airport, never a day guessed from the departure.
   */
  arrDate?: string;
  durationSeconds?: number;
  /**
   * The instant the source itself states for an end (AirTrail stores
   * instants, App in the Air writes UTC beside local), as ISO-8601 UTC. Read
   * only to tell which occurrence of a repeated autumn hour the wall clock
   * means; the wall clock stays the authority.
   */
  depInstant?: string;
  arrInstant?: string;
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
  bookingReference?: string;
  /**
   * Set when the source knows only the year or the month (OpenFlights'
   * year-only dates, AirTrail's datePrecision). `date` is then the
   * placeholder — the 1st of the period — and the flight is stored as a
   * historical entry of that precision, the way the flight form stores one.
   */
  datePrecision?: "year" | "month";
  source: PreviewSource;
  sourceRowIndex: number;
}

export type PreviewFlag =
  "duration_mismatch" | "unresolvable_airport" | "malformed_datetime" | "missing_required";
export type DedupeHint = "exact_match" | "same_day_same_route" | "none";

export interface PreviewRowEnriched extends PreviewRowInput {
  depUtc: Date;
  arrUtc: Date;
  /** The departure wall clock to store: the row's time, or the placeholder for a date-only row. */
  departureLocal: string;
  /** Empty when nothing in the row says when the flight arrived. */
  arrivalLocalCorrected: string;
  /** Set when a wall clock is the second of a repeated autumn hour (ADR 0002). */
  departureFold?: "later";
  arrivalFold?: "later";
  /** How much of the clock is real, for a row without a departure time (see `flightPayload.ts`). */
  timeSemantics?: "DATE_ONLY" | "UNKNOWN";
  depTimezone: string;
  arrTimezone: string;
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  flightNumberNormalised?: string;
  statusDefault: "flown" | "scheduled" | "historical";
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

/** How far a stated duration may disagree with the clocks before it is flagged. */
const DURATION_TOLERANCE_MS = 30 * 60 * 1000;

const ICAO_RE = /^[A-Z]{4}$/;
const DAY_MS = 24 * 3600 * 1000;

/**
 * The clock a date-only row is stored with — the same placeholders the flight
 * form writes (`buildLocalString`): noon for a known day, so no zone shift
 * moves it to another date; the 1st at 00:00 for a year or a month.
 */
const DATE_ONLY_ANCHOR = "12:00:00";
const PERIOD_ANCHOR = "00:00:00";

/**
 * When the flight arrived, from whatever the row knows — or null when it
 * knows nothing about the arrival. Authoritative signal is `arr_local +
 * arr_tz`, NOT `dep_utc + Duration`: FR24's `Duration` is a derived/cached
 * value that is known-broken on some routes (e.g. BLR-international: FR24
 * uses UTC+4 instead of Asia/Kolkata +5:30, off by 1h30 — issue #99). With
 * both, the arrival anchors on arr_local and Duration only picks the calendar
 * day for trans-meridian flights; duration_mismatch still fires.
 */
function arrivalInstant(
  row: PreviewRowInput,
  depUtc: Date,
  arrTz: string,
  flags: PreviewFlag[]
): Date | null {
  const duration = row.durationSeconds && row.durationSeconds > 0 ? row.durationSeconds : null;
  if (row.arrDate && row.arrTimeLocal) {
    // The export knows the arrival's own day — nothing to guess. A duration
    // that disagrees is still said, as for FR24.
    const arrUtc = machineInstant(
      `${row.arrDate}T${row.arrTimeLocal}`,
      arrTz,
      foldFor(row.arrInstant, arrTz)
    );
    if (
      duration &&
      Math.abs(arrUtc.getTime() - (depUtc.getTime() + duration * 1000)) > DURATION_TOLERANCE_MS
    ) {
      flags.push("duration_mismatch");
    }
    return arrUtc;
  }
  if (duration && row.arrTimeLocal) {
    const target = depUtc.getTime() + duration * 1000;
    const naiveMs = machineInstant(`${row.date}T${row.arrTimeLocal}`, arrTz).getTime();
    let bestMs = naiveMs;
    let bestDiff = Math.abs(naiveMs - target);
    for (let day = 1; day <= 3; day++) {
      const candidate = naiveMs + day * DAY_MS;
      const diff = Math.abs(candidate - target);
      if (diff < bestDiff) {
        bestMs = candidate;
        bestDiff = diff;
      }
    }
    if (bestDiff > DURATION_TOLERANCE_MS) flags.push("duration_mismatch");
    return new Date(bestMs);
  }
  if (duration) return new Date(depUtc.getTime() + duration * 1000);
  if (row.arrTimeLocal) {
    let arrUtc = machineInstant(`${row.date}T${row.arrTimeLocal}`, arrTz);
    let safety = 0;
    while (arrUtc.getTime() < depUtc.getTime() && safety < 2) {
      arrUtc = new Date(arrUtc.getTime() + DAY_MS);
      safety++;
    }
    return arrUtc;
  }
  return null;
}

/** The airport's IATA code when the row named it by ICAO; the row's code otherwise. */
function iataOf(code: string, airport: { iata?: string | null } | null): string {
  const upper = code.toUpperCase();
  return ICAO_RE.test(upper) && airport?.iata ? airport.iata : code;
}

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
    const arrDateValid = !row.arrDate || ISO_DATE_RE.test(row.arrDate);
    if (!dateValid || !depTimeValid || !arrTimeValid || !arrDateValid) {
      flags.push("malformed_datetime");
    }

    const dep = await getCachedAirport(row.fromIata);
    const arr = await getCachedAirport(row.toIata);
    if (!dep || !arr || !dep.timezone || !arr.timezone) {
      flags.push("unresolvable_airport");
    }
    // Jetlog, AirTrail and OpenFlights name an airport by ICAO when it has
    // no IATA code or by preference; the row would otherwise be stored with
    // "EDDF" in its IATA column and never match the same flight typed by hand.
    const fromIata = iataOf(row.fromIata, dep);
    const toIata = iataOf(row.toIata, arr);

    const depTz = dep?.timezone ?? "UTC";
    const arrTz = arr?.timezone ?? "UTC";

    let depUtc: Date = SAFE_DATE;
    let arrUtc: Date = SAFE_DATE;
    let arrivalLocalCorrected = "";
    // A row without a departure time is a date-only entry: stored with the
    // form's placeholder clock and its semantics, never as "00:00 local".
    const timeSemantics: PreviewRowEnriched["timeSemantics"] = row.depTimeLocal
      ? undefined
      : row.datePrecision
        ? "UNKNOWN"
        : "DATE_ONLY";
    const departureLocal = `${row.date}T${
      row.depTimeLocal ?? (row.datePrecision ? PERIOD_ANCHOR : DATE_ONLY_ANCHOR)
    }`;

    if (!flags.includes("malformed_datetime") && !flags.includes("unresolvable_airport")) {
      try {
        depUtc = machineInstant(
          departureLocal,
          depTz,
          timeSemantics ? "earlier" : foldFor(row.depInstant, depTz)
        );
        if (!isValidDate(depUtc)) throw new Error("invalid dep");

        if (timeSemantics) {
          // The arrival of a date-only entry mirrors its departure, as in the
          // form: the duration is then estimated from the distance downstream.
          arrUtc = depUtc;
          arrivalLocalCorrected = departureLocal;
        } else {
          // Without an arrival time, a duration or an arrival day there is no
          // arrival to state; formatting the SAFE_DATE sentinel here gave the
          // batch a 1970 arrival it refused as "before departure".
          const arrival = arrivalInstant(row, depUtc, arrTz, flags);
          if (arrival && isValidDate(arrival)) {
            arrUtc = arrival;
            const wall = formatWallClockIn(arrUtc, arrTz);
            if (wall === null) throw new Error(`unusable arrival zone ${arrTz}`);
            arrivalLocalCorrected = wall;
          }
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
    const departureFold =
      !timeSemantics &&
      isValidDate(depUtc) &&
      depUtc !== SAFE_DATE &&
      isLaterOccurrence(depUtc, depTz)
        ? ("later" as const)
        : undefined;
    const arrivalFold =
      !timeSemantics && arrivalLocalCorrected !== "" && isLaterOccurrence(arrUtc, arrTz)
        ? ("later" as const)
        : undefined;

    // A past flight whose arrival is unknown, or that has no clock at all, is
    // a historical entry — the one status the batch accepts without both
    // ends. A FUTURE flight needs both, so one that lacks them is flagged
    // here rather than refused by the batch after the user pressed import.
    const departed = isValidDate(depUtc) && depUtc.getTime() < Date.now();
    const complete = !timeSemantics && arrivalLocalCorrected !== "";
    const statusDefault: PreviewRowEnriched["statusDefault"] = departed
      ? complete
        ? "flown"
        : "historical"
      : "scheduled";
    if (!departed && !complete && !flags.includes("malformed_datetime")) {
      flags.push("missing_required");
    }

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
          f.depIata?.toUpperCase() === fromIata.toUpperCase() &&
          f.arrIata?.toUpperCase() === toIata.toUpperCase()
        ) {
          dedupeHint = "same_day_same_route";
        }
      }
    }

    enriched.push({
      ...row,
      fromIata,
      toIata,
      departureLocal,
      timeSemantics,
      depUtc,
      arrUtc,
      arrivalLocalCorrected,
      ...(departureFold ? { departureFold } : {}),
      ...(arrivalFold ? { arrivalFold } : {}),
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
