/**
 * What a FLIGHT LIST proves about each country, read as spells on the ground.
 *
 * Lifted out of `passport.ts` when that file crossed the 800-line limit — a
 * move, not a rewrite. The seam is the natural one: everything here answers
 * "what do these flights say about which countries, how strongly, on which days
 * and for how long", while `passport.ts` assembles the card around that answer.
 *
 * The tiers themselves, and the counting rule they feed, stay in
 * `shared/countryEvidence.ts`. Nothing is decided twice.
 */

import { daysBetween, groundTier, type EvidenceInput } from "../../shared/countryEvidence";

/** A flight is a stamp only once it has been flown. Rule 1 of the passport. */
export const FLOWN = new Set(["flown", "historical"]);

/** ISO day of an instant, or null when there is none. */
export const isoDayOf = (at: Date | null | undefined): string | null =>
  at ? at.toISOString().slice(0, 10) : null;

/** The columns the derivation reads. Any flight row is a superset. */
export interface PassportFlight {
  depIata: string | null;
  depLat: number;
  depLon: number;
  arrIata: string | null;
  arrLat: number;
  arrLon: number;
  departureTime: Date | null;
  status: string;
  /**
   * The calendar day this flight belongs to, `YYYY-MM-DD`, read at the
   * DEPARTURE airport's clock (utils/timezone.ts `localWallClockOf`).
   *
   * BOTH ends of a flight are filed on that one day — the rule
   * `/stats/countries` already follows, because "a red-eye that lands after
   * midnight is still one journey" and splitting its two ends across two days
   * would report a country visited on a day the traveller never flew.
   *
   * Resolved by the CALLER, because only it can reach the airport catalogue's
   * timezones. Optional so every existing caller keeps working; without one the
   * stored instant's UTC day is used, which is the same fallback
   * `localWallClockOf` itself makes for an airport whose timezone is unknown.
   */
  localDay?: string | null;
  /**
   * The two ends of the flight as REAL instants, or null where the row cannot
   * supply one — the only thing a ground time may be measured from (spec §3.4b).
   *
   * Resolved by the CALLER through `normalizeFlightTimeUtc`, for the same reason
   * `localDay` is: the storage semantics and the airport's timezone live outside
   * this function, and a naive subtraction of the stored columns would answer
   * confidently on rows where the answer does not exist. A DATE_ONLY row carries
   * a 12:00 placeholder and must arrive here as null — a placeholder minus a
   * placeholder is a plausible number and a fabricated one.
   *
   * Both optional, so every existing caller keeps its exact behaviour and simply
   * reports `unknown` for the ground time it never measured.
   */
  departureInstant?: Date | null;
  arrivalInstant?: Date | null;
}

/** The day a flight belongs to — see `PassportFlight.localDay`. */
const flightDay = (f: PassportFlight): string | null => f.localDay ?? isoDayOf(f.departureTime);

/** Undated rows sort last: they cannot take part in a day comparison. */
const departedAt = (f: PassportFlight): number =>
  f.departureTime ? f.departureTime.getTime() : Number.MAX_SAFE_INTEGER;

/**
 * What the flight list proves about each country, as evidence tiers.
 *
 * The case the old rule got wrong is the country somebody only changed planes
 * in. It is visible in the data as a GROUND SEGMENT — landed on one flight,
 * left on the next — so the flights are walked in chronological order and each
 * such segment is read through `groundTier`:
 *
 *   - the local day changed → `slept`. Same evidence a hotel gives, from a
 *     different source (spec §7.5).
 *   - the local day did not → a connection OR a day trip, and which one is
 *     decided by where the journey goes next. See below.
 *
 * `groundTier` answers `visited` for a same-day pair because it compares two
 * days and nothing more; what a same-day gap MEANS is this function's question.
 *
 * ## A connection continues onward; a day trip returns
 *
 * Filing every same-day ground segment as `transit` was wrong in a way that
 * silently deleted countries: fly MUC→FCO in the morning and FCO→MUC at night
 * and Italy dropped out of the headline, despite a day spent in Rome. The two
 * shapes were called "structurally identical". They are not — the structure that
 * tells them apart is the DESTINATION of the onward flight:
 *
 *   - it lands in the country the traveller came FROM → they went there and came
 *     back. That is a return, not a connection, in any ordinary sense of the
 *     word, and the tier is `visited`.
 *   - it lands anywhere else → the journey continued onward, which is what a
 *     connection is, and the tier stays `transit`.
 *
 * Compared at COUNTRY level, not airport level: MUC→FCO→FRA is a day in Rome
 * between two German airports just as much as MUC→FCO→MUC is.
 *
 * A run of several ground segments in one country is judged as ONE stay on the
 * ground, because that is what it is: JFK→LHR→EDI→JFK never leaves Britain in
 * between, and pairwise reading called both of its segments a connection and
 * dropped the United Kingdom out of a headline that contained three flights to
 * it.
 *
 * ## The ambiguous shape, and why it stays `transit`
 *
 * MUC→FCO→BCN on one day cannot be told apart from a morning in Rome. It is
 * ALSO the exact shape of every hub connection there is — MUC→DOH→SIN, the case
 * §1.1 was written about. Reading the triangle as `visited` would therefore not
 * be "erring towards the stronger tier at the margin"; it would empty the
 * `transit` tier completely and put all seven of the owner's sub-five-hour
 * connections back in the headline, which is the defect this whole rework
 * exists to remove. So the triangle keeps the weaker reading, and the country
 * keeps its row in the list where a reader can see it.
 *
 * A geometric tie-breaker — "is B on the way from A to C" — was considered and
 * rejected: it is a dial to turn until the total feels right, which is the thing
 * §2 refuses on principle.
 *
 * Every end NOT consumed by a segment is `visited`: the airport somebody first
 * flew out of, the one they never flew home from, both ends of a domestic hop.
 * None of those is a connection, and reading them as one would have demoted the
 * home country of anybody whose first recorded flight is an outbound one.
 *
 * The cost of filing both ends of a flight on its DEPARTURE day is named here
 * rather than hidden: a red-eye that lands after midnight reads as an overnight
 * even when the traveller connected in three hours. That errs towards the
 * stronger tier, which keeps a country in the headline rather than dropping one
 * out of it — the safe direction for a hint.
 */
export function flightEvidence(
  flights: readonly PassportFlight[],
  countryOf: (iata: string | null) => string | null
): EvidenceInput[] {
  const chain = flights
    .filter((f) => FLOWN.has(f.status))
    .sort((a, b) => departedAt(a) - departedAt(b));

  const inputs: EvidenceInput[] = [];
  const consumed = new Set<string>();

  /**
   * The ground segment between `chain[i]` and `chain[i + 1]`, or null where
   * there is none to read. An undated end cannot say whether a night passed, so
   * it is no segment either: both flights' ends then stay unconsumed and fall
   * through to `visited` below — a weaker claim than the data may support, which
   * is the right way round to be wrong.
   */
  interface GroundSegment {
    country: string;
    arrivalDay: string;
    departureDay: string;
  }

  const segments: (GroundSegment | null)[] = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    const country = countryOf(chain[i].arrIata);
    const arrivalDay = flightDay(chain[i]);
    const departureDay = flightDay(chain[i + 1]);
    const joined = country !== null && country === countryOf(chain[i + 1].depIata);
    segments.push(
      joined && country && arrivalDay && departureDay ? { country, arrivalDay, departureDay } : null
    );
  }

  let start = 0;
  while (start < segments.length) {
    const first = segments[start];
    if (!first) {
      start += 1;
      continue;
    }

    // The maximal run of consecutive segments in this same country — one
    // uninterrupted spell on the ground, however many domestic hops it contains.
    let end = start;
    while (end + 1 < segments.length && segments[end + 1]?.country === first.country) end += 1;

    // Where the traveller came from, and where they went afterwards. Null on
    // either side means "cannot be known", and an unknown side is never read as
    // a return: that would upgrade a country on the strength of a missing value.
    const cameFrom = countryOf(chain[start].depIata);
    const wentTo = countryOf(chain[end + 1].arrIata);
    const returned = cameFrom !== null && cameFrom === wentTo;

    /**
     * The spell on the ground, measured across the WHOLE run rather than
     * segment by segment — the same unit the tier is judged on, and for the
     * same reason: JFK→LHR→EDI→JFK never leaves Britain in between, so the time
     * there is the landing at Heathrow to the take-off from Edinburgh, not two
     * shorter gaps with a domestic hop deleted from the middle.
     *
     * Null unless BOTH ends are real instants. A negative result is a record
     * contradicting itself (an arrival stored after the next departure) and
     * abstains rather than publishing a negative hour count.
     */
    const landed = chain[start].arrivalInstant;
    const leftAgain = chain[end + 1].departureInstant;
    const spellMinutes =
      landed && leftAgain && leftAgain.getTime() >= landed.getTime()
        ? Math.round((leftAgain.getTime() - landed.getTime()) / 60_000)
        : null;

    for (let i = start; i <= end; i += 1) {
      const segment = segments[i];
      if (!segment) continue;
      consumed.add(`${i}:arr`);
      consumed.add(`${i + 1}:dep`);
      inputs.push({
        country: segment.country,
        kind: "flight",
        tier:
          groundTier(segment.arrivalDay, segment.departureDay) === "slept"
            ? "slept"
            : returned
              ? "visited"
              : "transit",
        at: chain[i].departureTime,
        // Read on the airports' own clocks, never on the UTC instant beside
        // them: a red-eye that lands after midnight UTC would otherwise report
        // a day in a country the traveller connected through in three hours.
        days: daysBetween(segment.arrivalDay, segment.departureDay),
        groundMinutes: spellMinutes,
      });
    }

    start = end + 1;
  }

  /**
   * An end no ground segment consumed places the traveller in the country for
   * ONE day — the flight's own. It bounds no spell, so it carries no ground
   * minutes and the country reports `unknown` unless some other pair measured
   * one: a one-way arrival genuinely does not say how long the stay was.
   */
  for (let i = 0; i < chain.length; i += 1) {
    const f = chain[i];
    const day = flightDay(f);
    const days = day === null ? [] : [day];
    if (!consumed.has(`${i}:dep`)) {
      inputs.push({
        country: countryOf(f.depIata),
        kind: "flight",
        tier: "visited",
        at: f.departureTime,
        days,
      });
    }
    if (!consumed.has(`${i}:arr`)) {
      inputs.push({
        country: countryOf(f.arrIata),
        kind: "flight",
        tier: "visited",
        at: f.departureTime,
        days,
      });
    }
  }

  return inputs;
}
