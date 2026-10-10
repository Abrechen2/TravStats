import type { useDisplayFormat } from "../../lib/displayFormat";
import type { PhotoJourney } from "../../types/photoJourney";

/**
 * When, on the clock of the place where the photos were taken (ADR 0002 D4).
 * A visit finding is an afternoon, so it shows the day and the two clocks;
 * the other kinds show their days. The instants are used only against a
 * server that does not send the local readings yet.
 */
export function photoJourneySpan(
  journey: PhotoJourney,
  format: ReturnType<typeof useDisplayFormat>
): string {
  if (journey.kind === "visit" && journey.startLocal && journey.endLocal) {
    const clocks = `${format.localClock(journey.startLocal)} – ${format.localClock(journey.endLocal)}`;
    return `${format.localDate(journey.startLocal)} · ${clocks}`;
  }
  const first = journey.startDay ?? journey.startDate;
  const last = journey.endDay ?? journey.endDate;
  return first.slice(0, 10) === last.slice(0, 10)
    ? format.date(first)
    : `${format.date(first)} – ${format.date(last)}`;
}

/**
 * How long the photographs span, in whole minutes, from the two local wall
 * clocks (same place, same zone — so their difference is the elapsed time
 * outside a DST jump, which a stop of minutes does not straddle). Null when
 * the server sent no local reading.
 */
export function photoJourneyDwellMinutes(journey: PhotoJourney): number | null {
  if (!journey.startLocal || !journey.endLocal) return null;
  const start = Date.parse(`${journey.startLocal}Z`);
  const end = Date.parse(`${journey.endLocal}Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}
