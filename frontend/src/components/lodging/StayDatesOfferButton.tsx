import type { JSX } from "react";

import { useDisplayFormat } from "../../lib/displayFormat";
import type { StayDatesOffer } from "../../hooks/useStayDatesFromTrip";

/**
 * "Take the trip's dates" under the stay's date fields — the offer
 * `useStayDatesFromTrip` makes when one of them is still empty. It names the
 * days it would write, so the click is not a leap of faith.
 */
export function StayDatesOfferButton({
  offer,
  onAccept,
  t,
}: {
  offer: StayDatesOffer;
  onAccept: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}): JSX.Element {
  const format = useDisplayFormat();
  // Calendar days: formatted in UTC so no zone moves them to a neighbour.
  const day = (d: string): string => format.date(`${d}T00:00:00.000Z`, { timeZone: "UTC" });
  const label =
    offer.checkIn && offer.checkOut
      ? t("lodging:stayEditor.tripDates.both", {
          from: day(offer.checkIn),
          to: day(offer.checkOut),
        })
      : offer.checkIn
        ? t("lodging:stayEditor.tripDates.checkIn", { date: day(offer.checkIn) })
        : t("lodging:stayEditor.tripDates.checkOut", { date: day(offer.checkOut ?? "") });

  return (
    <button
      type="button"
      data-testid="stay-trip-dates-offer"
      onClick={onAccept}
      className="mt-2 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent)"
    >
      {label}
    </button>
  );
}
