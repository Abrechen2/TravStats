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
 *
 * ## A spell is not a stay — read this before touching the days or the minutes
 *
 * **Ground time measures the absence of a recorded departure, not presence.**
 * A spell here is the interval between a landing and the next recorded
 * departure from the same country; where the traveller was in between, the
 * records do not say. Reading that interval as presence reported an account's
 * home country as `daysPresent: 2200` with 3,136,245 ground minutes on the beta
 * server (2026-09-02) — a landing in Munich on 2020-01-26 and the next German
 * departure on 2025-07-16, with nothing logged between them.
 *
 * So a spell contributes its two ENDPOINT days (`attestedGroundDays`), and it
 * publishes minutes only while it spans at most one night
 * (`measuredGroundMinutes`). Both rules live in `shared/countryEvidence.ts`;
 * this file only feeds them the run's own ends.
 */

import {
  attestedGroundDays,
  measuredGroundMinutes,
  type EvidenceInput,
} from "../../shared/countryEvidence";

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
export const flightDay = (f: {
  localDay?: string | null;
  departureTime: Date | null;
}): string | null => f.localDay ?? isoDayOf(f.departureTime);

/**
 * The `at` a flight hands the fold: its local day as UTC midnight. The fold
 * dates a record by the UTC day of `at` (`shared/countryEvidence.ts`) and
 * widens a country's first and last date with it, so the raw departure instant
 * put a Tokyo 07:30 departure on 1 January into the year before, beside the
 * local `days` it was handed (forgejo#273). UTC midnight is a carrier for the
 * day, the convention `airportCalendarDay` uses — not a claim about the zone.
 */
const dayCarrier = (day: string | null): Date | null =>
  day === null ? null : new Date(`${day}T00:00:00Z`);

/** Undated rows sort last: they cannot take part in a day comparison. */
const departedAt = (f: PassportFlight): number =>
  f.departureTime ? f.departureTime.getTime() : Number.MAX_SAFE_INTEGER;

/**
 * Why a flight chain cannot decide whether a country was visited (forgejo#299:
 * "nicht eindeutig entscheidbare Ketten als unklar ausweisen").
 *
 * - `openChain`: the recorded chain breaks here — a one-way arrival, an
 *   open-jaw end (MUC->BKK, PNH->MUC), the first or last flight on record. The
 *   traveller left or arrived by something nobody logged.
 * - `noDestination`: a trip between two breaks or home touches that never
 *   turns around (MUC->BKK->SGN->MUC). One of its countries was probably the
 *   destination; no rule may pick which without a time threshold, which the
 *   issue forbids.
 * - `undated`: the flight has no day, so it cannot be placed in a chain.
 */
export type VisitUnclearReason = "openChain" | "noDestination" | "undated";

/** A flight's evidence, plus why its chain could not decide a visit. */
export interface FlightEvidenceInput extends EvidenceInput {
  unclear?: VisitUnclearReason;
}

/**
 * Ground presence follows from flown endpoints. A visit needs a return-shaped
 * chain, never an overnight or an elapsed-time threshold (forgejo#299).
 * Consecutive domestic legs are one spell. A spell between two other countries
 * on a trip that turns around elsewhere is a connection — decided ground
 * presence (MUC->DOH->HAN and back: Qatar). Everything the chain cannot decide
 * carries an `unclear` reason instead of being called a connection; another
 * curated source (a stay, a place) may still prove the visit.
 *
 * `homeCountries` split the chain into trips: a spell at home is neither a
 * destination nor a connection of the trips on either side of it, so a
 * turnaround on one trip cannot decide a country on another.
 */
export function flightEvidence(
  flights: readonly PassportFlight[],
  countryOf: (iata: string | null) => string | null,
  homeCountries: ReadonlySet<string> = new Set()
): FlightEvidenceInput[] {
  const chain = flights
    .filter((f) => FLOWN.has(f.status))
    .sort((a, b) => departedAt(a) - departedAt(b));

  const inputs: FlightEvidenceInput[] = [];
  const consumed = new Set<string>();

  /**
   * The ground segment between `chain[i]` and `chain[i + 1]`, or null where
   * there is none to read. An undated end cannot say whether a night passed, so
   * it is no segment either: both flights' ends then stay unconsumed and fall
   * through to ground-only evidence below — a weaker claim than the data may support, which
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

  /** One uninterrupted spell on the ground, with the flights that bound it. */
  interface Run {
    start: number;
    end: number;
    country: string;
    returned: boolean;
    inputs: FlightEvidenceInput[];
  }
  const runs: Run[] = [];

  let start = 0;
  while (start < segments.length) {
    const first = segments[start];
    if (!first) {
      start += 1;
      continue;
    }

    // The maximal run of consecutive segments in this same country — one
    // uninterrupted spell on the ground, however many domestic hops it contains.
    // `last` is carried along because the run's two ends are what the duration
    // is judged on, and a null segment can never join a run (it has no country).
    let end = start;
    let last = first;
    while (end + 1 < segments.length) {
      const next = segments[end + 1];
      if (!next || next.country !== first.country) break;
      end += 1;
      last = next;
    }

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
     *
     * And null again, through `measuredGroundMinutes`, once the run spans more
     * than one night: past that the interval stops describing a stay and starts
     * describing a hole in the flight log. Judged on the RUN's two ends, because
     * the run is what the interval was measured across — asking segment by
     * segment would let a three-year gap publish itself as long as each
     * individual hop happened to be short.
     */
    const landed = chain[start].arrivalInstant;
    const leftAgain = chain[end + 1].departureInstant;
    const spellMinutes =
      landed && leftAgain && leftAgain.getTime() >= landed.getTime()
        ? Math.round((leftAgain.getTime() - landed.getTime()) / 60_000)
        : null;
    const runMinutes = measuredGroundMinutes(first.arrivalDay, last.departureDay, spellMinutes);

    const run: Run = { start, end, country: first.country, returned, inputs: [] };
    runs.push(run);
    for (let i = start; i <= end; i += 1) {
      const segment = segments[i];
      if (!segment) continue;
      consumed.add(`${i}:arr`);
      consumed.add(`${i + 1}:dep`);
      run.inputs.push({
        country: segment.country,
        kind: "flight",
        tier: returned ? "visited" : "connection",
        at: dayCarrier(segment.arrivalDay),
        // The two ends of the spell and nothing between them — the days the
        // records attest. Read on the airports' own clocks, never on the UTC
        // instant beside them: a red-eye that lands after midnight UTC would
        // otherwise report a day in a country the traveller connected through
        // in three hours.
        days: attestedGroundDays(segment.arrivalDay, segment.departureDay),
        groundMinutes: runMinutes,
      });
    }

    start = end + 1;
  }

  /**
   * Group the runs into trips: consecutive runs joined by one flight (the run
   * before ends where the next begins), split at every spell at home. A trip
   * with a turnaround decides its other runs as connections; a trip without
   * one cannot tell its destination from its hubs, so those runs are unclear.
   */
  let trip: Run[] = [];
  const closeTrip = () => {
    const decided = trip.some((r) => r.returned);
    for (const r of trip) {
      for (const input of r.inputs) {
        inputs.push(r.returned || decided ? input : { ...input, unclear: "noDestination" });
      }
    }
    trip = [];
  };
  for (const run of runs) {
    const previous = trip[trip.length - 1];
    if (previous && previous.end + 1 !== run.start) closeTrip();
    if (homeCountries.has(run.country)) {
      closeTrip();
      inputs.push(...run.inputs);
      continue;
    }
    trip.push(run);
  }
  closeTrip();

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
    // An unpaired end is where the recorded chain breaks: whether the
    // traveller stayed is exactly what the records do not say.
    const unclear: VisitUnclearReason = day === null ? "undated" : "openChain";
    if (!consumed.has(`${i}:dep`)) {
      inputs.push({
        country: countryOf(f.depIata),
        kind: "flight",
        tier: "connection",
        at: dayCarrier(day),
        days,
        unclear,
      });
    }
    if (!consumed.has(`${i}:arr`)) {
      inputs.push({
        country: countryOf(f.arrIata),
        kind: "flight",
        tier: "connection",
        at: dayCarrier(day),
        days,
        unclear,
      });
    }
  }

  return inputs;
}
