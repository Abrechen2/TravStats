import type { JSX } from "react";
import { Link } from "react-router-dom";
import type { Trip } from "../../types";

/**
 * The trip column of one flight row: a coloured badge linking to the trip
 * (`/trips/:id`), or a faint dash when the flight belongs to none.
 */
export default function TripBadgeCell({ trip }: { trip: Trip | undefined }): JSX.Element {
  if (!trip) {
    return <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>—</span>;
  }
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border transition-all hover:brightness-110"
      style={{
        background: `${trip.color}18`,
        borderColor: `${trip.color}44`,
        color: trip.color,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: trip.color }} />
      {trip.name}
    </Link>
  );
}
