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
 * owner, 2026-10-01: one continuous band, not two entries). The pickup is the
 * rental's one card — provider, station, how many rental days follow — and
 * the band (`RentalBand` in `components/Trips/timelineTransit.tsx`) runs from
 * it past everything in between. The return is where the band ends: a single
 * line with its station and time on that station's clock, not a second card.
 */
export function RentalTripCard({ rental, end, when }: Props): JSX.Element {
  const { t } = useTranslation(["rental"]);
  if (end === "return") {
    return (
      <div className="t-caption py-1" data-testid="rental-trip-card-return">
        {formatTimelineDate(when)} ·{" "}
        <Link to={`/rentals/${rental.id}`} className="hover:underline">
          {t("rental:timeline.return", {
            provider: rental.provider,
            station: rental.returnStationName,
          })}
        </Link>
      </div>
    );
  }
  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ borderColor: "var(--ts-border)", borderLeft: "6px solid var(--ts-domain-rental)" }}
      data-testid="rental-trip-card-pickup"
    >
      <div className="t-caption">{formatTimelineDate(when)}</div>
      <Link to={`/rentals/${rental.id}`} className="font-semibold hover:underline">
        {t("rental:timeline.pickup", {
          provider: rental.provider,
          station: rental.pickupStationName,
        })}
      </Link>
      <div className="t-caption">{t("rental:timeline.span", { count: rentalDays(rental) })}</div>
    </div>
  );
}
