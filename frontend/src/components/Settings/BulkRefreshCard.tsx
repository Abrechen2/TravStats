/**
 * Bulk refresh card — sits below the AeroDataBox API-Key card and
 * lets the user retroactively backfill `aircraftRegistration`,
 * `aircraftModeS`, `isCodeshare`, and airline ICAO/IATA onto existing
 * flights that pre-date the Phase-2 enrichment commit.
 *
 * UX flow:
 *   1. Card mounts → fetch preview count.
 *      - 403 DEMO_ACCOUNT_FORBIDDEN → button disabled + tooltip,
 *        nothing else changes (the rest of Settings stays usable).
 *   2. User clicks "Auffrischen" → confirmation modal showing exactly
 *      how many AeroDataBox calls this batch will burn (max 25 per
 *      run). User must explicitly confirm.
 *   3. Run button → POST endpoint, show summary toast, refresh the
 *      preview count so the user can see what's left and decide
 *      whether to click again.
 *
 * The 25-call hard cap is enforced server-side; this card just
 * surfaces it. Re-clicking after a successful run is the explicit
 * "drain remaining" path.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { flightsApi, type AerodataboxQuota, type BulkRefreshSummary } from "../../lib/api/flights";

const MAX_PER_BATCH = 25;

export default function BulkRefreshCard(): JSX.Element | null {
  const { t } = useTranslation(["settings", "common"]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [hasProvider, setHasProvider] = useState(true);
  const [quota, setQuota] = useState<AerodataboxQuota | null>(null);
  const [demoBlocked, setDemoBlocked] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastSummary, setLastSummary] = useState<BulkRefreshSummary | null>(null);

  const loadPreview = async (): Promise<void> => {
    try {
      const {
        remaining: count,
        hasHistoricalProvider,
        aerodataboxQuota,
      } = await flightsApi.bulkRefreshPreview();
      setRemaining(count);
      setHasProvider(hasHistoricalProvider);
      setQuota(aerodataboxQuota);
      setDemoBlocked(false);
      setPreviewError(null);
    } catch (error: unknown) {
      const errObj = error as {
        response?: { status?: number; data?: { error?: string; message?: string } };
        message?: string;
      };
      if (
        errObj.response?.status === 403 &&
        errObj.response.data?.error === "DEMO_ACCOUNT_FORBIDDEN"
      ) {
        setDemoBlocked(true);
        setRemaining(null);
        setPreviewError(null);
      } else {
        setPreviewError(
          errObj.response?.data?.message || errObj.message || "Vorschau fehlgeschlagen"
        );
      }
    }
  };

  useEffect(() => {
    void loadPreview();
  }, []);

  const handleRun = async (): Promise<void> => {
    setRunning(true);
    setConfirmOpen(false);
    try {
      const summary = await flightsApi.bulkRefreshRun();
      setLastSummary(summary);
      setRemaining(summary.remaining);
      if (summary.aerodataboxQuota) {
        setQuota(summary.aerodataboxQuota);
      }
    } catch (error: unknown) {
      const errObj = error as {
        response?: { status?: number; data?: { error?: string; message?: string } };
        message?: string;
      };
      if (
        errObj.response?.status === 403 &&
        errObj.response.data?.error === "DEMO_ACCOUNT_FORBIDDEN"
      ) {
        setDemoBlocked(true);
      } else {
        setPreviewError(
          errObj.response?.data?.message || errObj.message || "Aktualisierung fehlgeschlagen"
        );
      }
    } finally {
      setRunning(false);
    }
  };

  // Estimated calls for the upcoming batch — capped by MAX_PER_BATCH.
  const estimatedCalls = remaining !== null ? Math.min(remaining, MAX_PER_BATCH) : 0;
  const buttonDisabled =
    demoBlocked || running || !hasProvider || remaining === null || remaining === 0;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-(--text-primary)">
            {t("settings:apiKeys.bulkRefresh.title")}
          </h3>
          <p className="text-sm text-(--text-muted) mt-1">
            {t("settings:apiKeys.bulkRefresh.description")}
          </p>
        </div>
      </div>

      {demoBlocked && (
        <div className="text-sm p-2 rounded-md bg-(--bg-elevated) text-(--text-muted)">
          {t("settings:apiKeys.bulkRefresh.demoBlocked")}
        </div>
      )}

      {!demoBlocked && !hasProvider && (
        <div className="text-sm p-2 rounded-md bg-yellow-100 text-yellow-800">
          {t("settings:apiKeys.bulkRefresh.noHistoricalProvider")}
        </div>
      )}

      {previewError && !demoBlocked && (
        <div className="text-sm p-2 rounded-md bg-red-100 text-red-700">{previewError}</div>
      )}

      {remaining !== null && remaining > 0 && (
        <div className="text-sm text-(--text-primary)">
          {t("settings:apiKeys.bulkRefresh.remainingPrefix")}{" "}
          <span className="font-semibold">{remaining}</span>{" "}
          {t("settings:apiKeys.bulkRefresh.remainingSuffix")}
        </div>
      )}

      {quota && (quota.remaining !== null || quota.limit !== null) && (
        <div className="text-xs text-(--text-muted)">
          {t("settings:apiKeys.bulkRefresh.quotaLabelADB")}:{" "}
          <span className="font-semibold text-(--text-primary)">{quota.remaining ?? "?"}</span>
          {quota.limit !== null && (
            <span className="text-(--text-muted)"> / {quota.limit}</span>
          )}{" "}
          {t("settings:apiKeys.bulkRefresh.quotaSuffixADB")}
        </div>
      )}

      {remaining === 0 && !demoBlocked && (
        <div className="text-sm p-2 rounded-md bg-green-100 text-green-700">
          {t("settings:apiKeys.bulkRefresh.allUpToDate")}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={buttonDisabled}
          title={demoBlocked ? t("settings:apiKeys.bulkRefresh.demoBlocked") : undefined}
          className="btn-primary px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed flex items-center gap-2"
        >
          {running
            ? t("settings:apiKeys.bulkRefresh.running")
            : t("settings:apiKeys.bulkRefresh.button")}
        </button>
      </div>

      {lastSummary && (
        <div className="text-sm p-3 rounded-md bg-(--bg-elevated) border border-border">
          <div className="font-medium text-(--text-primary) mb-1">
            {t("settings:apiKeys.bulkRefresh.summaryTitle")}
          </div>
          <ul className="space-y-0.5 text-(--text-muted)">
            <li>
              {t("settings:apiKeys.bulkRefresh.summaryScanned", { count: lastSummary.scanned })}
            </li>
            <li className="text-green-700">
              {t("settings:apiKeys.bulkRefresh.summaryUpdated", { count: lastSummary.updated })}
            </li>
            <li>
              {t("settings:apiKeys.bulkRefresh.summaryNoData", { count: lastSummary.noData })}
            </li>
            {lastSummary.failed > 0 && (
              <li className="text-red-700">
                {t("settings:apiKeys.bulkRefresh.summaryFailed", { count: lastSummary.failed })}
              </li>
            )}
          </ul>
          {lastSummary.remaining > 0 && (
            <div className="mt-2 text-xs text-(--text-muted)">
              {t("settings:apiKeys.bulkRefresh.summaryRetryHint", {
                count: lastSummary.remaining,
              })}
            </div>
          )}
        </div>
      )}

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="max-w-md w-full mx-4 rounded-lg p-6 shadow-xl"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-(--text-primary) mb-2">
              {t("settings:apiKeys.bulkRefresh.confirmTitle")}
            </h2>
            <p className="text-sm text-(--text-muted) mb-3">
              {t("settings:apiKeys.bulkRefresh.confirmBody", {
                count: estimatedCalls,
              })}
            </p>
            {quota && quota.remaining !== null && (
              <p className="text-sm text-(--text-primary) mb-3">
                {t("settings:apiKeys.bulkRefresh.confirmQuotaCurrent", {
                  remaining: quota.remaining,
                  limit: quota.limit ?? "?",
                })}
                {quota.remaining < estimatedCalls && (
                  <span className="block mt-1 text-yellow-700">
                    ⚠ {t("settings:apiKeys.bulkRefresh.confirmQuotaWarn")}
                  </span>
                )}
              </p>
            )}
            <p className="text-xs text-(--text-muted) mb-4">
              {t("settings:apiKeys.bulkRefresh.confirmHistoricalNote")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-3 py-1.5 text-sm rounded-md border border-border text-(--text-primary) hover:bg-(--bg-base)"
              >
                {t("common:buttons.cancel")}
              </button>
              <button
                type="button"
                onClick={handleRun}
                className="btn-primary px-3 py-1.5 text-sm font-medium"
              >
                {t("settings:apiKeys.bulkRefresh.confirmRun")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
