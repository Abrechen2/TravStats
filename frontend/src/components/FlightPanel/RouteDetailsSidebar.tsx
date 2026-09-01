import { useMemo } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import { formatDuration } from "../../lib/formatters";
import type { Flight } from "../../types";
import { isCountableFlight } from "../../shared/flightCounting";

interface RouteDetailsSidebarProps {
  flights: Flight[];
  onBack: () => void;
}

export function RouteDetailsSidebar({ flights, onBack }: RouteDetailsSidebarProps): JSX.Element {
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

  const depName = sorted[0]?.depName ?? sorted[0]?.depIata ?? "?";
  const arrName = sorted[0]?.arrName ?? sorted[0]?.arrIata ?? "?";

  const totalDistanceKm = useMemo(() => {
    const first = sorted[0];
    if (!first) return 0;
    if (first.routeDistance != null) return first.routeDistance;
    if (
      first.depLat != null &&
      first.depLon != null &&
      first.arrLat != null &&
      first.arrLon != null
    ) {
      return calculateDistance(first.depLat, first.depLon, first.arrLat, first.arrLon);
    }
    return 0;
  }, [sorted]);

  const avgDurationMin = useMemo(() => {
    const durations = sorted.map((f) => f.durationMinutes ?? 0).filter((d) => d > 0);
    return durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  }, [sorted]);

  const flownLegs = useMemo(() => sorted.filter(isCountableFlight), [sorted]);
  const scheduledLegs = useMemo(() => sorted.filter((f) => f.status === "scheduled"), [sorted]);

  // "2× geflogen · 1× geplant" — each part appears only when non-zero. When
  // neither is present (e.g. a cancelled-only selection) fall back to the
  // legacy "N× flown" label so that case still reads sensibly.
  const countsLabel = useMemo(() => {
    const parts: string[] = [];
    if (flownLegs.length > 0) parts.push(`${flownLegs.length}× ${t("dashboard:flown")}`);
    if (scheduledLegs.length > 0) parts.push(`${scheduledLegs.length}× ${t("dashboard:planned")}`);
    if (parts.length === 0) return `${sorted.length}× ${t("dashboard:flown")}`;
    return parts.join(" · ");
  }, [flownLegs.length, scheduledLegs.length, sorted.length, t]);

  const airlineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of sorted) {
      const a = f.airline ?? "Unknown";
      counts[a] = (counts[a] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [sorted]);

  const classCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of sorted) {
      const c = f.seatClass?.replace("_", " ") ?? "Unknown";
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [sorted]);

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

      <div
        className="px-3 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
          {depName}
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          ↕
        </div>
        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
          {arrName}
        </div>

        <div className="mt-2 space-y-0.5">
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {Math.round(totalDistanceKm).toLocaleString(locale)} km · {countsLabel}
          </div>
          {avgDurationMin > 0 && (
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              Ø {formatDuration(Math.round(avgDurationMin))}
            </div>
          )}
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {airlineCounts.map(([a, n]) => `${a} (${n}×)`).join(", ")}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {classCounts.map(([c, n]) => `${c} (${n}×)`).join(", ")}
          </div>
        </div>
      </div>

      <div
        className="px-3 py-2 text-xs font-medium uppercase tracking-wider shrink-0"
        style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--color-border)" }}
      >
        {t("dashboard:flightsOnRoute")}
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.map((f) => (
          <div
            key={f.id}
            className="px-3 py-2 text-xs flex items-center gap-2"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <span className="w-20 shrink-0" style={{ color: "var(--text-muted)" }}>
              {f.departureTime
                ? new Date(f.departureTime).toLocaleDateString(locale, {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })
                : "—"}
            </span>
            <span
              className="w-16 shrink-0 font-mono font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {f.flightNumber ?? "—"}
            </span>
            <span className="shrink-0 font-mono" style={{ color: "var(--text-secondary)" }}>
              {f.depIata}→{f.arrIata}
            </span>
            <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
              {f.seatNumber ?? ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
