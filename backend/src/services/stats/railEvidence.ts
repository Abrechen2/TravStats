/**
 * What a TRAIN RIDE proves about a country — the passport and the country
 * drill-down both ask it, and both ask it here (like `./roadtripEvidence.ts`).
 *
 * Before this file the Stats overview counted a ride's countries
 * (`crossDomainPopulations.loadRail`) while the passport and the drill-down did
 * not know them, so the same account showed two different country totals on
 * two pages.
 *
 * ## Which rides
 *
 * The counted ones (`shared/railCounting.ts`: completed; cancelled and upcoming
 * never), passed in already filtered by the loader.
 *
 * ## The tier is structural, as for flights
 *
 * A ride has two ENDS, each a station in a country the geocoder named — a
 * station it could not place proves nothing (abstention). An end is where the
 * traveller stood on the ground. Walked in order, an arrival followed by the
 * next ride leaving from the same country is a spell on the ground, read on the
 * STATIONS' calendars (`stationDayKey`):
 *
 *   - the day changed → `slept`, the evidence an overnight between two flights
 *     gives (spec 2026-09-02 §7.5).
 *   - the same day, and the next ride goes back where the traveller came from
 *     → a day trip: `visited`.
 *   - the same day, onward → a change of trains: `transited`. Not
 *     `connection`: that tier is "a change of planes and nothing else", an
 *     airside stop. A station is inside the country, on the ground — the
 *     owner's rule for a border crossed by road (2026-09-02) — so it counts by
 *     default, like driving through.
 *
 * An end with no such partner — the first departure, the last arrival, or an
 * arrival followed by a flight — is `visited`: the traveller was there that
 * day, and nothing recorded says they stayed the night.
 *
 * Pure: rides in, answers out. The loader lives beside it.
 */

import type { EvidenceInput } from "../../shared/countryEvidence";
import type { CountryTier } from "../../shared/countryEvidence";
import { stationDayKey } from "../../shared/railCounting";

/** The columns this reads. Any rail journey row is a superset. */
export interface RailEvidenceRide {
  id: string;
  label: string;
  depStationName: string;
  arrStationName: string;
  depCountry: string | null;
  arrCountry: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
}

/** One station end of a ride, as evidence of the country it stands in. */
export interface RailEnd {
  rideId: string;
  rideLabel: string;
  stationName: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  tier: CountryTier;
  /** First attested day as UTC midnight of that `YYYY-MM-DD`. */
  at: Date;
  /** The days this end attests, `YYYY-MM-DD`: its own, plus its partner's across a spell. */
  days: string[];
}

const code = (c: string | null): string | null =>
  c && /^[A-Za-z]{2}$/.test(c.trim()) ? c.trim().toUpperCase() : null;

/** The arrival's day on the arrival station's clock — the departure's, when the arrival is unknown. */
function arrivalDay(ride: RailEvidenceRide): string {
  return ride.arrivalTime
    ? stationDayKey(ride.arrivalTime, ride.arrTimezone)
    : stationDayKey(ride.departureTime, ride.depTimezone);
}

const departureDay = (ride: RailEvidenceRide): string =>
  stationDayKey(ride.departureTime, ride.depTimezone);

function end(
  ride: RailEvidenceRide,
  side: "dep" | "arr",
  tier: CountryTier,
  days: string[]
): RailEnd | null {
  const country = code(side === "dep" ? ride.depCountry : ride.arrCountry);
  if (!country) return null;
  const unique = [...new Set(days)].sort();
  return {
    rideId: ride.id,
    rideLabel: ride.label,
    stationName: side === "dep" ? ride.depStationName : ride.arrStationName,
    country,
    tier,
    at: new Date(`${unique[0]}T00:00:00Z`),
    days: unique,
  };
}

/** Every station end of the counted rides, graded. Rides may arrive in any order. */
export function railEnds(rides: readonly RailEvidenceRide[]): RailEnd[] {
  const ordered = [...rides].sort(
    (a, b) => a.departureTime.getTime() - b.departureTime.getTime() || a.id.localeCompare(b.id)
  );
  const out: RailEnd[] = [];
  /** A departure end already written as the second half of a spell. */
  const pairedDeparture = new Set<number>();

  ordered.forEach((ride, i) => {
    if (!pairedDeparture.has(i)) {
      const dep = end(ride, "dep", "visited", [departureDay(ride)]);
      if (dep) out.push(dep);
    }
    const next = ordered[i + 1];
    const here = code(ride.arrCountry);
    const arrDay = arrivalDay(ride);
    if (next && here !== null && code(next.depCountry) === here) {
      const leaveDay = departureDay(next);
      const tier: CountryTier =
        leaveDay !== arrDay
          ? "slept"
          : code(next.arrCountry) !== null && code(next.arrCountry) === code(ride.depCountry)
            ? "visited"
            : "transited";
      const days = [arrDay, leaveDay];
      const arr = end(ride, "arr", tier, days);
      const leave = end(next, "dep", tier, days);
      if (arr) out.push(arr);
      if (leave) out.push(leave);
      pairedDeparture.add(i + 1);
      return;
    }
    const arr = end(ride, "arr", "visited", [arrDay]);
    if (arr) out.push(arr);
  });
  return out;
}

/** The fold's inputs for every end. */
export function railEvidence(ends: readonly RailEnd[]): EvidenceInput[] {
  return ends.map((e) => ({
    country: e.country,
    kind: "rail",
    tier: e.tier,
    at: e.at,
    days: e.days,
  }));
}
