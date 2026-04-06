import { useMemo } from "react";
import type { Flight } from "../types";
import { calculateDistance } from "../lib/geo";
import { useLocale } from "../hooks/useLocale";
import { useTranslation } from "../hooks/useTranslation";
import { TooltipContainer } from "./TooltipContainer";

interface AirportTooltipProps {
  iata: string;
  screenX: number;
  screenY: number;
  flights: Flight[];
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
    let departures = 0;
    let arrivals = 0;
    let totalKm = 0;
    const routeCounts = new Map<string, number>();
    const airlinesSet = new Set<string>();

    for (const f of flights) {
      const isDep = f.depIata === iata;
      const isArr = f.arrIata === iata;
      if (!isDep && !isArr) continue;

      if (isDep) {
        departures++;
        if (!name && f.depName) name = f.depName;
        if (f.arrIata) {
          routeCounts.set(f.arrIata, (routeCounts.get(f.arrIata) ?? 0) + 1);
        }
      }
      if (isArr) {
        arrivals++;
        if (!name && f.arrName) name = f.arrName;
        if (f.depIata) {
          routeCounts.set(f.depIata, (routeCounts.get(f.depIata) ?? 0) + 1);
        }
      }
      if (f.airline) airlinesSet.add(f.airline);
      if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null)
        totalKm += calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    }

    const topRoutes = [...routeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dest, count]) => ({ dest, count }));

    return {
      name,
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
      borderColor="rgba(232,160,69,0.6)"
      minWidth="220px"
      maxWidth="300px"
    >
      {/* IATA + name */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-mono font-bold text-base" style={{ color: "rgb(232,160,69)" }}>
          {iata}
        </span>
        {stats.name && (
          <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
            {stats.name}
          </span>
        )}
      </div>

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
                  className="ml-3 px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{
                    background: "rgba(232,160,69,0.15)",
                    color: "rgb(232,160,69)",
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
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
        >
          ✕
        </button>
      </div>
    </TooltipContainer>
  );
}
