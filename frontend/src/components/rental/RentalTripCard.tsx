import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { formatTimelineDate } from "../../lib/tripTimeline";
import type { TimeValue } from "../../shared/time";
import type { TripRental } from "../../types/rental";
import { rentalDays } from "../../shared/rentalCounting";

interface Props {
  rental: TripRental;
  end: "pickup" | "return";
  when: TimeValue;
}

/**
 * A rental on a trip's timeline (spec 2026-10-01-rental-domain-design §6;
 * concept page: "a rental lasts like a stay"). Its two ends sit on their days
 * — pickup and return, each on its station's clock — and the card carries the
 * domain's band at its edge with the span between them, so the rental reads
 * as one stretch across those days rather than two loose moments.
 */
export function RentalTripCard({ rental, end, when }: Props): JSX.Element {
  const { t } = useTranslation(["rental"]);
  const station = end === "pickup" ? rental.pickupStationName : rental.returnStationName;
  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ borderColor: "var(--ts-border)", borderLeft: "6px solid var(--ts-domain-rental)" }}
      data-testid={`rental-trip-card-${end}`}
    >
      <div className="t-caption">{formatTimelineDate(when)}</div>
      <Link to={`/rentals/${rental.id}`} className="font-semibold hover:underline">
        {t(end === "pickup" ? "rental:timeline.pickup" : "rental:timeline.return", {
          provider: rental.provider,
          station,
        })}
      </Link>
      {end === "pickup" ? (
        <div className="t-caption">{t("rental:timeline.span", { count: rentalDays(rental) })}</div>
      ) : null}
    </div>
  );
}
