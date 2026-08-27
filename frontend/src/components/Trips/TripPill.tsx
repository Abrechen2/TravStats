import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";

/** The trip as the pill needs it — what the API includes next to a cruise. */
export interface TripPillTrip {
  id: string;
  name: string;
  color: string;
}

interface Props {
  /** Null renders the muted placeholder instead of a link. */
  trip?: TripPillTrip | null;
}

/**
 * The "belongs to this trip" badge: the trip's name in the trip's own colour,
 * linking to its page. Shared because it sits inside CLICKABLE containers (a
 * cruise table row, the detail header), which is the whole reason it stops
 * its own click from bubbling — otherwise opening the trip would also trigger
 * the row behind it.
 */
export default function TripPill({ trip }: Props): JSX.Element {
  const { t } = useTranslation(["dashboard"]);

  if (!trip) {
    return <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>—</span>;
  }

  const label = trip.name.trim() || t("dashboard:trips.unnamed");

  return (
    <Link
      to={`/trips/${trip.id}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-all hover:brightness-110"
      style={{
        background: `${trip.color}18`,
        borderColor: `${trip.color}44`,
        color: trip.color,
      }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: trip.color }} />
      {label}
    </Link>
  );
}
