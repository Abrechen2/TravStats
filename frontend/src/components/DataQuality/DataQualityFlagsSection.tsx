import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { dataQualityFlagsApi } from "../../lib/api/dataQualityFlags";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { DataQualityFlag, DataQualityFlagStatus } from "../../types/dataQuality";

import DataQualityFlagCard from "./DataQualityFlagCard";

/**
 * The "Zu prüfen" half of the Posteingang.
 *
 * One inbox, two tables (design §3.5): a `PendingFlightUpdate` is a provider's
 * proposed field values for a flight, a `DataQualityFlag` is a question about
 * any record. They share a page and nothing else — this section owns its own
 * fetching, its own filter and its own error handling, so the flight-updates
 * section above it behaves exactly as it did before.
 *
 * The filter offers the answered statuses as well as the open ones. `dismissed`
 * is the only permanent answer, which makes it the one a user is most likely to
 * want to look back at.
 */

const STATUS_OPTIONS: (DataQualityFlagStatus | "all")[] = [
  "open",
  "resolved",
  "dismissed",
  "all",
] as const;

export default function DataQualityFlagsSection(): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const addToast = useToastStore((state) => state.addToast);

  const [flags, setFlags] = useState<DataQualityFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DataQualityFlagStatus | "all">("open");

  const loadFlags = useCallback(async () => {
    try {
      setLoading(true);
      const data = await dataQualityFlagsApi.getAll({ status: statusFilter });
      setFlags(data.flags ?? []);
    } catch (error) {
      logger.error("Failed to load data-quality flags:", error);
      addToast("error", t("dataQuality:inbox.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, addToast, t]);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  // "I have corrected the data" — a later run re-opens it if it did not stick.
  const handleResolve = async (id: string): Promise<void> => {
    try {
      setBusyId(id);
      await dataQualityFlagsApi.resolve(id);
      addToast("success", t("dataQuality:inbox.messages.resolved"));
      await loadFlags();
    } catch (error) {
      logger.error("Failed to resolve data-quality flag:", error);
      addToast("error", t("dataQuality:inbox.errors.resolveFailed"));
    } finally {
      setBusyId(null);
    }
  };

  // "This is not wrong, stop asking" — never re-opened.
  const handleDismiss = async (id: string): Promise<void> => {
    try {
      setBusyId(id);
      await dataQualityFlagsApi.dismiss(id);
      addToast("success", t("dataQuality:inbox.messages.dismissed"));
      await loadFlags();
    } catch (error) {
      logger.error("Failed to dismiss data-quality flag:", error);
      addToast("error", t("dataQuality:inbox.errors.dismissFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRun = async (): Promise<void> => {
    try {
      setRunning(true);
      const summary = await dataQualityFlagsApi.run();
      // Interpolated as `open`, not `count`: i18next reads `count` as a plural
      // selector and would look for `checked_one`/`checked_other` instead.
      addToast("success", t("dataQuality:inbox.messages.checked", { open: summary.open }));
      await loadFlags();
    } catch (error) {
      logger.error("Failed to re-run data-quality checks:", error);
      addToast("error", t("dataQuality:inbox.errors.runFailed"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mb-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("dataQuality:inbox.review.title")}
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("dataQuality:inbox.review.description")}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="min-w-[160px]">
            <label className="label mb-2" htmlFor="data-quality-status">
              {t("dataQuality:inbox.review.filter.label")}
            </label>
            <select
              id="data-quality-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as DataQualityFlagStatus | "all")}
              className="input w-full"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`dataQuality:inbox.review.filter.${option}`)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="btn-secondary disabled:opacity-50"
          >
            {running
              ? t("dataQuality:inbox.review.rechecking")
              : t("dataQuality:inbox.review.recheck")}
          </button>
        </div>
      </div>

      {loading ? (
        <div
          className="rounded-lg shadow-xs p-6 text-center"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <span style={{ color: "var(--text-muted)" }}>{t("common:loading.default")}</span>
        </div>
      ) : flags.length === 0 ? (
        <div
          className="rounded-lg shadow-xs p-8 text-center"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3 className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
            {t("dataQuality:inbox.review.empty.title")}
          </h3>
          <p className="mt-2" style={{ color: "var(--text-muted)" }}>
            {t("dataQuality:inbox.review.empty.description")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {flags.map((flag) => (
            <DataQualityFlagCard
              key={flag.id}
              flag={flag}
              busy={busyId === flag.id}
              onResolve={() => void handleResolve(flag.id)}
              onDismiss={() => void handleDismiss(flag.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
