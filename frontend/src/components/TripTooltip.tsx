import { calculateDistance } from "../lib/geo";
import { useLocale } from "../hooks/useLocale";
import { formatDuration } from "../lib/formatters";
import { useTranslation } from "../hooks/useTranslation";
import { TooltipContainer } from "./TooltipContainer";
import type { Flight } from "../types";

interface TripTooltipProps {
  flights: Flight[];
  screenX: number;
  screenY: number;
  onClose: () => void;
  onShowDetails?: () => void;
}

function getRouteEndpoints(sorted: Flight[]): {
  depName: string;
  depIata: string;
  arrName: string;
  arrIata: string;
} {
  const first = sorted[0];
  if (!first) return { depName: "?", depIata: "?", arrName: "?", arrIata: "?" };

  const depIata = first.depIata ?? "?";
  const depName = first.depName ?? depIata;

  // Find the first flight whose arrival differs from the departure airport
  // (handles round-trip routes like MUC↔HEL where last.arr === first.dep)
  const otherLeg = sorted.find((f) => f.arrIata !== depIata) ?? first;
  const arrIata = otherLeg.arrIata ?? "?";
  const arrName = otherLeg.arrName ?? arrIata;

  return { depName, depIata, arrName, arrIata };
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

export function TripTooltip({
  flights,
  screenX,
  screenY,
  onClose,
  onShowDetails,
}: TripTooltipProps): JSX.Element {
  const locale = useLocale();
  const { t } = useTranslation(["dashboard"]);

  const sorted = [...flights].sort(
    (a, b) =>
      (a.departureTime ? new Date(a.departureTime).getTime() : 0) -
      (b.departureTime ? new Date(b.departureTime).getTime() : 0)
  );

  const dateRange = formatDateRange(sorted, locale);

  const totalDistanceKm = sorted.reduce((sum, f) => {
    if (f.routeDistance != null) return sum + f.routeDistance;
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      return sum + calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    }
    return sum;
  }, 0);

  const avgDurationMin =
    sorted.reduce((sum, f) => sum + (f.durationMinutes ?? 0), 0) / (sorted.length || 1);

  const airlines = [...new Set(sorted.map((f) => f.airline).filter(Boolean))] as string[];
  const seatClasses = [...new Set(sorted.map((f) => f.seatClass).filter(Boolean))] as string[];

  const { depName, depIata, arrName, arrIata } = getRouteEndpoints(sorted);

  return (
    <TooltipContainer
      screenX={screenX}
      screenY={screenY}
      borderColor="var(--accent)"
      minWidth="280px"
      maxWidth="380px"
    >
      <div>
        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
          {depName} ({depIata})
        </div>
        <div className="text-xs my-0.5" style={{ color: "var(--text-muted)" }}>
          →
        </div>
        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
          {arrName} ({arrIata})
        </div>
      </div>

      <div className="my-2" style={{ borderTop: "1px solid var(--color-border)" }} />

      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {sorted.length} {sorted.length === 1 ? t("dashboard:flight") : t("dashboard:flights")}
        {totalDistanceKm > 0 && ` · ${Math.round(totalDistanceKm).toLocaleString(locale)} km`}
        {avgDurationMin > 0 && ` · Ø ${formatDuration(Math.round(avgDurationMin))}`}
      </div>

      {dateRange && (
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {dateRange}
        </div>
      )}

      {(airlines.length > 0 || seatClasses.length > 0) && (
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {airlines.join(", ")}
          {seatClasses.length > 0 && ` · ${seatClasses.map((c) => c.replace("_", " ")).join(", ")}`}
        </div>
      )}

      <div className="flex justify-between items-center mt-3">
        {onShowDetails ? (
          <button
            type="button"
            onClick={onShowDetails}
            className="text-xs px-3 py-1.5 rounded-sm font-medium transition-colors"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {t("dashboard:routeDetails")} →
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded-sm transition-colors"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
        >
          ✕
        </button>
      </div>
    </TooltipContainer>
  );
}
