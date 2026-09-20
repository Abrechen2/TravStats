import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { airportCalendarDay, buildTzMap } from "../../services/stats/departureClock";
import type { FlightTimeSemantics } from "../../utils/timezone";

/**
 * Which calendar year and month a departure fell in — on the DEPARTURE
 * AIRPORT'S clock, which is this project's one answer to "which day was
 * that".
 *
 * The rule has exactly one home, `services/stats/departureClock.ts`
 * (`airportCalendarDay`), and this module calls it rather than restating it.
 * That is the whole point: the logbook's year filter shipped bucketing on
 * UTC, so an LAX departure at 18:00 on 31 December was filed under the next
 * year — while the row beside it drew "31.12.2023" (`FlightRow` formats with
 * `flight.depTimezone`) and `/stats` counted it in 2023 (forgejo#46, pinned
 * by `stats.timeseriesLocalTime.test.ts`). Three surfaces, two answers.
 *
 * WHY THIS IS NOT SQL. The obvious fix is an expression in the `where`:
 * `EXTRACT(YEAR FROM (departure_time AT TIME ZONE dep_timezone))`. There is
 * no `dep_timezone` column. `depTimezone` is attached at READ time by
 * `services/flightAirportFacts.ts`, resolved from the airports catalogue by
 * IATA then ICAO, and picking the right catalogue row is itself a rule —
 * `compareAirportAuthority`, which prefers an open airport over a closed
 * predecessor sharing the code (MUC-Riem, TXL, THF) and a real ICAO over a
 * placeholder. A SQL version would have to restate that ranking, the
 * IATA-before-ICAO preference AND the LEGACY_FAKE_UTC semantics, in a second
 * language, with nothing checking the two copies against each other. This
 * tree has a name for what happens next (`utils/continents.ts`: two
 * byte-identical copies "carried a 'keep both in sync' comment and had
 * already drifted").
 *
 * So the filter resolves ids instead: one narrow projection over the
 * already-filtered set, folded through the one rule, and the page query then
 * takes `id: { in: … }`. It is bounded by the account's own flight count —
 * the same bound the page used to pay for every one of its ~96 columns, over
 * HTTP, on every load — and it is paid only when a year or a month is
 * actually filtered.
 */

/** Exactly the columns the rule reads. `buildTzMap` wants both ends. */
const DEPARTURE_CLOCK_SELECT = {
  id: true,
  departureTime: true,
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
  depTimeSemantics: true,
} as const;

export interface LocalDeparture {
  id: string;
  /** Calendar year on the departure airport's clock. */
  year: number;
  /** Calendar month, 1-12, on the same clock. */
  month: number;
}

/**
 * Every dated flight matching `where`, placed on its departure airport's
 * calendar.
 *
 * Undated flights are dropped rather than bucketed: a flight with no
 * departure time belongs to no year, and putting it in one would be the
 * abstention rule broken (`shared/flightDuration.ts` — null, never a
 * stand-in).
 */
export async function loadLocalDepartures(
  where: Prisma.FlightWhereInput
): Promise<LocalDeparture[]> {
  const rows = await prisma.flight.findMany({
    where: { AND: [where, { departureTime: { not: null } }] },
    select: DEPARTURE_CLOCK_SELECT,
  });
  const tzMap = await buildTzMap(rows);

  const departures: LocalDeparture[] = [];
  for (const row of rows) {
    if (!row.departureTime) continue;
    // IATA before ICAO, the same order `flightAirportFacts` resolves in.
    const timezone =
      (row.depIata ? tzMap.get(row.depIata) : undefined) ??
      (row.depIcao ? tzMap.get(row.depIcao) : undefined) ??
      null;
    const day = airportCalendarDay(
      row.departureTime,
      timezone,
      row.depTimeSemantics as FlightTimeSemantics
    );
    // `airportCalendarDay` returns the local date carried as UTC midnight, so
    // the UTC getters read the LOCAL calendar back out.
    departures.push({
      id: row.id,
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
    });
  }
  return departures;
}

export interface LocalPeriod {
  year?: number;
  month?: number;
}

/** The ids whose departure falls in the named year and/or month, locally. */
export async function flightIdsInLocalPeriod(
  where: Prisma.FlightWhereInput,
  period: LocalPeriod
): Promise<string[]> {
  const departures = await loadLocalDepartures(where);
  return departures
    .filter(
      (d) =>
        (period.year === undefined || d.year === period.year) &&
        (period.month === undefined || d.month === period.month)
    )
    .map((d) => d.id);
}

/** The year facet: how many flights fall in each local year, newest first. */
export async function localDepartureYearCounts(
  where: Prisma.FlightWhereInput
): Promise<Array<{ value: number; count: number }>> {
  const counts = new Map<number, number>();
  for (const departure of await loadLocalDepartures(where)) {
    counts.set(departure.year, (counts.get(departure.year) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.value - a.value);
}
