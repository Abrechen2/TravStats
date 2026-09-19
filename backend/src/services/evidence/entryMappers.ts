import { prisma } from "../../db";
import type { EvidenceEntry } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { sortEntries, sliceEntries } from "./paging";

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

/** `Date | null` → the contract's day-precision shape, in one place. */
export function flightDateOf(date: Date | null): FlightDate {
  return date ? { value: date.toISOString().slice(0, 10), precision: "day" } : null;
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

/** The subset of `Flight` a flight entry needs to render itself. */
export interface FlightEvidenceRow {
  id: string;
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
  departureTime: Date | null;
}

/**
 * A flight as evidence. Unlike a lodging stay (`docs/.../evidence-panel-design.md`,
 * "Identity"), a flight's `href` targets the SAME row `id` names — there is no
 * separate parent it belongs to. `title` is the flight number and `subtitle`
 * the route, both `{ text }` because a flight number and an IATA pair are the
 * traveller's own data, not a phrase to translate (task-5-brief.md, "Decisions
 * already made").
 */
export function flightEvidenceEntry(row: FlightEvidenceRow, contribution: number): EvidenceEntry {
  return {
    domain: "flight",
    id: row.id,
    href: `/flights/${row.id}`,
    title: { text: row.flightNumber ?? "—" },
    subtitle: { text: `${row.depIata ?? "?"} → ${row.arrIata ?? "?"}` },
    // Day precision: a flight always has an actual calendar day even where
    // `historical`'s time-of-day is a placeholder (see
    // `shared/flightCounting.ts`'s split of "happened" from "clock is
    // trustworthy") — never flattened further than the contract allows.
    date: row.departureTime
      ? { value: row.departureTime.toISOString().slice(0, 10), precision: "day" }
      : null,
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
    const hydrated = flightEvidenceEntry(
      {
        id: skeleton.id,
        flightNumber: detail?.flightNumber ?? null,
        depIata: detail?.depIata ?? null,
        arrIata: detail?.arrIata ?? null,
        departureTime: null,
      },
      contributionById.get(skeleton.id) ?? 0
    );
    return { ...hydrated, date: skeleton.date };
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
    const hydrated = flightEvidenceEntry(
      {
        id: skeleton.id,
        flightNumber: detail?.flightNumber ?? null,
        depIata: detail?.depIata ?? null,
        arrIata: detail?.arrIata ?? null,
        departureTime: null,
      },
      1
    );
    return {
      ...hydrated,
      date: skeleton.date,
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
