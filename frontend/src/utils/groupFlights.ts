import type { Flight } from "../types";

export type FlightGroup =
  | { type: "single"; flight: Flight }
  | { type: "multileg"; flights: Flight[]; label: string };

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function buildLabel(flights: Flight[]): string {
  const first = flights[0].depIata ?? flights[0].depIcao ?? "?";
  const rest = flights.map((f) => f.arrIata ?? f.arrIcao ?? "?");
  return [first, ...rest].join(" → ");
}

/**
 * Returns true if flight B is a connecting leg for flight A.
 * Assumes IATA and ICAO codes are populated with the same priority on both ends
 * (e.g. both IATA-first or both ICAO-first). Mixed modes (arrIcao vs depIata for
 * the same airport) will not match.
 */
function connects(a: Flight, b: Flight): boolean {
  const aArr = a.arrIata ?? a.arrIcao;
  const bDep = b.depIata ?? b.depIcao;
  if (!aArr || !bDep || aArr !== bDep) return false;
  if (!a.arrivalTime || !b.departureTime) return false;
  const gapMs = new Date(b.departureTime).getTime() - new Date(a.arrivalTime).getTime();
  return gapMs >= 0 && gapMs <= TWELVE_HOURS_MS;
}

/**
 * Groups connecting flights into multi-leg entries.
 *
 * Two consecutive flights (after sorting by departure time) are grouped when:
 * - The arrival airport of flight A matches the departure airport of flight B
 * - The gap between A's arrival and B's departure is between 0 and 12 hours
 *
 * **Limitation:** Only adjacent-after-sort flights can be chained. A connecting
 * flight that sorts between two unrelated flights will not be matched to its
 * true partner. In practice, connecting legs share the same booking and sort
 * adjacently by departure time.
 */
export function groupFlights(flights: Flight[]): FlightGroup[] {
  const sorted = [...flights].sort(
    (a, b) =>
      (a.departureTime ? new Date(a.departureTime).getTime() : 0) -
      (b.departureTime ? new Date(b.departureTime).getTime() : 0)
  );

  const groups: FlightGroup[] = [];
  let i = 0;

  while (i < sorted.length) {
    const chain: Flight[] = [sorted[i]];
    while (i + 1 < sorted.length && connects(chain[chain.length - 1], sorted[i + 1])) {
      i++;
      chain.push(sorted[i]);
    }
    if (chain.length === 1) {
      groups.push({ type: "single", flight: chain[0] });
    } else {
      groups.push({
        type: "multileg",
        flights: chain,
        label: buildLabel(chain),
      });
    }
    i++;
  }

  return groups;
}
