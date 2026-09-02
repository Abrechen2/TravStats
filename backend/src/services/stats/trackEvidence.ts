/**
 * What a LOCATION HISTORY proves about each country — spec §8, and the only
 * producer of the `transited` rung of §3.4c.
 *
 * The seam is the one `./flightEvidence.ts` already draws: everything here
 * answers "what do these country-days say about which countries, how strongly
 * and on which days", while `passport.ts` assembles the card around the answer
 * and `shared/countryEvidence.ts` owns the ranking that folds it together.
 * Nothing is decided twice.
 *
 * ## The days are the easy part
 *
 * A country-day row exists because a point was recorded on that day in that
 * country. Every one of them is therefore ATTESTED in exactly the sense
 * §3.4b-bis demands — never an inferred gap, unlike the interval between two
 * flights, which measures the absence of a recorded departure rather than
 * presence. So the days go straight into the union with no endpoint rule, and
 * a track publishes no ground time at all: a first and last fix are two clocks,
 * but they are not a landing and a take-off. Nothing says the traveller was
 * still there between them and nothing says they left after.
 *
 * ## The tier is the hard part, and §8.2 is why
 *
 * > *"A GPS point in Doha is still a point in Qatar even if you never left the
 * > terminal."*
 *
 * Location history does not distinguish a connection by itself. Three
 * structural facts do, and none of them is a number anybody can turn:
 *
 * 1. **Where the points are.** If every point this account ever recorded in a
 *    country lies on the grounds of an airport TravStats already knows it flew
 *    through, the country stays a `connection`. That is not a distance
 *    threshold dressed up — the alternative, "the points span less than N km",
 *    is precisely the dial §2 refuses, and it would call a compact city a
 *    connection and a large airport a visit. "At an airport you actually flew
 *    through" is a fact assembled from two records this server already holds.
 * 2. **Whether a night passed.** Two calendar-adjacent days in one country mean
 *    the day changed while the traveller was there: `slept`, the same
 *    structural cut every other tier is made on.
 * 3. **Whether the day was shared.** A day recorded ONLY in this country is a
 *    day spent here — `visited`. A day this country shares with another is a
 *    day a border was crossed, which is `transited`: on the ground, for hours,
 *    and counted by default, but not the same claim as a day spent somewhere.
 *
 * Point 3 is the one that needs care, because it reads the SILENCE of the
 * table: "no other country that day" is a conclusion drawn from rows that are
 * absent. A `partialWindow` row withdraws exactly that — the window it came out
 * of was truncated, so the unread part of the day may hold any number of other
 * countries. Such a day may never be read as sole, and falls to `transited`.
 *
 * ## What this deliberately does NOT try to tell apart
 *
 * A day driving across Estonia and a day trip out of Tallinn look identical
 * here, and both come out `transited`. That is not a shortcoming worth patching
 * with a heuristic: both count under the default threshold, so the distinction
 * changes nothing a reader sees, and inventing a rule to separate them would be
 * a guess presented as a fact.
 */

import type { EvidenceInput } from "../../shared/countryEvidence";

/**
 * One stored `CountryDay`, as this derivation reads it. The Prisma row is a
 * superset; `date` arrives already reduced to its UTC day, because that is the
 * only clock a GPS fix carries (see the `CountryDay.date` comment in
 * `schema.prisma`).
 */
export interface CountryDayRow {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  /** How many points attested this country on this day. */
  pointCount: number;
  /**
   * How many of those points lay on the grounds of an airport this account is
   * known to have flown through — the §8.2 signal, counted while the positions
   * were still in memory, because it cannot be recovered from the stored row
   * afterwards.
   *
   * A COUNT and not a verdict, the same discipline `pointCount` follows: the
   * rule that reads it lives below, in one place, where it can be argued with.
   */
  airportPointCount: number;
  /**
   * The window this day came out of was still truncated at the one-day floor.
   * The country is proved; the day's SILENCE is not. See the file header.
   */
  partialWindow: boolean;
}

const MS_PER_DAY = 86_400_000;

/** True when the sorted day list holds two calendar-adjacent days. */
function hasConsecutiveDays(sortedDays: readonly string[]): boolean {
  for (let i = 1; i < sortedDays.length; i += 1) {
    const previous = Date.parse(`${sortedDays[i - 1]}T00:00:00Z`);
    const current = Date.parse(`${sortedDays[i]}T00:00:00Z`);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    if (current - previous === MS_PER_DAY) return true;
  }
  return false;
}

interface CountryTrack {
  days: Set<string>;
  points: number;
  airportPoints: number;
}

/**
 * Every country a location history proves, one `EvidenceInput` each.
 *
 * ONE input per country rather than one per day, because the fold keeps the
 * strongest tier and a per-day emission would need each day to carry the
 * whole-country verdict anyway — the airport rule and the consecutive-day rule
 * are both statements about the country, not about a day.
 */
export function trackEvidence(rows: readonly CountryDayRow[]): EvidenceInput[] {
  const byCountry = new Map<string, CountryTrack>();
  /** Which countries each day named, and whether that day may be read as whole. */
  const countriesPerDay = new Map<string, Set<string>>();
  const partialDays = new Set<string>();

  for (const row of rows) {
    const track = byCountry.get(row.countryCode) ?? {
      days: new Set<string>(),
      points: 0,
      airportPoints: 0,
    };
    track.days.add(row.date);
    track.points += row.pointCount;
    track.airportPoints += row.airportPointCount;
    byCountry.set(row.countryCode, track);

    const onDay = countriesPerDay.get(row.date) ?? new Set<string>();
    onDay.add(row.countryCode);
    countriesPerDay.set(row.date, onDay);

    if (row.partialWindow) partialDays.add(row.date);
  }

  const inputs: EvidenceInput[] = [];

  for (const [countryCode, track] of byCountry) {
    const days = [...track.days].sort();
    if (days.length === 0) continue;

    /**
     * Every point in this country sat at an airport it flew through. Applied
     * FIRST and without regard to how many days it covers: a traveller who
     * spends a night on a terminal bench has still never entered the country,
     * and a rule that upgraded them for it would put §1.1's whole complaint —
     * seven countries counted on a connection — straight back.
     */
    const airsideOnly = track.points > 0 && track.airportPoints === track.points;

    /**
     * A day this country had to itself, on a window that was read whole. This
     * is the only place the table's silence is believed, and `partialDays` is
     * why it is safe to believe it here.
     */
    const soleCountryDay = days.some(
      (day) => !partialDays.has(day) && (countriesPerDay.get(day)?.size ?? 0) === 1
    );

    inputs.push({
      country: countryCode,
      kind: "track",
      tier: airsideOnly
        ? "connection"
        : hasConsecutiveDays(days)
          ? "slept"
          : soleCountryDay
            ? "visited"
            : "transited",
      // The earliest day, so a country's first year reads off the first day it
      // was actually observed rather than off whichever row was written first.
      at: new Date(`${days[0]}T00:00:00.000Z`),
      // Straight in. Every one of these days recorded a fix.
      days,
      // No `groundMinutes`, ever. See the file header.
    });
  }

  return inputs.sort((a, b) => (a.country ?? "").localeCompare(b.country ?? ""));
}
