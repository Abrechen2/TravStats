import { useMemo } from "react";
import type { GeoJSONFeature } from "../types";
import { useLocale } from "../hooks/useLocale";
import { useTranslation } from "../hooks/useTranslation";
import { FlagImg, countryName } from "../lib/countryFlag";
import { TooltipContainer } from "./TooltipContainer";

interface AirportTooltipProps {
  iata: string;
  screenX: number;
  screenY: number;
  /** Same GeoJSON feature set that draws the route arcs — the tooltip
      aggregates these so its counts always match what's on the map. */
  flights: GeoJSONFeature[];
  onClose: () => void;
}

function formatKm(km: number, locale: string): string {
  if (km >= 1_000_000) return `${(km / 1_000_000).toFixed(1)} Mio. km`;
  return `${Math.round(km).toLocaleString(locale)} km`;
}

export function AirportTooltip({
  iata,
  screenX,
  screenY,
  flights,
  onClose,
}: AirportTooltipProps): JSX.Element {
  const locale = useLocale();
  const { t } = useTranslation(["dashboard"]);

  const stats = useMemo(() => {
    let name: string | null = null;
    let icao: string | null = null;
    let country: string | null = null;
    let city: string | null = null;
    let departures = 0;
    let arrivals = 0;
    let totalKm = 0;
    const routeCounts = new Map<string, number>();
    const airlinesSet = new Set<string>();

    for (const f of flights) {
      const dep = f.properties.departureAirport;
      const arr = f.properties.arrivalAirport;
      const isDep = dep.iata === iata;
      const isArr = arr.iata === iata;
      if (!isDep && !isArr) continue;

      if (isDep) {
        departures++;
        if (!name && dep.name) name = dep.name;
        if (!icao && dep.icao) icao = dep.icao;
        if (!country && dep.country) country = dep.country;
        if (!city && dep.city) city = dep.city;
        if (arr.iata) {
          routeCounts.set(arr.iata, (routeCounts.get(arr.iata) ?? 0) + 1);
        }
      }
      if (isArr) {
        arrivals++;
        if (!name && arr.name) name = arr.name;
        if (!icao && arr.icao) icao = arr.icao;
        if (!country && arr.country) country = arr.country;
        if (!city && arr.city) city = arr.city;
        if (dep.iata) {
          routeCounts.set(dep.iata, (routeCounts.get(dep.iata) ?? 0) + 1);
        }
      }
      if (f.properties.airline) airlinesSet.add(f.properties.airline);
      // Only flown (or historically-known-flown) legs contribute km — a
      // scheduled-but-not-yet-flown flight hasn't covered any distance yet.
      if (f.properties.status === "flown" || f.properties.status === "historical") {
        totalKm += f.properties.distance ?? 0;
      }
    }

    const topRoutes = [...routeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dest, count]) => ({ dest, count }));

    return {
      name,
      icao,
      country,
      city,
      departures,
      arrivals,
      totalKm,
      topRoutes,
      airlines: [...airlinesSet].slice(0, 6),
    };
  }, [iata, flights]);

  const total = stats.departures + stats.arrivals;

  return (
    <TooltipContainer
      screenX={screenX}
      screenY={screenY}
      borderColor="rgba(240,169,71,0.6)"
      minWidth="220px"
      maxWidth="300px"
    >
      {/* Flag + IATA + ICAO */}
      <div className="flex items-center gap-2 mb-1">
        <FlagImg country={stats.country} height={18} />
        <span className="font-mono font-bold text-lg" style={{ color: "rgb(240,169,71)" }}>
          {iata}
        </span>
        {stats.icao && (
          <span
            className="font-mono text-xs px-1 rounded-sm"
            style={{ background: "rgba(240,169,71,0.12)", color: "rgba(240,169,71,0.7)" }}
          >
            {stats.icao}
          </span>
        )}
      </div>
      {/* Name + City, Country */}
      {stats.name && (
        <div className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
          {stats.name}
        </div>
      )}
      {(stats.city || stats.country) && (
        <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
          {[stats.city, countryName(stats.country, locale)].filter(Boolean).join(", ")}
        </div>
      )}

      {/* Total flights */}
      <div className="text-xs mb-2" style={{ color: "var(--text-primary)" }}>
        <span className="font-semibold">{total}</span>{" "}
        <span style={{ color: "var(--text-muted)" }}>
          {t("dashboard:airport.flightsTotal", { count: total })}
        </span>
        <span style={{ color: "var(--text-muted)" }}>
          {" "}
          · {stats.departures}↑ {stats.arrivals}↓
        </span>
      </div>

      {/* Top routes */}
      {stats.topRoutes.length > 0 && (
        <div className="mb-2">
          <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            {t("dashboard:airport.topRoutes")}
          </div>
          <div className="space-y-0.5">
            {stats.topRoutes.map(({ dest, count }) => (
              <div key={dest} className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--text-primary)" }}>
                  {iata} ↔ {dest}
                </span>
                <span
                  className="ml-3 px-1.5 py-0.5 rounded-sm text-xs font-medium"
                  style={{
                    background: "rgba(240,169,71,0.15)",
                    color: "rgb(240,169,71)",
                  }}
                >
                  ×{count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Distance + airlines */}
      {stats.totalKm > 0 && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {formatKm(stats.totalKm, locale)} {t("dashboard:airport.flown")}
        </div>
      )}
      {stats.airlines.length > 0 && (
        <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
          {stats.airlines.join(" · ")}
        </div>
      )}

      <div className="flex justify-end mt-3">
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
