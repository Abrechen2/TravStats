import { useMemo } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import { sortFlightsByLegOrder } from "../../lib/flightLegSort";
import type { Flight } from "../../types";

interface TripDetailsSidebarProps {
  flights: Flight[];
  onBack: () => void;
  onEditTrip?: () => void;
  onDeleteTrip?: () => void;
}

export function TripDetailsSidebar({
  flights,
  onBack,
  onEditTrip,
  onDeleteTrip,
}: TripDetailsSidebarProps): JSX.Element {
  const locale = useLocale();
  const { t } = useTranslation(["dashboard", "common", "trips"]);

  const sorted = useMemo(() => sortFlightsByLegOrder(flights), [flights]);

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
        <div className="flex items-start justify-between gap-2">
          <div className="font-bold text-sm flex-1 min-w-0 truncate" style={{ color: tripColor }}>
            {tripName}
          </div>
          {(onEditTrip || onDeleteTrip) && sorted[0]?.trip && (
            <div className="flex items-center gap-1 shrink-0">
              {onEditTrip && (
                <button
                  type="button"
                  onClick={onEditTrip}
                  aria-label={t("trips:editTrip")}
                  title={t("trips:editTrip")}
                  className="p-1 rounded transition-colors hover:bg-[var(--bg-muted)]"
                  style={{ color: "var(--text-muted)" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
              {onDeleteTrip && (
                <button
                  type="button"
                  onClick={onDeleteTrip}
                  aria-label={t("trips:deleteTrip")}
                  title={t("trips:deleteTrip")}
                  className="p-1 rounded transition-colors hover:bg-[var(--bg-muted)]"
                  style={{ color: "var(--text-muted)" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              )}
            </div>
          )}
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
          // Hide rendered time when the row is flagged DATE_ONLY — the
          // 12:00 placeholder is meaningless and would mislead the user.
          const depDateOnly = f.depTimeSemantics === "DATE_ONLY";
          const arrDateOnly = f.arrTimeSemantics === "DATE_ONLY";
          const depTime = f.departureTime && !depDateOnly
            ? new Date(f.departureTime).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          const arrTime = f.arrivalTime && !arrDateOnly
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
