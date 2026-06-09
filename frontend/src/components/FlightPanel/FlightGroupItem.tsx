import { useMemo } from "react";
import type { Flight } from "../../types";
import { FlightEntry } from "./FlightEntry";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import { calculateDistance } from "../../lib/geo";

interface FlightGroupItemProps {
  flights: Flight[];
  label: string;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
}

export function FlightGroupItem({
  flights,
  label,
  onEdit,
  onDuplicate,
  onDelete,
}: FlightGroupItemProps): JSX.Element {
  const setSelection = useFlightSelectionStore((s) => s.setSelection);

  const totalDistanceKm = useMemo(
    () =>
      Math.round(
        flights.reduce((sum, f) => {
          if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
            return sum + calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
          }
          return sum;
        }, 0)
      ),
    [flights]
  );

  return (
    <div
      style={{
        borderLeft: "2px solid var(--accent)",
        marginLeft: "0.5rem",
      }}
    >
      {flights.map((f) => (
        <FlightEntry
          key={f.id}
          flight={f}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          indented
        />
      ))}
      <button
        type="button"
        onClick={() => setSelection(flights)}
        className="w-full text-left px-3 py-1.5 text-xs transition-colors"
        style={{
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--color-border)",
          color: "var(--text-muted)",
        }}
      >
        {label} · {flights.length} Legs · {totalDistanceKm.toLocaleString("de-DE")} km
      </button>
    </div>
  );
}
