import type { Flight } from "../types";

export type FlightGroup =
  | { type: "single"; flight: Flight }
  | { type: "multileg"; flights: Flight[]; label: string };

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function buildLabel(flights: Flight[]): string {
  const codes: string[] = [];
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (i === 0) codes.push(f.depIata ?? f.depIcao ?? "?");
    codes.push(f.arrIata ?? f.arrIcao ?? "?");
  }
  return codes.join(" → ");
}

function connects(a: Flight, b: Flight): boolean {
  const aArr = a.arrIata ?? a.arrIcao;
  const bDep = b.depIata ?? b.depIcao;
  if (!aArr || !bDep || aArr !== bDep) return false;
  const gapMs = new Date(b.departureTime).getTime() - new Date(a.arrivalTime).getTime();
  return gapMs >= 0 && gapMs <= TWELVE_HOURS_MS;
}

export function groupFlights(flights: Flight[]): FlightGroup[] {
  const sorted = [...flights].sort(
    (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
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
