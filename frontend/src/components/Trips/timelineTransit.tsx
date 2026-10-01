import type { JSX } from "react";
import { RailTripCard } from "../rail/RailTripCard";
import { RentalTripCard } from "../rental/RentalTripCard";
import { formatTimelineDate } from "../../lib/tripTimeline";
import type { TimelineEvent } from "../../lib/tripTimelineEvents";

/**
 * The card of a train ride or a rental end on the trip timeline — outside
 * `pages/TripDetailPage.tsx`, which the file-size ratchet freezes at its size.
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
