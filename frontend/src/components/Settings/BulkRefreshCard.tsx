import Modal from "../Modal";
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
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";

const MAX_PER_BATCH = 25;

/**
 * Remembers, for this tab, that the server has already refused this account's
 * quota. `rejectDemoQuota` refuses EVERY `isDemo` account -- the preview
 * instances' own admin and the local dev admin included -- and only
 * `isSharedDemo` is visible from the frontend, so the first 403 is the only
 * way to learn about the others. Remembering it turns "a 403 in the console on
 * every visit to /settings/account" into one per tab. `sessionStorage`, not
 * `localStorage`: the flag belongs to whoever is logged in right now.
 */
const QUOTA_REFUSED_KEY = "travstats:bulkRefresh:quotaRefused";

function readQuotaRefused(): boolean {
  try {
    return window.sessionStorage.getItem(QUOTA_REFUSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberQuotaRefused(): void {
  try {
    window.sessionStorage.setItem(QUOTA_REFUSED_KEY, "1");
  } catch {
    // Private window / storage disabled — the request simply goes again.
  }
}

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
        rememberQuotaRefused();
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

  /**
   * The shared demo does not ask.
   *
   * Beta audit 2026-09-19, unlisted finding 2: every load of
   * `/settings/account` -- which draws all four general groups on one page,
   * this card among them -- fired `GET /flights/refresh-historical-bulk/preview`
   * and took a 403 with a console error. `rejectDemoQuota` refuses the demo
   * before the handler runs, so the answer was known before the request: the
   * account may not spend the instance's RapidAPI quota, and the card already
   * says so from `demoBlocked`.
   *
   * Knowing the answer is why the request goes, not merely because it is
   * noisy -- the same reason `NotificationsSection` does not fetch the shared
   * account's address. The 403 branch in `loadPreview` stays: the server
   * refuses EVERY `isDemo` account (the preview's own admin, the local dev
   * admin), and only the shared one is visible from here.
   */
  const isSharedDemo = useIsDemoAccount();

  useEffect(() => {
    if (isSharedDemo || readQuotaRefused()) {
      setDemoBlocked(true);
      return;
    }
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPreview is re-created each render; the flag is the only real input
  }, [isSharedDemo]);

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
    <div className="space-y-3">
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}>
          {t("settings:apiKeys.bulkRefresh.title")}
        </span>
        <span className="t-caption">{t("settings:apiKeys.bulkRefresh.description")}</span>
      </div>

      {demoBlocked && (
        <div className="text-sm p-2 rounded-md bg-(--bg-elevated) text-(--text-muted)">
          {t("settings:apiKeys.bulkRefresh.demoBlocked")}
        </div>
      )}

      {!demoBlocked && !hasProvider && (
        <div
          className="rounded-md p-2 text-sm"
          style={{
            background: "color-mix(in srgb, var(--ts-warn) 12%, transparent)",
            color: "var(--ts-warn)",
          }}
        >
          {t("settings:apiKeys.bulkRefresh.noHistoricalProvider")}
        </div>
      )}

      {previewError && !demoBlocked && (
        <div
          className="text-sm p-2 rounded-md"
          style={{
            background: "color-mix(in srgb, var(--ts-bad) 12%, transparent)",
            color: "var(--ts-bad)",
          }}
        >
          {previewError}
        </div>
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
        <div
          className="text-sm p-2 rounded-md"
          style={{
            background: "color-mix(in srgb, var(--ts-good) 12%, transparent)",
            color: "var(--ts-good)",
          }}
        >
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
            <li style={{ color: "var(--ts-good)" }}>
              {t("settings:apiKeys.bulkRefresh.summaryUpdated", { count: lastSummary.updated })}
            </li>
            <li>
              {t("settings:apiKeys.bulkRefresh.summaryNoData", { count: lastSummary.noData })}
            </li>
            {/* Shown only when it happened, and worded as the opposite of the
                line above: the provider answered, the record was already
                complete. Folded into "no provider data" it read as a failure
                of the API and hid that the run had done its job. */}
            {lastSummary.alreadyComplete > 0 && (
              <li>
                {t("settings:apiKeys.bulkRefresh.summaryAlreadyComplete", {
                  count: lastSummary.alreadyComplete,
                })}
              </li>
            )}
            {lastSummary.failed > 0 && (
              <li style={{ color: "var(--ts-bad)" }}>
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

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("settings:apiKeys.bulkRefresh.confirmTitle")}
        maxWidth={448}
        closeLabel={t("common:buttons.close")}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-(--text-primary) hover:bg-(--bg-base)"
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
          </>
        }
      >
        <p className="mb-3 text-sm text-(--text-muted)">
          {t("settings:apiKeys.bulkRefresh.confirmBody", { count: estimatedCalls })}
        </p>
        {quota && quota.remaining !== null && (
          <p className="mb-3 text-sm text-(--text-primary)">
            {t("settings:apiKeys.bulkRefresh.confirmQuotaCurrent", {
              remaining: quota.remaining,
              limit: quota.limit ?? "?",
            })}
            {quota.remaining < estimatedCalls && (
              <span className="mt-1 block" style={{ color: "var(--ts-warn)" }}>
                ⚠ {t("settings:apiKeys.bulkRefresh.confirmQuotaWarn")}
              </span>
            )}
          </p>
        )}
        <p className="text-xs text-(--text-muted)">
          {t("settings:apiKeys.bulkRefresh.confirmHistoricalNote")}
        </p>
      </Modal>
    </div>
  );
}
