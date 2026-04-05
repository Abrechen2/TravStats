import { useEffect, useState } from "react";
import { calculateDistance, calculateFlightDuration } from "../lib/geo";
import type { Flight } from "../types";

interface MapTooltipProps {
  flight: Flight;
  screenX: number;
  screenY: number;
  onEdit: (flight: Flight) => void;
  onClose: () => void;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

export function MapTooltip({
  flight,
  screenX,
  screenY,
  onEdit,
  onClose,
}: MapTooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const distanceKm =
    flight.routeDistance != null
      ? Math.round(flight.routeDistance)
      : flight.depLat != null &&
          flight.depLon != null &&
          flight.arrLat != null &&
          flight.arrLon != null
        ? Math.round(calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon))
        : null;

  const durationMin =
    flight.departureTime && flight.arrivalTime
      ? calculateFlightDuration(flight.departureTime, flight.arrivalTime)
      : null;

  const statParts: string[] = [];
  if (distanceKm !== null) statParts.push(`${distanceKm.toLocaleString("de-DE")} km`);
  if (durationMin !== null) statParts.push(formatDuration(durationMin));
  if (flight.seatClass) statParts.push(flight.seatClass.replace("_", " "));
  if (flight.co2Kg != null)
    statParts.push(`CO₂: ${Math.round(flight.co2Kg).toLocaleString("de-DE")} kg`);

  const departureDate = flight.departureTime
    ? new Date(flight.departureTime).toLocaleDateString("de-DE")
    : null;

  const metaParts: string[] = [
    flight.airline ?? null,
    flight.flightNumber ?? null,
    flight.aircraft ?? null,
    departureDate,
  ].filter((x): x is string => x !== null && x !== undefined);

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        transform: "translate(-50%, -100%) translateY(-12px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease",
        zIndex: 100,
        pointerEvents: "auto",
        background: "rgba(15,23,42,0.95)",
        border: "1px solid var(--accent)",
        borderRadius: "8px",
        padding: "0.75rem 1rem",
        minWidth: "220px",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div className="font-mono font-bold text-sm" style={{ color: "var(--accent)" }}>
        {flight.depIata ?? flight.depIcao ?? "?"} → {flight.arrIata ?? flight.arrIcao ?? "?"}
      </div>
      {metaParts.length > 0 && (
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {metaParts.join(" · ")}
        </div>
      )}
      {statParts.length > 0 && (
        <div className="text-xs mt-1.5" style={{ color: "var(--text-secondary)" }}>
          {statParts.join(" · ")}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => onEdit(flight)}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ background: "var(--accent)", color: "white" }}
        >
          ✏️ Bearbeiten
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
