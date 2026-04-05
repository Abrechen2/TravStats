import { useState } from "react";
import type { Flight } from "../../types";
import { QuickActions } from "./QuickActions";
import { InlineStats } from "./InlineStats";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";

interface FlightEntryProps {
  flight: Flight;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
  indented?: boolean;
}

export function FlightEntry({
  flight,
  onEdit,
  onDuplicate,
  onDelete,
  indented = false,
}: FlightEntryProps): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const { selectedIds, setSelection } = useFlightSelectionStore();
  const isSelected = selectedIds.includes(flight.id);

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="transition-colors border-b flex items-center justify-between gap-2"
        style={{
          borderColor: "var(--color-border)",
          background: isSelected || hovered ? "var(--bg-elevated)" : "transparent",
        }}
      >
        <button
          type="button"
          onClick={() => setSelection([flight])}
          className="w-full text-left py-3 flex items-center justify-between gap-2"
          style={{
            paddingLeft: indented ? "2rem" : "1rem",
            paddingRight: "0.75rem",
            borderTop: "none",
            borderRight: "none",
            borderBottom: "none",
            borderLeft: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
            background: "transparent",
          }}
        >
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold truncate">
              {flight.depIata ?? flight.depIcao ?? "?"} → {flight.arrIata ?? flight.arrIcao ?? "?"}
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {flight.departureTime
                ? new Date(flight.departureTime).toLocaleDateString("de-DE")
                : "Unbekannt"}
              {flight.flightNumber ? ` · ${flight.flightNumber}` : ""}
            </div>
          </div>
        </button>
        {hovered && (
          <QuickActions
            flight={flight}
            onEdit={onEdit}
            onMapFocus={() => setSelection([flight])}
            onStatsToggle={() => setStatsOpen((s) => !s)}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        )}
      </div>
      {statsOpen && <InlineStats flight={flight} />}
    </div>
  );
}
