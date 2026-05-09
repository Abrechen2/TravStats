import { useState } from "react";
import type { Flight } from "../../types";
import { QuickActions } from "./QuickActions";
import { InlineStats } from "./InlineStats";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import { useTranslation } from "../../hooks/useTranslation";
import SpecialTypeBadge from "../specialFlights/SpecialTypeBadge";
import type { SpecialType } from "../specialFlights/specialTypeMeta";

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
  const selectedIds = useFlightSelectionStore((s) => s.selectedIds);
  const setSelection = useFlightSelectionStore((s) => s.setSelection);
  const { i18n } = useTranslation(["common"]);
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
            <div className="font-mono text-sm font-semibold truncate flex items-center gap-1.5">
              <span>
                {flight.depIata ?? flight.depIcao ?? "?"} →{" "}
                {flight.arrIata ?? flight.arrIcao ?? "?"}
              </span>
              {flight.status === "scheduled" && (
                <span
                  className="text-[9px] font-sans font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: "rgba(100,200,220,0.2)", color: "rgb(100,200,220)" }}
                >
                  geplant
                </span>
              )}
              {flight.status === "cancelled" && (
                <span
                  className="text-[9px] font-sans font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: "rgba(239,68,68,0.2)", color: "rgb(239,68,68)" }}
                >
                  storniert
                </span>
              )}
              {flight.status === "historical" && (
                <span
                  className="text-[9px] font-sans font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: "rgba(150,150,150,0.2)", color: "rgb(160,160,160)" }}
                >
                  historisch
                </span>
              )}
              {flight.status === "duplicated" && (
                <span
                  className="text-[9px] font-sans font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: "rgba(251,191,36,0.2)", color: "rgb(251,191,36)" }}
                >
                  dupliziert
                </span>
              )}
              {flight.specialType && (
                <SpecialTypeBadge type={flight.specialType as SpecialType} />
              )}
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {flight.departureTime
                ? new Date(flight.departureTime).toLocaleDateString(i18n.language, {
                    day: "2-digit",
                    month: "2-digit",
                  })
                : "—"}
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
