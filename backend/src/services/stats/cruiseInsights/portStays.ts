/**
 * Time in port (forgejo#257): how long the ship lay at each call, from the
 * call's arrival to its departure. Pure.
 *
 * Measured only where BOTH times are known to the minute (`cruiseStopTimes`:
 * a real instant at the port's zone); the stay is the distance between the
 * two instants, so a call across a clock change measures what really passed.
 * A call with a time missing or not minute-precise is left out of the
 * measured set AND out of the average's denominator — counted in
 * `missingTime`, never as a stay of zero. A departure at or before the
 * arrival cannot be a stay and is counted in `inconsistent`.
 *
 * The embarkation and disembarkation ports carry no times of their own on a
 * cruise, so only port calls are measured.
 */

import type { CruiseInsightRow } from "./rows";

export interface PortStay {
  cruiseId: string;
  stopId: string;
  portName: string;
  day: string | null;
  minutes: number;
}

export interface PortStayFold {
  calls: number;
  stays: PortStay[];
  missingTime: number;
  inconsistent: number;
}

export function foldPortStays(rows: readonly CruiseInsightRow[]): PortStayFold {
  const stays: PortStay[] = [];
  let calls = 0;
  let missingTime = 0;
  let inconsistent = 0;
  for (const row of rows) {
    for (const call of row.calls) {
      if (call.isAtSea || call.portName === null) continue;
      calls += 1;
      const { arrival, departure } = call;
      if (
        !arrival ||
        !departure ||
        arrival.precision !== "minute" ||
        departure.precision !== "minute"
      ) {
        missingTime += 1;
        continue;
      }
      const minutes = Math.round((Date.parse(departure.utc) - Date.parse(arrival.utc)) / 60_000);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        inconsistent += 1;
        continue;
      }
      stays.push({
        cruiseId: row.id,
        stopId: call.stopId,
        portName: call.portName,
        day: call.day,
        minutes,
      });
    }
  }
  return { calls, stays, missingTime, inconsistent };
}

const byMinutes = (a: PortStay, b: PortStay): number =>
  a.minutes - b.minutes ||
  (a.day ?? "").localeCompare(b.day ?? "") ||
  a.stopId.localeCompare(b.stopId);

export function stayExtremes(stays: readonly PortStay[]): {
  shortest: PortStay | null;
  longest: PortStay | null;
} {
  const sorted = [...stays].sort(byMinutes);
  return { shortest: sorted[0] ?? null, longest: sorted[sorted.length - 1] ?? null };
}
