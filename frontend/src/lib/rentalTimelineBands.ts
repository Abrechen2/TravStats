import type { TimelineEvent } from "./tripTimelineEvents";

/**
 * A rental on a trip's timeline is one stretch, not two moments (owner,
 * 2026-10-01): a band in the rental colour runs from the pickup entry down to
 * the return entry, past everything that happened in between. This works out,
 * per timeline entry, which bands pass it and how — pure, so the drawing in
 * `components/Trips/timelineTransit.tsx` only paints what it is told.
 *
 * Overlapping rentals get their own lane, the first free one from the left,
 * so two cars on one trip read as two bands rather than one.
 */

export type RentalBandPart = "start" | "through" | "end";

export interface RentalBandSegment {
  rentalId: string;
  lane: number;
  part: RentalBandPart;
}

export function rentalBandSegments(events: readonly TimelineEvent[]): RentalBandSegment[][] {
  const lanes: Array<string | null> = [];
  return events.map((ev) => {
    const segments: RentalBandSegment[] = lanes.flatMap((rentalId, lane) =>
      rentalId === null ? [] : [{ rentalId, lane, part: "through" as const }]
    );
    if (ev.kind === "rental-pickup") {
      const free = lanes.indexOf(null);
      const lane = free === -1 ? lanes.length : free;
      lanes[lane] = ev.rental.id;
      segments.push({ rentalId: ev.rental.id, lane, part: "start" });
    } else if (ev.kind === "rental-return") {
      const lane = lanes.indexOf(ev.rental.id);
      // A return whose pickup is not on this timeline draws no band.
      if (lane !== -1) {
        lanes[lane] = null;
        const at = segments.findIndex((s) => s.rentalId === ev.rental.id);
        segments[at] = { rentalId: ev.rental.id, lane, part: "end" };
      }
    }
    return segments.sort((a, b) => a.lane - b.lane);
  });
}
