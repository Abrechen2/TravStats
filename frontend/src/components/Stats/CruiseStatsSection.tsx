import { useEffect, useState } from "react";
import { statsApi, type CruiseStatsResponse } from "../../lib/api/stats";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

/**
 * Cruise-domain stats section shown under the StatsPage cruise tab.
 * Fetches `/api/v1/stats/cruise` (which runs `calculateCruiseStats` on the
 * backend) and renders six KPI cards plus two boolean-flag strips.
 *
 * Kept deliberately small — the aggregation logic lives in the shared
 * `backend/src/utils/cruiseStats.ts` so adding more cards is a matter of
 * exposing additional fields in the JSON response and rendering them here.
 */
export default function CruiseStatsSection(): JSX.Element {
  const { t } = useTranslation(["stats", "cruise", "common"]);
  const [stats, setStats] = useState<CruiseStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await statsApi.getCruiseStats();
        if (!cancelled) setStats(data);
      } catch (err) {
        logger.error("Failed to load cruise stats:", err);
        if (!cancelled) setError(t("stats:cruiseSection.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (loading) {
    return (
      <div
        className="rounded-lg p-6"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("common:loading")} …
        </p>
      </div>
    );
  }

  if (error !== null || !stats) {
    return (
      <div
        className="rounded-lg p-6"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--danger)",
          color: "var(--danger)",
        }}
      >
        <p className="text-sm">{error ?? t("stats:cruiseSection.loadError")}</p>
      </div>
    );
  }

  if (stats.cruisesCount === 0) {
    return (
      <div
        className="rounded-lg px-6 py-10 text-center"
        style={{
          background: "var(--bg-surface)",
          border: "1px dashed var(--color-border)",
          color: "var(--text-muted)",
        }}
      >
        <p className="mb-2 text-3xl" aria-hidden>
          🚢
        </p>
        <p className="font-medium text-[var(--text-primary)]">
          {t("stats:cruiseSection.emptyTitle")}
        </p>
        <p className="mt-1 text-sm">{t("stats:cruiseSection.emptyHint")}</p>
      </div>
    );
  }

  const kpis: Array<{ label: string; value: string | number }> = [
    { label: t("stats:cruiseSection.count"), value: stats.cruisesCount },
    { label: t("stats:cruiseSection.ports"), value: stats.cruisePortsUnique },
    { label: t("stats:cruiseSection.ships"), value: stats.cruiseShipsUnique },
    { label: t("stats:cruiseSection.lines"), value: stats.cruiseLinesUnique },
    { label: t("stats:cruiseSection.seaDays"), value: stats.seaDays },
    { label: t("stats:cruiseSection.countries"), value: stats.countries.length },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-lg shadow p-4"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h3 className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              {kpi.label}
            </h3>
            <p
              className="text-2xl font-bold mt-1 font-mono"
              style={{ color: "var(--text-primary)" }}
            >
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Cruise lines + countries — sorted lists */}
      {stats.cruiseLines.length > 0 && (
        <div
          className="rounded-lg p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:cruiseSection.linesLabel")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.cruiseLines.map((line) => (
              <span
                key={line}
                className="px-2 py-0.5 rounded-full text-xs"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {line}
              </span>
            ))}
          </div>
        </div>
      )}

      {stats.countries.length > 0 && (
        <div
          className="rounded-lg p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:cruiseSection.countriesLabel")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.countries.map((c) => (
              <span
                key={c}
                className="px-2 py-0.5 rounded-full text-xs"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Special-flag strip */}
      <div className="flex flex-wrap gap-2 text-xs">
        {stats.hasBalconyCabin && (
          <Flag label={t("stats:cruiseSection.flags.balcony")} emoji="🏝️" />
        )}
        {stats.hasSuiteCabin && <Flag label={t("stats:cruiseSection.flags.suite")} emoji="👑" />}
        {stats.hasPolar && <Flag label={t("stats:cruiseSection.flags.polar")} emoji="🧊" />}
        {stats.hasColdWater && <Flag label={t("stats:cruiseSection.flags.coldWater")} emoji="❄️" />}
        {stats.hasCanalTransit && <Flag label={t("stats:cruiseSection.flags.canal")} emoji="⛴️" />}
      </div>
    </div>
  );
}

function Flag({ label, emoji }: { label: string; emoji: string }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md"
      style={{
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </span>
  );
}
