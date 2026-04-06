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

type PanelTab = "flights" | "trips";

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
  const groups = useMemo(() => groupFlights(flights), [flights]);

  const [tab, setTab] = useState<PanelTab>("flights");
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
            className="fixed left-0 top-14 bottom-0 w-80 z-40 flex flex-col overflow-hidden"
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
                    Trips
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
                  {id === "flights" ? t("dashboard:allFlights") : "Trips"}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {tab === "flights" ? (
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
                  Keine Trips vorhanden
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
                          {stats ? `${stats.count} ${stats.count !== 1 ? "Flüge" : "Flug"}` : "–"}
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
