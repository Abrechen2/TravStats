import { prisma } from "../../db";
import type { EvidenceEntry } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { sortEntries, sliceEntries } from "./paging";
import { FLIGHT_CLOCK_SELECT } from "../stats/departureClock";
import { departureDayOf } from "../../utils/stats/departureClock";
import type { FlightTimeSemantics } from "../../utils/timezone";

/**
 * Row → `EvidenceEntry`, one function per domain. Split out of
 * `rankingEvidence.ts` because Task 6 (the remaining ranking dimensions) and
 * Task 7 (the metrics) both need the flight mapper again rather than each
 * re-deriving `href`/`title`/`subtitle` from a flight row its own way.
 *
 * `hydrateFlightSumEntries`/`hydrateFlightDistinctEntries` below are the
 * SAME extraction, one level up: every `metricEvidenceFlight*.ts` resolver
 * (Task 7) needs "sort by date, slice to the page, hydrate flight-number/
 * route for the page only" — the two-pass shape `rankingEvidence.ts`
 * pioneered. Splitting the metric resolvers by dimension
 * (flight-core/geo/year/scorecard) BEFORE extracting this would have moved
 * the same ~25 lines into four files instead of removing it from three of
 * them — the standing review guidance for this area.
 */

type FlightDate = EvidenceEntry["date"];

/**
 * The columns a flight's evidence day is read from — `withDepartureClock`'s
 * output. Required rather than optional on purpose: a loader that forgets the
 * clock then fails to compile instead of quietly labelling every flight with
 * its UTC day, which is how the panel came to show a Tokyo 07:30 departure on
 * the day before (forgejo#273).
 */
export interface FlightDayRow {
  departureTime: Date | null;
  /** Stored zone, else the catalogue's (`flightEndZone`); null when neither knows. */
  depTimezone: string | null;
  depTimeSemantics: FlightTimeSemantics;
}

/** What a loader selects so `withDepartureClock` can produce a `FlightDayRow`. */
export const FLIGHT_DAY_SELECT = { departureTime: true, ...FLIGHT_CLOCK_SELECT } as const;

/**
 * A flight's evidence date: the day it left on at its DEPARTURE airport, the
 * day every flight statistic files it under (`departureDayOf`). A date-only
 * row keeps its recorded day; a row whose zone nobody knows is read on its
 * stored components, the fallback `localWallClockOf` makes for every figure.
 */
export function flightDateOf(row: FlightDayRow): FlightDate {
  const day = departureDayOf(row);
  return day ? { value: day, precision: "day" } : null;
}

/**
 * A day that is ALREADY a local calendar day carried as UTC midnight
 * (`airportCalendarDay`, the timeseries rows) → the contract's shape. Never
 * for a raw departure instant — that is `flightDateOf`.
 */
export function calendarDayDateOf(day: Date | null): FlightDate {
  return day ? { value: day.toISOString().slice(0, 10), precision: "day" } : null;
}

/**
 * The ONE hydration query in the feature, and the only one whose `where` is
 * a list of ids rather than a predicate. `userId` is redundant today — every
 * id reaching here came out of a pass that already filtered on it — and is
 * there anyway, because this is precisely the query that would hand a row to
 * the wrong account the day an id arrived from somewhere else (a cached
 * page, a client-supplied cursor, a resolver written in a hurry). A
 * redundant condition costs one indexed column; the alternative costs a
 * cross-account leak nothing would catch.
 */
async function hydrateFlightPage(
  userId: string,
  paged: Array<{ id: string }>
): Promise<
  Map<string, { flightNumber: string | null; depIata: string | null; arrIata: string | null }>
> {
  const details = paged.length
    ? await prisma.flight.findMany({
        where: { userId, id: { in: paged.map((entry) => entry.id) } },
        select: { id: true, flightNumber: true, depIata: true, arrIata: true },
      })
    : [];
  return new Map(details.map((d) => [d.id, d]));
}

/** What a flight entry shows besides its date. */
interface FlightEntryIdentity {
  id: string;
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
}

/** The subset of `Flight` a flight entry needs to render itself. */
export interface FlightEvidenceRow extends FlightEntryIdentity, FlightDayRow {}

/**
 * A flight as evidence. Unlike a lodging stay (`docs/.../evidence-panel-design.md`,
 * "Identity"), a flight's `href` targets the SAME row `id` names — there is no
 * separate parent it belongs to. `title` is the flight number and `subtitle`
 * the route, both `{ text }` because a flight number and an IATA pair are the
 * traveller's own data, not a phrase to translate (task-5-brief.md, "Decisions
 * already made").
 */
export function flightEvidenceEntry(row: FlightEvidenceRow, contribution: number): EvidenceEntry {
  // Day precision: a flight always has an actual calendar day even where
  // `historical`'s time-of-day is a placeholder (see
  // `shared/flightCounting.ts`'s split of "happened" from "clock is
  // trustworthy") — never flattened further than the contract allows.
  return datedFlightEntry(row, flightDateOf(row), contribution);
}

/** A flight entry around a date resolved before paging (the skeleton's). */
function datedFlightEntry(
  row: FlightEntryIdentity,
  date: FlightDate,
  contribution: number
): EvidenceEntry {
  return {
    domain: "flight",
    id: row.id,
    href: `/flights/${row.id}`,
    title: { text: row.flightNumber ?? "—" },
    subtitle: { text: `${row.depIata ?? "?"} → ${row.arrIata ?? "?"}` },
    date,
    contribution,
  };
}

export interface FlightSumSkeleton {
  id: string;
  date: FlightDate;
  contribution: number;
}

/**
 * The shared tail for every `sum` flight-metric resolver: sort by date,
 * slice to the page, hydrate flight-number/route for the PAGE only (never
 * the whole matched set). `omittedCount` is the row count omitted;
 * `omittedContribution` is the sum omitted — the two differ whenever a
 * row's own contribution isn't exactly 1 (distance, duration, cost).
 */
export async function hydrateFlightSumEntries(
  userId: string,
  matched: FlightSumSkeleton[],
  page: PagingParams
): Promise<{ entries: EvidenceEntry[]; omittedCount: number; omittedContribution: number }> {
  const skeletons: EvidenceEntry[] = matched.map((row) => ({
    domain: "flight",
    id: row.id,
    href: `/flights/${row.id}`,
    title: { text: "" },
    subtitle: null,
    date: row.date,
    contribution: row.contribution,
  }));
  const paged = sliceEntries(sortEntries(skeletons), page);
  const detailById = await hydrateFlightPage(userId, paged);
  const contributionById = new Map(matched.map((m) => [m.id, m.contribution]));

  const entries: EvidenceEntry[] = paged.map((skeleton) => {
    const detail = detailById.get(skeleton.id);
    return datedFlightEntry(
      {
        id: skeleton.id,
        flightNumber: detail?.flightNumber ?? null,
        depIata: detail?.depIata ?? null,
        arrIata: detail?.arrIata ?? null,
      },
      skeleton.date,
      contributionById.get(skeleton.id) ?? 0
    );
  });

  const totalContribution = matched.reduce((total, m) => total + m.contribution, 0);
  const returnedContribution = entries.reduce((total, e) => total + (e.contribution ?? 0), 0);
  return {
    entries,
    omittedCount: matched.length - entries.length,
    omittedContribution: totalContribution - returnedContribution,
  };
}

export interface FlightDistinctSkeleton {
  id: string;
  date: FlightDate;
  credits: string[];
  /** Display names for credits that are KEYS rather than words — see the contract. */
  creditLabels?: Record<string, string>;
}

/**
 * The `distinct` sibling of `hydrateFlightSumEntries` — same shared tail,
 * `credits` instead of `contribution`. `omittedCredits` is the size of the
 * distinct-unit gap between the full matched set and the returned page,
 * per `assertDistinctInvariant`'s own union rule (never a per-row sum).
 */
export async function hydrateFlightDistinctEntries(
  userId: string,
  matched: FlightDistinctSkeleton[],
  page: PagingParams
): Promise<{ entries: EvidenceEntry[]; omittedRowCount: number; omittedCredits: number }> {
  const skeletons: EvidenceEntry[] = matched.map((row) => ({
    domain: "flight",
    id: row.id,
    href: `/flights/${row.id}`,
    title: { text: "" },
    subtitle: null,
    date: row.date,
    credits: row.credits,
    ...(row.creditLabels === undefined ? {} : { creditLabels: row.creditLabels }),
  }));
  const paged = sliceEntries(sortEntries(skeletons), page);
  const detailById = await hydrateFlightPage(userId, paged);

  const entries: EvidenceEntry[] = paged.map((skeleton) => {
    const detail = detailById.get(skeleton.id);
    const hydrated = datedFlightEntry(
      {
        id: skeleton.id,
        flightNumber: detail?.flightNumber ?? null,
        depIata: detail?.depIata ?? null,
        arrIata: detail?.arrIata ?? null,
      },
      skeleton.date,
      1
    );
    return {
      ...hydrated,
      contribution: undefined,
      credits: skeleton.credits,
      ...(skeleton.creditLabels === undefined ? {} : { creditLabels: skeleton.creditLabels }),
    };
  });

  const allCredits = new Set(matched.flatMap((m) => m.credits));
  const returnedCredits = new Set(entries.flatMap((e) => e.credits ?? []));
  return {
    entries,
    omittedRowCount: matched.length - entries.length,
    omittedCredits: allCredits.size - returnedCredits.size,
  };
}
