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

import type { JourneyEvidenceInput, JourneyLeg, VisitUnclearReason } from "./journeyEvidence";

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

/** Undated rows sort last: they cannot take part in a day comparison. */
const departedAt = (f: PassportFlight): number => {
  const at = f.departureInstant ?? f.departureTime;
  return at ? at.getTime() : Number.MAX_SAFE_INTEGER;
};

export type { VisitUnclearReason, JourneyEvidenceInput as FlightEvidenceInput };

/**
 * The FLOWN flights as legs of the travel chain (`./journeyEvidence.ts`),
 * which reads them together with train and coach rides (owner ruling
 * 2026-10-16). Both ends are filed on the flight's own local day
 * (`flightDay`), as `/stats/countries` does: a red-eye is one journey.
 *
 * Ordered by the real departure instant where the caller resolved one, so a
 * flight and a train on the same day fall in the order they happened; a row
 * without one falls back to the stored time.
 */
export function flightLegs(
  flights: readonly PassportFlight[],
  countryOf: (iata: string | null) => string | null
): JourneyLeg[] {
  return flights
    .filter((f) => FLOWN.has(f.status))
    .map((f) => {
      const day = flightDay(f);
      return {
        mode: "flight" as const,
        depCountry: countryOf(f.depIata),
        arrCountry: countryOf(f.arrIata),
        departedAt: departedAt(f),
        depDay: day,
        arrDay: day,
        departureInstant: f.departureInstant ?? null,
        arrivalInstant: f.arrivalInstant ?? null,
      };
    });
}
