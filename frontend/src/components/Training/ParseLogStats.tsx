import { useState, useEffect, useCallback } from "react";
import { trainingApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { ParseLogStats as ParseLogStatsType } from "../../types";
import { logger } from "../../lib/logger";

export default function ParseLogStats(): JSX.Element {
  const { t } = useTranslation("training");
  const addToast = useToastStore((state) => state.addToast);
  const [stats, setStats] = useState<ParseLogStatsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);

  const loadStats = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await trainingApi.getParseLogStats();
      setStats(data);
    } catch (err) {
      logger.error("Failed to load parse log stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleExport = async (): Promise<void> => {
    try {
      await trainingApi.exportParseLogs();
    } catch (err) {
      logger.error("Export failed:", err);
      addToast("error", String(err));
    }
  };

  const handlePromote = async (): Promise<void> => {
    setPromoting(true);
    try {
      const result = await trainingApi.promoteCorrections();
      if (result.promoted > 0) {
        addToast("success", t("training:parseLogs.promoteSuccess", { count: result.promoted }));
      } else {
        addToast("info", t("training:parseLogs.promoteNone"));
      }
      await loadStats();
    } catch (err) {
      logger.error("Promote failed:", err);
      addToast("error", String(err));
    } finally {
      setPromoting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">{t("training:parseLogs.loading")}</p>;
  }

  if (!stats || stats.totalLogs === 0) {
    return <p className="text-sm text-gray-500">{t("training:parseLogs.noData")}</p>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t("training:parseLogs.title")}</h3>

      {/* Summary row */}
      <div className="flex gap-6">
        <div className="text-center">
          <p className="text-2xl font-bold">{stats.totalLogs}</p>
          <p className="text-xs text-gray-500">{t("training:parseLogs.totalLogs")}</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">{stats.overallHitRate}%</p>
          <p className="text-xs text-gray-500">{t("training:parseLogs.overallHitRate")}</p>
        </div>
      </div>

      {/* Per-airline table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-(--color-border)">
              <th className="text-left py-1 pr-4">{t("training:parseLogs.airline")}</th>
              <th className="text-right py-1 pr-4">{t("training:parseLogs.total")}</th>
              <th className="text-right py-1 pr-4">{t("training:parseLogs.hitRate")}</th>
              <th className="text-left py-1">{t("training:parseLogs.missingFields")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.byAirline.map((row) => (
              <tr key={row.airline} className="border-b border-(--color-border)">
                <td className="py-1 pr-4 font-medium">{row.airline}</td>
                <td className="text-right py-1 pr-4">{row.total}</td>
                <td className="text-right py-1 pr-4">
                  <span
                    className={
                      row.hitRate >= 80
                        ? "text-(--success)"
                        : row.hitRate >= 50
                          ? "text-(--warning)"
                          : "text-(--danger)"
                    }
                  >
                    {row.hitRate}%
                  </span>
                </td>
                <td className="py-1 text-xs text-gray-500">
                  {row.commonMissingFields.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          data-testid="export-parse-logs-btn"
          onClick={() => {
            void handleExport();
          }}
          className="px-3 py-1.5 text-sm rounded-sm transition-colors"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
        >
          {t("training:parseLogs.exportBtn")}
        </button>
        <button
          data-testid="promote-corrections-btn"
          onClick={() => {
            void handlePromote();
          }}
          disabled={promoting}
          className="btn-primary px-3 py-1.5 text-sm"
        >
          {promoting ? t("training:parseLogs.promoting") : t("training:parseLogs.promoteBtn")}
        </button>
      </div>
    </div>
  );
}
