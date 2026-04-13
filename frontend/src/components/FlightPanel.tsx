import { useMemo, useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Flight, Trip } from "../types";
import { groupFlights } from "../utils/groupFlights";
import { FlightEntry } from "./FlightPanel/FlightEntry";
import { FlightGroupItem } from "./FlightPanel/FlightGroupItem";
import { useTranslation } from "../hooks/useTranslation";
import { useLocale } from "../hooks/useLocale";
import { tripsApi } from "../lib/api";
import { calculateDistance } from "../lib/geo";
import { RouteDetailsSidebar } from "./FlightPanel/RouteDetailsSidebar";
import { TripDetailsSidebar } from "./FlightPanel/TripDetailsSidebar";
import { useFlightSelectionStore } from "../store/flightSelectionStore";

type PanelTab = "flights" | "trips";
type SortMode = "date-desc" | "date-asc" | "route" | "airline" | "status";

interface FlightPanelProps {
  flights: Flight[];
  totalCount: number;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
  onAddFlight: () => void;
  onTripSelect?: (tripId: string) => void;
  allFlights?: Flight[];
}

export function FlightPanel({
  flights,
  totalCount,
  isOpen,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onAddFlight,
  onTripSelect,
  allFlights = [],
}: FlightPanelProps): JSX.Element {
  const { t } = useTranslation(["dashboard", "common"]);
  const locale = useLocale();
  const [tab, setTab] = useState<PanelTab>("flights");
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  // Group flights chronologically (for multi-leg detection), then sort groups
  const groups = useMemo(() => {
    const grouped = groupFlights(flights);

    const firstFlight = (g: ReturnType<typeof groupFlights>[number]): Flight =>
      g.type === "single" ? g.flight : g.flights[0];

    switch (sortMode) {
      case "date-desc":
        // Default: chronological (groupFlights already sorts by departure)
        break;
      case "date-asc":
        grouped.reverse();
        break;
      case "route":
        grouped.sort((a, b) => {
          const fa = firstFlight(a);
          const fb = firstFlight(b);
          const ra = `${fa.depIata ?? ""}${fa.arrIata ?? ""}`;
          const rb = `${fb.depIata ?? ""}${fb.arrIata ?? ""}`;
          return ra.localeCompare(rb);
        });
        break;
      case "airline":
        grouped.sort((a, b) =>
          (firstFlight(a).airline ?? "").localeCompare(firstFlight(b).airline ?? "")
        );
        break;
      case "status": {
        const order: Record<string, number> = { scheduled: 0, flown: 1, cancelled: 2 };
        grouped.sort(
          (a, b) =>
            (order[firstFlight(a).status] ?? 1) - (order[firstFlight(b).status] ?? 1) ||
            (firstFlight(a).departureTime ? new Date(firstFlight(a).departureTime!).getTime() : 0) -
              (firstFlight(b).departureTime ? new Date(firstFlight(b).departureTime!).getTime() : 0)
        );
        break;
      }
    }
    return grouped;
  }, [flights, sortMode]);
  const { detailMode, selectedFlights: detailFlights, clearSelection } = useFlightSelectionStore();

  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    tripsApi
      .getAll()
      .then(setTrips)
      .catch(() => {});
  }, [isOpen]);

  // Per-trip stats derived from allFlights
  const tripStats = useMemo(() => {
    const map = new Map<
      string,
      { count: number; minDate: number; maxDate: number; totalKm: number }
    >();
    for (const f of allFlights) {
      if (!f.tripId) continue;
      const prev = map.get(f.tripId) ?? {
        count: 0,
        minDate: Infinity,
        maxDate: -Infinity,
        totalKm: 0,
      };
      const t = f.departureTime ? new Date(f.departureTime).getTime() : NaN;
      let km = 0;
      if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null)
        km = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      map.set(f.tripId, {
        count: prev.count + 1,
        minDate: isNaN(t) ? prev.minDate : Math.min(prev.minDate, t),
        maxDate: isNaN(t) ? prev.maxDate : Math.max(prev.maxDate, t),
        totalKm: prev.totalKm + km,
      });
    }
    return map;
  }, [allFlights]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
          <motion.div
            initial={{ x: -380 }}
            animate={{ x: 0 }}
            exit={{ x: -380 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed left-0 top-14 bottom-0 w-80 max-w-[calc(100vw-3rem)] z-40 flex flex-col overflow-hidden"
            style={{
              background: "rgba(22,27,34,0.95)",
              backdropFilter: "blur(20px)",
              borderRight: "1px solid var(--color-border)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <h2 className="text-sm font-semibold flex items-center gap-2">
                {tab === "flights" ? (
                  <>
                    {t("dashboard:allFlights")}
                    <span
                      className="px-1.5 py-0.5 text-xs rounded-full"
                      style={{ background: "var(--accent)", color: "white" }}
                    >
                      {totalCount}
                    </span>
                  </>
                ) : (
                  <>
                    {t("dashboard:trips.label")}
                    <span
                      className="px-1.5 py-0.5 text-xs rounded-full"
                      style={{ background: "var(--accent)", color: "white" }}
                    >
                      {trips.length}
                    </span>
                  </>
                )}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common:buttons.close")}
                className="text-sm transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* Tab bar */}
            <div
              className="flex flex-shrink-0"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              {(["flights", "trips"] as PanelTab[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className="flex-1 py-2 text-xs font-medium transition-colors"
                  style={{
                    color: tab === id ? "var(--accent)" : "var(--text-muted)",
                    borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  {id === "flights" ? t("dashboard:allFlights") : t("dashboard:trips.label")}
                </button>
              ))}
            </div>

            {/* Sort selector (only for flights tab, not detail views) */}
            {tab === "flights" && !detailMode && (
              <div
                className="flex items-center gap-1 px-3 py-1.5 flex-shrink-0"
                style={{ borderBottom: "1px solid var(--color-border)" }}
              >
                {(
                  [
                    { value: "date-desc", label: "↑ " + t("dashboard:sortDate") },
                    { value: "date-asc", label: "↓ " + t("dashboard:sortDate") },
                    { value: "route", label: t("dashboard:sortRoute") },
                    { value: "airline", label: t("dashboard:sortAirline") },
                    { value: "status", label: t("dashboard:sortStatus") },
                  ] as { value: SortMode; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSortMode(opt.value)}
                    className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                    style={{
                      background: sortMode === opt.value ? "var(--accent)" : "transparent",
                      color: sortMode === opt.value ? "white" : "var(--text-muted)",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {detailMode === "route-details" && detailFlights.length > 0 ? (
                <RouteDetailsSidebar flights={detailFlights} onBack={clearSelection} />
              ) : detailMode === "trip-details" && detailFlights.length > 0 ? (
                <TripDetailsSidebar flights={detailFlights} onBack={clearSelection} />
              ) : tab === "flights" ? (
                groups.map((group) =>
                  group.type === "single" ? (
                    <FlightEntry
                      key={group.flight.id}
                      flight={group.flight}
                      onEdit={onEdit}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                    />
                  ) : (
                    <FlightGroupItem
                      key={group.flights[0].id}
                      flights={group.flights}
                      label={group.label}
                      onEdit={onEdit}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                    />
                  )
                )
              ) : trips.length === 0 ? (
                <div
                  className="px-4 py-8 text-center text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("dashboard:trips.noTrips")}
                </div>
              ) : (
                trips.map((trip) => {
                  const stats = tripStats.get(trip.id);
                  const year =
                    stats && isFinite(stats.minDate) ? new Date(stats.minDate).getFullYear() : null;
                  const km =
                    stats && stats.totalKm > 0
                      ? `${Math.round(stats.totalKm).toLocaleString(locale)} km`
                      : null;
                  return (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => {
                        onTripSelect?.(trip.id);
                      }}
                      className="w-full text-left px-4 py-3 transition-colors hover:bg-white/5 flex items-start gap-3"
                      style={{ borderBottom: "1px solid var(--color-border)" }}
                    >
                      {/* Color dot */}
                      <span
                        className="mt-0.5 flex-shrink-0 w-3 h-3 rounded-full"
                        style={{ background: trip.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-sm font-semibold truncate"
                          style={{ color: trip.color }}
                        >
                          {trip.name}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {stats
                            ? `${stats.count} ${t("dashboard:trips.flights", { count: stats.count })}`
                            : "–"}
                          {year ? ` · ${year}` : ""}
                          {km ? ` · ${km}` : ""}
                        </div>
                        {trip.description && (
                          <div
                            className="text-xs mt-0.5 truncate"
                            style={{ color: "var(--text-muted)", opacity: 0.7 }}
                          >
                            {trip.description}
                          </div>
                        )}
                      </div>
                      <span
                        className="text-xs flex-shrink-0 mt-0.5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        ›
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {tab === "flights" && (
              <div
                className="p-3 flex-shrink-0"
                style={{ borderTop: "1px solid var(--color-border)" }}
              >
                <button type="button" onClick={onAddFlight} className="btn-primary w-full text-sm">
                  + {t("dashboard:addFlight")}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
