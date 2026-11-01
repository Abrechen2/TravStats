import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { calculateDistance } from "../../utils/geo";
import { localWallClockOf } from "../../utils/timezone";
import { FLIGHT_CLOCK_SELECT, withDepartureClock } from "./departureClock";
import { travTrackYears, travTrackYearStats } from "../travtrack/everyday/view";
import { buildWrapped, type Wrapped } from "./wrapped";
import { chapterYears } from "./wrappedChapters";
import { loadWrappedDomains, loadWrappedPassport } from "./wrappedDomains";

/** Years the logbook already names, so TravTrack's scan skips them (a miss only costs a scan). */
function logbookYears(
  flightYears: ReadonlyArray<number | null>,
  domains: Awaited<ReturnType<typeof loadWrappedDomains>>
): ReadonlySet<number> {
  const years = new Set<number>();
  for (const y of flightYears) if (y !== null) years.add(y);
  for (const c of domains.cruises ?? []) if (c.startDate) years.add(c.startDate.getUTCFullYear());
  for (const r of domains.rail ?? []) years.add(r.year);
  for (const y of chapterYears(domains.chapters)) years.add(y);
  return years;
}

/**
 * The year in review for one user, loaded and built — the one home of
 * `GET /stats/wrapped` and of a public `wrapped` share link (forgejo#281), so
 * the story a link shows is the story the owner's own page tells.
 *
 * `year` null: the latest year with anything in it. Null result: no countable
 * activity in any year (or none in the asked year) — there is no story.
 */
export async function loadWrapped(
  userId: string,
  year: number | null,
  /**
   * The owner's own page asks for the account's TravTrack figures (forgejo#400);
   * a public share link never does — it is built by the default `false`, so the
   * recorded movement of a person cannot leave through a link.
   */
  opts: { withTravTrack?: boolean } = {}
): Promise<Wrapped | null> {
  // One scan, not two: `loadPassport` reads the same countable flights of
  // the same user and is handed these rows (forgejo#49). `arrivalTime` and
  // `arrTimeSemantics` are here only because it needs them.
  const [flights, domains] = await Promise.all([
    prisma.flight.findMany({
      where: { userId, ...countableFlightWhere() },
      select: {
        ...FLIGHT_CLOCK_SELECT,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
        departureTime: true,
        arrivalTime: true,
        arrTimeSemantics: true,
        airline: true,
        flightNumber: true,
        status: true,
      },
    }),
    loadWrappedDomains(userId),
  ]);

  // For `newCountries` only — the passport already decides what counts as
  // a country and when it was first reached.
  const passport = await loadWrappedPassport(userId, flights);

  // Which YEAR a flight belongs to is read on the departure airport's
  // clock, not on the stored instant — the rule `departureClock.ts` states
  // and `/stats/timeseries` already follows. Resolved here, at the load,
  // so `buildWrapped` stays a pure function over rows that carry their own
  // answer rather than resolving timezones itself (AUD-077).
  const flightsWithClock = await withDepartureClock(flights);

  const rows = flightsWithClock.map((f) => ({
    ...f,
    departureYear:
      f.departureTime === null
        ? null
        : localWallClockOf(f.departureTime, f.depTimezone, f.depTimeSemantics).year,
    // Great-circle from the coordinates, the measure `/stats/timeseries`
    // buckets — so the year's distance agrees with its bar on the chart.
    distanceKm: calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon),
  }));
  const wrapped = buildWrapped(
    rows,
    domains.cruises,
    passport.countries,
    year,
    domains.rail,
    domains.chapters,
    opts.withTravTrack
      ? await travTrackYears(
          userId,
          logbookYears(
            rows.map((r) => r.departureYear),
            domains
          )
        )
      : []
  );
  if (!wrapped || !opts.withTravTrack) return wrapped;
  return { ...wrapped, travTrack: await travTrackYearStats(userId, wrapped.year) };
}
