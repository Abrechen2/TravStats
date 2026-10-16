/**
 * The STATION ENDS of train rides — the passport and the country drill-down
 * both read them here (like `./roadtripEvidence.ts`). Which rides: the
 * counted ones (`shared/railCounting.ts`: completed only), passed in already
 * filtered by the loader. A station the geocoder could not place proves
 * nothing (abstention).
 *
 * What an end PROVES is no longer decided here. Owner ruling 2026-10-16 on
 * forgejo#299: rides count like flights, in one chain with them, so each end
 * carries its ride as a `leg` and `./journeyEvidence.ts` grades the chain —
 * a ride out and back proves a visit, a change station is ground presence,
 * an open chain is unclear. The grading that used to live here called a
 * date change `slept`, which #299 rules out ("ein Datumswechsel allein").
 *
 * Pure: rides in, answers out. The loader lives beside it.
 */

import type { JourneyLeg, JourneyMode } from "./journeyEvidence";
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
  /** The end's own day as UTC midnight of that `YYYY-MM-DD`. */
  at: Date;
  /** The day this end attests, `YYYY-MM-DD`, on the station's clock. */
  days: string[];
  /** The ride this end belongs to, as a leg of the travel chain. */
  leg: JourneyLeg;
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

/** Every station end of the counted rides, each carrying its ride as a chain leg. */
export function railEnds(
  rides: readonly RailEvidenceRide[],
  mode: Exclude<JourneyMode, "flight"> = "rail"
): RailEnd[] {
  return rides.flatMap((ride) => {
    const depDay = departureDay(ride);
    const arrDay = arrivalDay(ride);
    const leg: JourneyLeg = {
      mode,
      depCountry: code(ride.depCountry),
      arrCountry: code(ride.arrCountry),
      departedAt: ride.departureTime.getTime(),
      depDay,
      arrDay,
    };
    const ends: Array<[string | null, string, string]> = [
      [leg.depCountry, ride.depStationName, depDay],
      [leg.arrCountry, ride.arrStationName, arrDay],
    ];
    return ends.flatMap(([country, stationName, day]) =>
      country === null
        ? []
        : [
            {
              rideId: ride.id,
              rideLabel: ride.label,
              stationName,
              country,
              at: new Date(`${day}T00:00:00Z`),
              days: [day],
              leg,
            },
          ]
    );
  });
}

/**
 * The chain legs behind a list of ends, one per ride. A ride none of whose
 * stations could be placed has no end and no leg: it proves nothing, and the
 * chain reads past it.
 */
export function legsOfEnds(ends: readonly RailEnd[]): JourneyLeg[] {
  return [...new Map(ends.map((e) => [e.rideId, e.leg])).values()];
}
