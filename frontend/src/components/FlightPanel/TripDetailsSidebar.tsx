import { Icon } from "../ui/Icon";
import { useMemo, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import { sortFlightsByLegOrder } from "../../lib/flightLegSort";
import type { Flight } from "../../types";
import { formatDate, formatTime } from "../../lib/format";

interface TripDetailsSidebarProps {
  flights: Flight[];
  onBack: () => void;
  onEditTrip?: () => void;
  onDeleteTrip?: () => void;
  onEditFlight?: (flight: Flight) => void;
  onDuplicateFlight?: (flight: Flight) => void;
  /**
   * Removes the flight from the current trip (unlinks tripId/bookingId).
   * Does NOT delete the flight itself — that lives elsewhere in the UI.
   */
  onRemoveFlightFromTrip?: (flightId: string) => void;
}

export function TripDetailsSidebar({
  flights,
  onBack,
  onEditTrip,
  onDeleteTrip,
  onEditFlight,
  onDuplicateFlight,
  onRemoveFlightFromTrip,
}: TripDetailsSidebarProps): JSX.Element {
  const locale = useLocale();
  const { t } = useTranslation(["dashboard", "common", "trips"]);

  const sorted = useMemo(() => sortFlightsByLegOrder(flights), [flights]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hasLegActions = Boolean(onEditFlight || onDuplicateFlight || onRemoveFlightFromTrip);

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
        className="flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors shrink-0"
        style={{ color: "var(--accent)", borderBottom: "1px solid var(--color-border)" }}
      >
        ← {t("common:buttons.back")}
      </button>

      <div className="px-3 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
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
                  className="p-1 rounded-sm transition-colors hover:bg-(--bg-muted)"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Icon name="pencil" size={14} />
                </button>
              )}
              {onDeleteTrip && (
                <button
                  type="button"
                  onClick={onDeleteTrip}
                  aria-label={t("trips:deleteTrip")}
                  title={t("trips:deleteTrip")}
                  className="p-1 rounded-sm transition-colors hover:bg-(--bg-muted)"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Icon name="trash-2" size={14} />
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
        className="px-3 py-2 text-xs font-medium uppercase tracking-wider shrink-0"
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
          const depTime = f.departureTime && !depDateOnly ? formatTime(f.departureTime) : "";
          const arrTime = f.arrivalTime && !arrDateOnly ? formatTime(f.arrivalTime) : "";
          const depDate = f.departureTime ? formatDate(f.departureTime, { omitYear: true }) : "";

          const isHovered = hoveredId === f.id;
          return (
            <div
              key={f.id}
              onMouseEnter={() => setHoveredId(f.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="px-3 py-2.5 transition-colors"
              style={{
                borderBottom: "1px solid var(--color-border)",
                background: isHovered ? "var(--bg-elevated)" : "transparent",
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
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
                {hasLegActions && isHovered ? (
                  <div className="ml-auto flex items-center gap-0.5">
                    {onEditFlight && (
                      <button
                        type="button"
                        onClick={() => onEditFlight(f)}
                        aria-label={t("common:buttons.edit")}
                        title={t("common:buttons.edit")}
                        className="p-1 rounded-sm transition-colors hover:bg-(--bg-muted)"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Icon name="pencil" size={16} />
                      </button>
                    )}
                    {onDuplicateFlight && (
                      <button
                        type="button"
                        onClick={() => onDuplicateFlight(f)}
                        aria-label={t("common:buttons.duplicate")}
                        title={t("common:buttons.duplicate")}
                        className="p-1 rounded-sm transition-colors hover:bg-(--bg-muted)"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Icon name="copy" size={16} />
                      </button>
                    )}
                    {onRemoveFlightFromTrip && (
                      <button
                        type="button"
                        onClick={() => onRemoveFlightFromTrip(f.id)}
                        aria-label={t("trips:removeFromTrip")}
                        title={t("trips:removeFromTrip")}
                        className="p-1 rounded-sm transition-colors hover:bg-(--bg-muted)"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Icon name="circle-minus" size={16} />
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                    {f.seatNumber ?? ""}
                  </span>
                )}
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
