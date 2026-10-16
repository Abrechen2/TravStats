/**
 * The travel CHAIN — flights, trains and coaches in one order — read for what
 * it proves about each country (forgejo#299).
 *
 * ## The rules, and the rulings behind them
 *
 * - **forgejo#299 (owner, 2026-10-13):** every flown end is ground presence
 *   ("Am Boden gewesen"). Only an outbound and a return at the real
 *   destination prove a visit ("Land besucht"); no hotel or POI is needed,
 *   and no overnight, date change or time threshold may stand in for one.
 *   MUC->DOH->HAN and back: Vietnam visited, Qatar ground only. A chain that
 *   cannot be decided is shown as UNCLEAR, never as an invented certainty.
 * - **Owner ruling 2026-10-16:** train and coach rides count exactly like
 *   flights. A ride out and a ride back to the same destination prove a
 *   visit; a change station is ground presence only; an open or undecidable
 *   chain is unclear. All three modes form ONE chain, so flying out and
 *   taking the train back closes a round trip as well.
 *
 * ## A spell is not a stay
 *
 * A spell on the ground is the interval between an arrival and the next
 * recorded departure from the same country; it measures the absence of a
 * recorded departure, not presence. So a spell contributes its two ENDPOINT
 * days (`attestedGroundDays`) and publishes minutes only for a flight pair
 * spanning at most one night (`measuredGroundMinutes`); see
 * `shared/countryEvidence.ts`.
 */

import {
  attestedGroundDays,
  measuredGroundMinutes,
  type CountryTier,
  type EvidenceInput,
} from "../../shared/countryEvidence";

/**
 * Why a chain cannot decide whether a country was visited.
 *
 * - `openChain`: the recorded chain breaks here — a one-way arrival, an
 *   open-jaw end (MUC->BKK, PNH->MUC), the first or last leg on record. The
 *   traveller left or arrived by something nobody logged.
 * - `noDestination`: a trip between two breaks or home touches that never
 *   turns around (MUC->BKK->SGN->MUC). One of its countries was probably the
 *   destination; no rule may pick which without a time threshold.
 * - `undated`: the leg has no day, so it cannot be placed in a chain.
 */
export type VisitUnclearReason = "openChain" | "noDestination" | "undated";

/** A chain's evidence, plus why it could not decide a visit. */
export interface JourneyEvidenceInput extends EvidenceInput {
  unclear?: VisitUnclearReason;
}

export type JourneyMode = "flight" | "rail" | "bus";

/** One leg of the chain, already reduced to countries and local days. */
export interface JourneyLeg {
  mode: JourneyMode;
  depCountry: string | null;
  arrCountry: string | null;
  /** Ordering key in ms; undated legs carry MAX_SAFE_INTEGER and sort last. */
  departedAt: number;
  /** Local day the leg left on, `YYYY-MM-DD`, or null. */
  depDay: string | null;
  /** Local day the leg arrived on — for a flight, its departure day (forgejo#273). */
  arrDay: string | null;
  /** Real instants, flights only, for the measured ground time. */
  departureInstant?: Date | null;
  arrivalInstant?: Date | null;
}

/** A carrier for a local day: UTC midnight of it, the fold's convention. */
export const dayCarrier = (day: string | null): Date | null =>
  day === null ? null : new Date(`${day}T00:00:00Z`);

/**
 * The tier of ground presence that is not a visit: a change of planes is a
 * `connection` (airside); a station stands inside the country (`transited`).
 */
const groundTier = (mode: JourneyMode): CountryTier =>
  mode === "flight" ? "connection" : "transited";

interface Run {
  start: number;
  end: number;
  country: string;
  returned: boolean;
  inputs: JourneyEvidenceInput[];
}

/**
 * Every country the chain touches, graded. `homeCountries` split the chain
 * into trips: a spell at home is neither a destination nor a connection of the
 * trips on either side, so a turnaround on one trip cannot decide a country
 * on another.
 */
export function journeyEvidence(
  legs: readonly JourneyLeg[],
  homeCountries: ReadonlySet<string> = new Set()
): JourneyEvidenceInput[] {
  const chain = [...legs].sort((a, b) => a.departedAt - b.departedAt);
  const inputs: JourneyEvidenceInput[] = [];
  const consumed = new Set<string>();

  // The spell between leg i's arrival and leg i+1's departure, or null where
  // there is none to read (different countries, an unknown country, a
  // missing day — the weaker claim is the right way round to be wrong).
  const segments = chain.slice(0, -1).map((leg, i) => {
    const next = chain[i + 1];
    const country = leg.arrCountry;
    return country !== null && country === next.depCountry && leg.arrDay && next.depDay
      ? { country, arrivalDay: leg.arrDay, departureDay: next.depDay }
      : null;
  });

  const runs: Run[] = [];
  let start = 0;
  while (start < segments.length) {
    const first = segments[start];
    if (!first) {
      start += 1;
      continue;
    }
    // One uninterrupted spell in one country, however many domestic legs.
    let end = start;
    let last = first;
    while (end + 1 < segments.length) {
      const next = segments[end + 1];
      if (!next || next.country !== first.country) break;
      end += 1;
      last = next;
    }

    // An unknown side is never read as a return: that would upgrade a country
    // on the strength of a missing value.
    const arrivedBy = chain[start];
    const leftBy = chain[end + 1];
    const cameFrom = arrivedBy.depCountry;
    const returned = cameFrom !== null && cameFrom === leftBy.arrCountry;

    // Minutes only for a flight pair, measured across the whole run; null
    // when either clock is missing or the record contradicts itself.
    const landed = arrivedBy.arrivalInstant;
    const leftAgain = leftBy.departureInstant;
    const spellMinutes =
      arrivedBy.mode === "flight" &&
      leftBy.mode === "flight" &&
      landed &&
      leftAgain &&
      leftAgain.getTime() >= landed.getTime()
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
      // Each mode that bounds the spell is credited, so a flight out and a
      // train back both stand behind the visit (and behind their domain).
      const modes = [...new Set([chain[i].mode, chain[i + 1].mode])];
      for (const mode of modes) {
        run.inputs.push({
          country: segment.country,
          kind: mode,
          tier: returned ? "visited" : groundTier(mode),
          at: dayCarrier(segment.arrivalDay),
          days: attestedGroundDays(segment.arrivalDay, segment.departureDay),
          ...(mode === "flight" ? { groundMinutes: runMinutes } : {}),
        });
      }
    }
    start = end + 1;
  }

  // Trips: consecutive runs joined by one leg, split at every spell at home.
  // A trip with a turnaround decides its other runs as connections; one
  // without cannot tell its destination from its hubs, so those are unclear.
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

  // An end no spell consumed places the traveller in the country for one day
  // — and is exactly where the recorded chain breaks.
  chain.forEach((leg, i) => {
    const unclear: VisitUnclearReason = leg.depDay === null ? "undated" : "openChain";
    const ends: Array<[string, string | null, string | null]> = [
      ["dep", leg.depCountry, leg.depDay],
      ["arr", leg.arrCountry, leg.arrDay],
    ];
    for (const [side, country, day] of ends) {
      if (consumed.has(`${i}:${side}`)) continue;
      inputs.push({
        country,
        kind: leg.mode,
        tier: groundTier(leg.mode),
        at: dayCarrier(day),
        days: day === null ? [] : [day],
        unclear,
      });
    }
  });

  return inputs;
}
