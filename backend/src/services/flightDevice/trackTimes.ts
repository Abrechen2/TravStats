import type { Flight } from "../../prisma";
import { serializeTime, type TimeValue } from "../../shared/time/wire";
import { getAirportTimezone } from "../../utils/timezone";

/**
 * A recording's start and end in the time model's shape (ADR 0002 D3): the
 * start on the departure airport's clock, the end on the arrival airport's —
 * where the phone was when it began and stopped. The row's stored zone wins;
 * the catalogue's is the fallback, labelled as such, exactly like a provider's
 * reported times (`services/flights/timesDto.ts`).
 */
export type TrackZoneColumns = Pick<
  Flight,
  "depTimezone" | "arrTimezone" | "depIata" | "depIcao" | "arrIata" | "arrIcao"
>;

async function zoneOf(
  stored: string | null,
  code: string | null
): Promise<{ zone: string | null; source: "stored" | "catalogue" }> {
  if (stored) return { zone: stored, source: "stored" };
  return { zone: await getAirportTimezone(code), source: "catalogue" };
}

export async function trackTimes(
  track: { startedAt: Date; endedAt: Date },
  flight: TrackZoneColumns
): Promise<{ startedAt: TimeValue; endedAt: TimeValue }> {
  const [dep, arr] = await Promise.all([
    zoneOf(flight.depTimezone, flight.depIata ?? flight.depIcao),
    zoneOf(flight.arrTimezone, flight.arrIata ?? flight.arrIcao),
  ]);
  return {
    startedAt: serializeTime(track.startedAt, dep.zone, "minute", dep.source),
    endedAt: serializeTime(track.endedAt, arr.zone, "minute", arr.source),
  };
}
