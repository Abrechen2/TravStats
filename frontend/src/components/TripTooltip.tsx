import { calculateDistance, calculateFlightDuration } from "../lib/geo";
import { useLocale } from "../hooks/useLocale";
import { formatDuration } from "../lib/formatters";
import { TooltipContainer } from "./TooltipContainer";
import type { Flight } from "../types";

interface TripTooltipProps {
  flights: Flight[];
  screenX: number;
  screenY: number;
  onClose: () => void;
}

function buildRouteChain(sorted: Flight[]): string {
  const iatas: string[] = [];
  for (const f of sorted) {
    const dep = f.depIata ?? "?";
    const arr = f.arrIata ?? "?";
    if (iatas.length === 0 || iatas[iatas.length - 1] !== dep) iatas.push(dep);
    iatas.push(arr);
  }
  return iatas.join(" → ");
}

function formatDateRange(sorted: Flight[], locale: string): string {
  const times = sorted
    .map((f) => (f.departureTime ? new Date(f.departureTime).getTime() : NaN))
    .filter((t) => !isNaN(t));
  if (times.length === 0) return "";
  const d1 = new Date(Math.min(...times));
  const d2 = new Date(Math.max(...times));
  const opts = (year?: boolean): Intl.DateTimeFormatOptions => ({
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
  });
  if (d1.getTime() === d2.getTime()) return d1.toLocaleDateString(locale, opts(true));
  if (d1.getFullYear() === d2.getFullYear()) {
    if (d1.getMonth() === d2.getMonth()) {
      return `${d1.getDate()}. – ${d2.toLocaleDateString(locale, opts(true))}`;
    }
    return `${d1.toLocaleDateString(locale, opts())} – ${d2.toLocaleDateString(locale, opts(true))}`;
  }
  return `${d1.toLocaleDateString(locale, opts(true))} – ${d2.toLocaleDateString(locale, opts(true))}`;
}

export function TripTooltip({ flights, screenX, screenY, onClose }: TripTooltipProps): JSX.Element {
  const locale = useLocale();

  const sorted = [...flights].sort(
    (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
  );

  const tripName = sorted[0]?.trip?.name;
  const tripColor = sorted[0]?.trip?.color ?? "#f59e0b";
  const route = buildRouteChain(sorted);
  const dateRange = formatDateRange(sorted, locale);

  const totalDurationMin = sorted.reduce((sum, f) => {
    if (!f.departureTime || !f.arrivalTime) return sum;
    return sum + calculateFlightDuration(f.departureTime, f.arrivalTime);
  }, 0);

  const totalDistanceKm = sorted.reduce((sum, f) => {
    if (f.routeDistance != null) return sum + f.routeDistance;
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      return sum + calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    }
    return sum;
  }, 0);

  const airlines = [...new Set(sorted.map((f) => f.airline).filter(Boolean))] as string[];
  const aircraft = [...new Set(sorted.map((f) => f.aircraft).filter(Boolean))] as string[];

  const statsRow2: string[] = [];
  if (totalDurationMin > 0) statsRow2.push(formatDuration(totalDurationMin));
  if (totalDistanceKm > 0)
    statsRow2.push(`${Math.round(totalDistanceKm).toLocaleString(locale)} km`);

  return (
    <TooltipContainer
      screenX={screenX}
      screenY={screenY}
      borderColor={tripColor}
      minWidth="260px"
      maxWidth="340px"
    >
      {/* Trip name */}
      {tripName && (
        <div
          className="font-bold text-sm mb-1"
          style={{ color: tripColor, letterSpacing: "0.02em" }}
        >
          {tripName}
        </div>
      )}

      {/* Route chain */}
      <div className="font-mono font-bold text-sm" style={{ color: "var(--text-primary)" }}>
        {route}
      </div>

      {/* Leg count + dates */}
      <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        {sorted.length} {sorted.length === 1 ? "Flug" : "Flüge"}
        {dateRange ? ` · ${dateRange}` : ""}
      </div>

      {/* Duration + distance */}
      {statsRow2.length > 0 && (
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {statsRow2.join(" · ")}
        </div>
      )}

      {/* Airlines */}
      {airlines.length > 0 && (
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {airlines.join(" · ")}
          {aircraft.length > 0 && ` · ${aircraft.slice(0, 2).join(", ")}`}
        </div>
      )}

      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
        >
          ✕
        </button>
      </div>
    </TooltipContainer>
  );
}
