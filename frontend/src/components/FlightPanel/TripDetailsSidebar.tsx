import { useMemo } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import type { Flight } from "../../types";

interface TripDetailsSidebarProps {
  flights: Flight[];
  onBack: () => void;
}

export function TripDetailsSidebar({ flights, onBack }: TripDetailsSidebarProps): JSX.Element {
  const locale = useLocale();
  const { t } = useTranslation(["dashboard", "common"]);

  const sorted = useMemo(
    () =>
      [...flights].sort(
        (a, b) =>
          (a.departureTime ? new Date(a.departureTime).getTime() : 0) -
          (b.departureTime ? new Date(b.departureTime).getTime() : 0)
      ),
    [flights]
  );

  const tripName = sorted[0]?.trip?.name ?? t("dashboard:trips.unnamed");
  const tripColor = sorted[0]?.trip?.color ?? "#f59e0b";

  const totalDistanceKm = useMemo(
    () =>
      sorted.reduce((sum, f) => {
        if (f.routeDistance != null) return sum + f.routeDistance;
        if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
          return sum + calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
        }
        return sum;
      }, 0),
    [sorted]
  );

  return (
    <div className="flex flex-col h-full">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0"
        style={{ color: "var(--accent)", borderBottom: "1px solid var(--color-border)" }}
      >
        ← {t("common:buttons.back")}
      </button>

      <div
        className="px-3 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="font-bold text-sm" style={{ color: tripColor }}>
          {tripName}
        </div>
        <div className="mt-2 text-xs space-y-0.5" style={{ color: "var(--text-muted)" }}>
          <div>
            {sorted.length} {sorted.length === 1 ? t("dashboard:flight") : t("dashboard:flights")}
            {totalDistanceKm > 0 && ` · ${Math.round(totalDistanceKm).toLocaleString(locale)} km`}
          </div>
        </div>
      </div>

      <div
        className="px-3 py-2 text-xs font-medium uppercase tracking-wider flex-shrink-0"
        style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--color-border)" }}
      >
        Legs
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.map((f, i) => {
          const depTime = f.departureTime
            ? new Date(f.departureTime).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          const arrTime = f.arrivalTime
            ? new Date(f.arrivalTime).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          const depDate = f.departureTime
            ? new Date(f.departureTime).toLocaleDateString(locale, {
                day: "2-digit",
                month: "short",
              })
            : "";

          return (
            <div
              key={f.id}
              className="px-3 py-2.5"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: tripColor, color: "white" }}
                >
                  {i + 1}
                </span>
                <span
                  className="font-mono font-medium text-xs"
                  style={{ color: "var(--text-primary)" }}
                >
                  {f.flightNumber ?? "—"}
                </span>
                <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                  {f.depIata}→{f.arrIata}
                </span>
                <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                  {f.seatNumber ?? ""}
                </span>
              </div>
              <div className="ml-7 mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {depDate} · {depTime}→{arrTime}
                {f.airline && ` · ${f.airline}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
