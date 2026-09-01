import { useEffect, useState } from "react";
import { statsApi, flightsApi } from "../lib/api";
import HelpIcon from "./Help/HelpIcon";
import type { Stats as StatsType, Route, FlightFilters, Flight } from "../types";
import { calculateDistance } from "../lib/geo";
import { API_LIMITS } from "../lib/constants";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import { formatDistance, formatCurrency as formatCurrencyUtil } from "../lib/units";
import { SkeletonStatCards } from "./SkeletonLoader";
import { isCountableFlight } from "../shared/flightCounting";

interface StatsProps {
  filters?: FlightFilters;
}

export default function Stats({ filters = {} }: StatsProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "common"]);
  const { units, baseCurrency } = useSettingsStore();
  const lang = i18n.language;
  const [stats, setStats] = useState<StatsType | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [filters]);

  const loadStats = async () => {
    try {
      // minRouteCount is a map-only filter — not applied to API queries
      const { minRouteCount: _mapOnly, ...apiFilters } = filters;
      void _mapOnly;
      const hasBackendFilters = Object.keys(apiFilters).length > 0;
      // If filters are applied, calculate stats from filtered flights
      if (hasBackendFilters) {
        const limit = API_LIMITS.MAX_PAGE_SIZE;
        let allFlights: Flight[] = [];
        let offset = 0;

        const MAX_PAGES = 200;
        let pages = 0;
        while (pages < MAX_PAGES) {
          pages++;
          const { flights } = await flightsApi.getAll({ ...apiFilters, limit, offset });
          allFlights = [...allFlights, ...flights];
          if (flights.length < limit) break;
          offset += limit;
        }

        const calculatedStats = calculateStats(allFlights);
        setStats(calculatedStats);
        setRoutes([]);
      } else {
        const [summaryData, routesData] = await Promise.all([
          statsApi.getSummary(),
          statsApi.getTopRoutes(API_LIMITS.TOP_ROUTES),
        ]);
        // getSummary without year/compareYear always returns flat SummaryStats (not a compare response)
        if (!("current" in summaryData)) {
          setStats(summaryData as StatsType);
        }
        setRoutes(routesData.routes);
      }
    } catch (error) {
      logger.error("Failed to load stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (flights: Flight[]): StatsType => {
    // Distance is time-insensitive — count flown + historical flights so old
    // logbook entries contribute to the total. Flight time stays flown-only
    // because historical entries use placeholder times that would distort
    // the duration sum.
    const countableFlights = flights.filter(isCountableFlight);
    const flownFlights = flights.filter((f) => f.status === "flown");
    const totalDistance = countableFlights.reduce((sum, f) => {
      // Use accurate Haversine formula for distance calculation
      // Skip flights with missing coordinates
      if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) {
        return sum;
      }
      const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      return sum + dist;
    }, 0);

    const totalFlightTime = flownFlights.reduce((sum, f) => {
      const duration =
        f.departureTime && f.arrivalTime
          ? (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / 60000
          : 0;
      return sum + duration;
    }, 0);

    const byStatus: Record<string, number> = {};
    const byAirline: Record<string, number> = {};
    flights.forEach((f) => {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      if (f.airline) byAirline[f.airline] = (byAirline[f.airline] || 0) + 1;
    });

    const totalCost = flights.reduce((sum, f) => sum + (f.price || 0), 0);

    return {
      totalFlights: flights.length,
      totalDistance: Math.round(totalDistance),
      avgDistance: flights.length > 0 ? Math.round(totalDistance / flights.length) : 0,
      totalFlightTime: Math.round(totalFlightTime),
      byStatus,
      byAirline,
      totalCost: totalCost > 0 ? totalCost : undefined,
    };
  };

  if (loading) {
    return <SkeletonStatCards />;
  }

  if (!stats) {
    return (
      <div className="text-center py-4" style={{ color: "var(--text-muted)" }}>
        {t("stats:noStatsAvailable")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.totalFlights")}
          </p>
          <p className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
            {stats.totalFlights}
          </p>
        </div>
        <div className="card">
          <div className="text-sm flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.totalDistance")}
            <HelpIcon
              content={t("stats:help.totalDistance")}
              expandedContent={t("stats:help.totalDistanceExpanded")}
              position="top"
            />
          </div>
          <p className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
            {formatDistance(stats.totalDistance, units.distanceUnit, t, lang)}
          </p>
        </div>
        <div className="card">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.avgDistance")}
          </p>
          <p className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
            {formatDistance(stats.avgDistance, units.distanceUnit, t, lang)}
          </p>
        </div>
        <div className="card">
          <div className="text-sm flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.totalFlightTime")}
            <HelpIcon
              content={t("stats:help.totalFlightTime")}
              expandedContent={t("stats:help.totalFlightTimeExpanded")}
              position="top"
            />
          </div>
          <p className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
            {Math.round(stats.totalFlightTime / 60)} {t("stats:overview.hours")}
          </p>
        </div>
        {typeof stats.totalCost === "number" && (
          <div className="card">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:overview.totalCost")}
            </p>
            <p className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
              {formatCurrencyUtil(stats.totalCost, baseCurrency)}
            </p>
          </div>
        )}
      </div>

      {/* By Status */}
      <div className="card">
        <h3 className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          {t("stats:byStatus.title")}
        </h3>
        <div className="space-y-2">
          {Object.entries(stats.byStatus).map(([status, count]) => (
            <div
              key={status}
              className="flex justify-between items-center"
              style={{ color: "var(--text-primary)" }}
            >
              <span>{t(`flights:status.${status}`, { defaultValue: status })}</span>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* By Airline */}
      <div className="card">
        <h3 className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          {t("stats:airlines.title")}
        </h3>
        <div className="space-y-2">
          {Object.entries(stats.byAirline)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([airline, count]) => (
              <div
                key={airline}
                className="flex justify-between items-center"
                style={{ color: "var(--text-primary)" }}
              >
                <span>{airline}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* By Category */}
      {stats.byCategory && (
        <div className="card">
          <h3 className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            {t("stats:byCategory.title")}
          </h3>
          <div className="space-y-2">
            {Object.entries(stats.byCategory).map(([category, count]) => (
              <div
                key={category}
                className="flex justify-between items-center"
                style={{ color: "var(--text-primary)" }}
              >
                <span>{t(`flights:category.${category}`, { defaultValue: category })}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Routes */}
      {routes.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            {t("stats:topRoutes.title")}
          </h3>
          <div className="space-y-3">
            {routes.map((route, index) => (
              <div
                key={route.route}
                className="border-b pb-2 last:border-0"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                      {index + 1}. {route.route}
                    </p>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {formatDistance(route.distance, units.distanceUnit, t, lang)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                    {route.count}x
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
