import { useMemo } from "react";
import type { JSX } from "react";
import { RailTripCard } from "../rail/RailTripCard";
import { RentalTripCard } from "../rental/RentalTripCard";
import { formatTimelineDate } from "../../lib/tripTimeline";
import type { TimelineEvent } from "../../lib/tripTimelineEvents";
import { rentalBandSegments, type RentalBandSegment } from "../../lib/rentalTimelineBands";

/**
 * The card of a train ride or a rental end on the trip timeline, and the
 * rental band beside the entries — outside `pages/TripDetailPage.tsx`, which
 * the file-size ratchet freezes at its size.
 */

/** A train ride or a rental end; null for every other entry. */
export function TransitCard({ ev }: { ev: TimelineEvent }): JSX.Element | null {
  if (ev.kind === "rail") {
    return (
      <RailTripCard journey={ev.journey} date={ev.date} dateLabel={formatTimelineDate(ev.when)} />
    );
  }
  if (ev.kind === "rental-pickup" || ev.kind === "rental-return") {
    return (
      <RentalTripCard
        rental={ev.rental}
        end={ev.kind === "rental-pickup" ? "pickup" : "return"}
        when={ev.when}
      />
    );
  }
  return null;
}

/** Per timeline entry, the rental bands that pass it. */
export function useRentalBands(events: readonly TimelineEvent[]): RentalBandSegment[][] {
  return useMemo(() => rentalBandSegments(events), [events]);
}

/** Left edge of lane 0, between the list's padding edge and the connector's dots. */
const BAND_LEFT = -27;
const BAND_WIDTH = 3;
const LANE_STEP = 5;
/** The gap to the next entry (`marginBottom` of a timeline item), bridged by the band. */
const ENTRY_GAP = 12;

/**
 * The band segments of one timeline entry: from its dot down at a pickup,
 * the entry's full height while a rental is out, down to its dot at a return.
 */
export function RentalBand({
  segments,
}: {
  segments: readonly RentalBandSegment[] | undefined;
}): JSX.Element | null {
  if (!segments || segments.length === 0) return null;
  return (
    <>
      {segments.map((s) => (
        <span
          key={`${s.rentalId}-${s.part}`}
          aria-hidden
          data-testid={`rental-band-${s.part}`}
          className="absolute rounded-full"
          style={{
            left: BAND_LEFT - s.lane * LANE_STEP,
            width: BAND_WIDTH,
            top: s.part === "start" ? "50%" : 0,
            bottom: s.part === "end" ? "50%" : -ENTRY_GAP,
            background: "var(--ts-domain-rental)",
          }}
        />
      ))}
    </>
  );
}
