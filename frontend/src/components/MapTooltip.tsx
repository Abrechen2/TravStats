import { calculateDistance, calculateFlightDuration } from "../lib/geo";
import { useLocale } from "../hooks/useLocale";
import { formatDuration } from "../lib/formatters";
import { FlagImg } from "../lib/countryFlag";
import { TooltipContainer } from "./TooltipContainer";
import type { Flight } from "../types";

interface MapTooltipProps {
  flight: Flight;
  screenX: number;
  screenY: number;
  onEdit: (flight: Flight) => void;
  onClose: () => void;
  /** ISO country codes of the departure / arrival airports, from the
   *  enriched /geo feature — drive the endpoint flags. Optional so the
   *  tooltip still works when they weren't resolved. */
  depCountry?: string | null;
  arrCountry?: string | null;
}

export function MapTooltip({
  flight,
  screenX,
  screenY,
  onEdit,
  onClose,
  depCountry,
  arrCountry,
}: MapTooltipProps): JSX.Element {
  const locale = useLocale();

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
  if (distanceKm !== null) statParts.push(`${distanceKm.toLocaleString(locale)} km`);
  if (durationMin !== null) statParts.push(formatDuration(durationMin));
  if (flight.seatClass) statParts.push(flight.seatClass.replace("_", " "));
  if (flight.co2Kg != null)
    statParts.push(`CO₂: ${Math.round(flight.co2Kg).toLocaleString(locale)} kg`);

  const departureDate = flight.departureTime
    ? new Date(flight.departureTime).toLocaleDateString(locale)
    : null;

  const metaParts: string[] = [
    flight.airline ?? null,
    flight.flightNumber ?? null,
    flight.aircraft ?? null,
    departureDate,
  ].filter((x): x is string => x !== null && x !== undefined);

  return (
    <TooltipContainer screenX={screenX} screenY={screenY} minWidth="220px">
      <div className="flex items-center gap-1.5 font-mono font-bold text-sm" style={{ color: "var(--accent)" }}>
        <FlagImg country={depCountry} height={14} />
        <span>{flight.depIata ?? flight.depIcao ?? "?"}</span>
        <span className="opacity-60">→</span>
        <FlagImg country={arrCountry} height={14} />
        <span>{flight.arrIata ?? flight.arrIcao ?? "?"}</span>
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
          className="text-xs px-2 py-1 rounded-sm transition-colors"
          style={{ background: "var(--accent)", color: "white" }}
        >
          ✏️ Bearbeiten
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded-sm transition-colors"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
          }}
        >
          ✕
        </button>
      </div>
    </TooltipContainer>
  );
}
