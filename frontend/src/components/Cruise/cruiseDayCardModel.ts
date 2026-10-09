import { clockOf, now, todayIn } from "../../shared/time";
import type { TimeValue } from "../../shared/time";
import type { TravelDocument } from "../../lib/api/documents";
import type { CruiseStop } from "../../types";
import { cruiseStopArrival, cruiseStopDeparture } from "../../lib/entityTimes";
import type { EffectiveTimelineEntry } from "./cruisePorts";

/**
 * The itinerary entry that is TODAY, if the cruise is underway (forgejo#223).
 *
 * "Today" is asked at the place: a port call's day is the port's calendar
 * day, so it is compared with today in the PORT's zone — a ship in Sydney is
 * on the next day while the reader at home still has the evening. A sea day
 * or an unresolved port has no zone; it is asked in the reader's "today"
 * zone (`useTodayZone`: the profile zone, else UTC — never the browser's).
 * Only entries with a stop row count: the card is about a day of the cruise.
 */
export function todayEntryKey(
  entries: readonly EffectiveTimelineEntry[],
  fallbackZone: string,
  at: Date = now()
): string | null {
  for (const entry of entries) {
    if (!entry.stop || !entry.date) continue;
    const zone = entry.stop.stopZone ?? entry.port?.timezone ?? fallbackZone;
    if (entry.date === todayIn(zone, at)) return entry.key;
  }
  return null;
}

/** How long the ship lies in port, as far as the stored times say. */
export interface PortStay {
  /** `HH:mm` on the port's clock, or null where no arrival is recorded. */
  arrive: string | null;
  depart: string | null;
  /**
   * Minutes between the two INSTANTS — null unless both are real instants in
   * the port's zone. Two wall clocks without a zone cannot be subtracted
   * honestly (a clock change between them, or no zone at all), so the card
   * then shows the times and no duration.
   */
  minutes: number | null;
}

const isInstant = (value: TimeValue | null): value is TimeValue =>
  value !== null && value.zone !== null && value.precision === "minute";

export function portStay(stop: CruiseStop): PortStay {
  const arrival = cruiseStopArrival(stop);
  const departure = cruiseStopDeparture(stop);
  const minutes =
    isInstant(arrival) && isInstant(departure)
      ? Math.round((Date.parse(departure.utc) - Date.parse(arrival.utc)) / 60_000)
      : null;
  return {
    arrive: arrival ? clockOf(arrival) : null,
    depart: departure ? clockOf(departure) : null,
    minutes: minutes !== null && minutes > 0 ? minutes : null,
  };
}

/**
 * The originals that belong to a day. Documents are filed with the whole
 * cruise, not with a port call — the only per-day signal they carry is the
 * date printed on them (`issuedOn`), which for an excursion ticket or a
 * shore pass is that day. Matched on that and nothing else; everything else
 * stays in the cruise's own document list.
 */
export function documentsOfDay(
  documents: readonly TravelDocument[],
  day: string | null
): TravelDocument[] {
  if (!day) return [];
  return documents.filter((d) => d.issuedOn?.slice(0, 10) === day);
}
