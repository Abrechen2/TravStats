import Chip from "../ui/Chip";
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
    <Link to={`/trips/${trip.id}`} className="inline-flex">
      <Chip size="sm" color={trip.color}>
        <span
          className="w-1.5 h-1.5 shrink-0"
          style={{ background: trip.color, borderRadius: "50%" }}
        />
        {trip.name}
      </Chip>
    </Link>
  );
}
