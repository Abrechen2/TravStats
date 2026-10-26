import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravTrackVisible } from "../../hooks/useTravTrackVisible";
import type { TimeValue } from "../../shared/time";

/**
 * "Höhenprofil ansehen" on a flight's page (owner 2026-10-26: the profile was
 * hard to find): opens the Track map on the day of departure — the departure
 * airport's own day, read off the flight's local clock — with this flight's
 * panel open. Only where TravTrack is offered to this account.
 */
export default function FlightProfileLink({
  flightId,
  departure,
}: {
  flightId: string;
  departure: TimeValue | null;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const visible = useTravTrackVisible();
  if (!visible || !departure) return null;
  const day = departure.local.slice(0, 10);
  return (
    <Link
      to={`/track/${day}?flight=${encodeURIComponent(flightId)}`}
      className="inline-flex items-center underline"
      style={{ minHeight: "var(--ts-size-touch-min)", color: "var(--ts-accent)", fontWeight: 600 }}
      data-testid="flight-profile-link"
    >
      {t("track:flight.openProfile")}
    </Link>
  );
}
