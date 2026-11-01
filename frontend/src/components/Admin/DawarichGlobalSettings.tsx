import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { dawarichAdminApi, dawarichFailureKey, dawarichFailureKind } from "../../lib/api/dawarich";
import { JobLostError } from "../../lib/api/jobs";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { DawarichTestResult } from "../../types/dawarich";

/**
 * Instance-wide Dawarich connection (tier 2 of the resolver) and "sweep country
 * days now" (forgejo#397). Same shape as `ImmichGlobalSettings`: the key
 * round-trips masked, an empty field is an explicit clear, and a failed load
 * never renders the editable form (saving it would PUT nulls over the stored
 * connection). The sweep is a job on the server; a lost job is "unknown".
 */
export default function DawarichGlobalSettings(): JSX.Element {
  const { t } = useTranslation(["admin", "trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DawarichTestResult | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void dawarichAdminApi
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        setBaseUrl(s.baseUrl ?? "");
        setApiKey(s.apiKey ?? "");
        setLoadError(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error("DawarichGlobalSettings: load failed", err);
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setTestResult(null);
    try {
      const url = baseUrl.trim();
      const key = apiKey.trim();
      const next = await dawarichAdminApi.updateSettings({
        baseUrl: url === "" ? null : url,
        apiKey: key === "" ? null : key,
      });
      setBaseUrl(next.baseUrl ?? "");
      setApiKey(next.apiKey ?? "");
      const cleared = next.baseUrl === null && next.apiKey === null;
      addToast(
        "success",
        t(cleared ? "admin:dawarichGlobal.cleared" : "admin:dawarichGlobal.saved")
      );
    } catch {
      // Never log the error object: its request config carries the typed key.
      logger.error("DawarichGlobalSettings: save failed");
      addToast("error", t("admin:dawarichGlobal.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: { baseUrl?: string; apiKey?: string } = {};
      if (baseUrl.trim() !== "") payload.baseUrl = baseUrl.trim();
      if (apiKey.trim() !== "") payload.apiKey = apiKey.trim();
      setTestResult(await dawarichAdminApi.testConnection(payload));
    } catch (err: unknown) {
      setTestResult({ success: false, message: "", kind: dawarichFailureKind(err) ?? undefined });
    } finally {
      setTesting(false);
    }
  };

  const sweep = async (): Promise<void> => {
    setSweeping(true);
    setSweepMsg(null);
    try {
      const r = await dawarichAdminApi.sweepNow();
      setSweepMsg({
        ok: r.failed === 0 && r.degraded === 0,
        text: t(
          r.failed === 0 && r.degraded === 0
            ? "admin:dawarichGlobal.sweep.done"
            : "admin:dawarichGlobal.sweep.doneWithFailures",
          {
            users: r.users,
            days: r.daysWritten,
            failed: r.failed + r.degraded,
          }
        ),
      });
    } catch (err: unknown) {
      logger.error("DawarichGlobalSettings: sweep failed", err);
      let text = t("admin:dawarichGlobal.sweep.failed");
      if (err instanceof JobLostError) text = t("admin:dawarichGlobal.sweep.lost");
      else if (apiErrorMachineCode(err) === "SWEEP_RUNNING")
        text = t("admin:dawarichGlobal.sweep.running");
      setSweepMsg({ ok: false, text });
    } finally {
      setSweeping(false);
    }
  };

  if (!loaded) return <p style={{ color: "var(--text-muted)" }}>{t("common:loading.title")}</p>;

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-rose-400">
          {t("admin:dawarichGlobal.loadFailed")}
        </p>
        <button
          type="button"
          className="btn-secondary w-fit px-3 py-1.5 text-sm"
          onClick={() => {
            setLoaded(false);
            setRetry((n) => n + 1);
          }}
        >
          {t("admin:dawarichGlobal.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="t-caption">{t("admin:dawarichGlobal.subtitle")}</p>
      <label className="flex flex-col gap-1 text-sm" htmlFor="dawarich-admin-base-url">
        <span>{t("admin:dawarichGlobal.baseUrl")}</span>
        <input
          id="dawarich-admin-base-url"
          className="input"
          placeholder="https://dawarich.example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor="dawarich-admin-api-key">
        <span>{t("admin:dawarichGlobal.apiKey")}</span>
        <input
          id="dawarich-admin-api-key"
          type="password"
          autoComplete="off"
          className="input"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <span className="t-caption">{t("admin:dawarichGlobal.apiKeyHint")}</span>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-sm"
          disabled={testing || saving}
          onClick={() => void test()}
        >
          {testing ? t("admin:dawarichGlobal.testing") : t("admin:dawarichGlobal.test")}
        </button>
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={saving || testing}
          onClick={() => void save()}
        >
          {saving ? t("admin:dawarichGlobal.saving") : t("admin:dawarichGlobal.save")}
        </button>
      </div>
      {testResult && (
        <p
          role="status"
          className={`text-sm ${testResult.success ? "text-emerald-400" : "text-rose-400"}`}
        >
          {testResult.success
            ? t("admin:dawarichGlobal.connected", { version: testResult.details?.version ?? "?" })
            : t(dawarichFailureKey(testResult.kind))}
        </p>
      )}

      <div
        className="flex flex-col gap-1 border-t pt-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="label">{t("admin:dawarichGlobal.sweep.title")}</span>
        <p className="t-caption">{t("admin:dawarichGlobal.sweep.description")}</p>
        <button
          type="button"
          className="btn-secondary w-fit px-3 py-1.5 text-sm"
          disabled={sweeping}
          onClick={() => void sweep()}
        >
          {sweeping
            ? t("admin:dawarichGlobal.sweep.running_")
            : t("admin:dawarichGlobal.sweep.action")}
        </button>
        {sweepMsg && (
          <p
            role={sweepMsg.ok ? "status" : "alert"}
            className={`text-sm ${sweepMsg.ok ? "text-emerald-400" : "text-rose-400"}`}
          >
            {sweepMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}
