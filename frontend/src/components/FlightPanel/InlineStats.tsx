import { calculateDistance, calculateFlightDuration } from "../../lib/geo";
import { formatDistance } from "../../lib/units";
import { useSettingsStore } from "../../store/settingsStore";
import { useTranslation } from "../../hooks/useTranslation";
import type { Flight } from "../../types";

interface InlineStatsProps {
  flight: Flight;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

export function InlineStats({ flight }: InlineStatsProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats"]);
  const distanceUnit = useSettingsStore((state) => state.units.distanceUnit);
  const lang = i18n.language;

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

  const stats: string[] = [];
  if (distanceKm !== null) stats.push(formatDistance(distanceKm, distanceUnit, t, lang));
  if (durationMin !== null) stats.push(formatDuration(durationMin));
  if (flight.seatClass) stats.push(flight.seatClass.replace("_", " "));
  if (flight.co2Kg != null)
    stats.push(
      `CO₂: ${Math.round(flight.co2Kg).toLocaleString(lang, { maximumFractionDigits: 0 })} kg`
    );
  if (flight.aircraft) stats.push(flight.aircraft);

  return (
    <div
      className="px-4 py-2 text-xs"
      style={{
        background: "var(--bg-elevated)",
        borderBottom: "1px solid var(--color-border)",
        color: "var(--text-muted)",
      }}
    >
      {stats.join(" · ")}
    </div>
  );
}
