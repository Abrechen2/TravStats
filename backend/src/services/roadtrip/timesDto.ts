import { localDay } from "../../shared/time/instant";
import { serializeDay, type LocalDateValue } from "../../shared/time/wire";
import type { RoadtripStationTimes } from "../../schemas/times";
import { readDay } from "../timeModel/readDay";

/**
 * A roadtrip station's `times` (ADR 0002 phase 4): the days of its nights, on
 * the station's clock. Since phase 2 a station stores the instant its day
 * begins at the station (`start_utc`, `stop_zone`, precision `day`); the day
 * is read back from that instant in that zone. A station with no zone keeps
 * its legacy day anchor, read by the backfill's rule and handed out without
 * a zone.
 */
export interface StationTimeColumns {
  startDate: Date | null;
  endDate: Date | null;
  startUtc: Date | null;
  endUtc: Date | null;
  stopZone: string | null;
}

function stationDay(
  instant: Date | null,
  legacy: Date | null,
  zone: string | null
): LocalDateValue | null {
  if (instant && zone) return serializeDay(localDay(instant, zone), zone, "day");
  return readDay(null, legacy, null);
}

export function stationTimes(s: StationTimeColumns): RoadtripStationTimes {
  return {
    start: stationDay(s.startUtc, s.startDate, s.stopZone),
    end: stationDay(s.endUtc, s.endDate, s.stopZone),
  };
}
