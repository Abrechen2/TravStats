import { useEffect, useState } from "react";
import { failureKey, immichApi, isImmichFailureKind } from "../../lib/api/immich";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { ImmichTestResult } from "../../types/immich";

/**
 * Instance-wide Immich connection (tier 2 of the resolver: user → admin-global
 * → env). Self-contained on purpose — AdminPage is already over its line budget
 * and must not grow another block of state.
 *
 * The API key round-trips MASKED. Echoing the mask back in the PUT is how the
 * backend (`looksMasked`) recognises "unchanged"; sending an empty string would
 * be a real value and would wipe the stored key. Sending `null` clears it.
 */
export default function ImmichGlobalSettings(): JSX.Element {
  const { t } = useTranslation(["immich", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ImmichTestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void immichApi
      .getAdminSettings()
      .then((settings) => {
        if (cancelled) return;
        setBaseUrl(settings.baseUrl ?? "");
        setApiKey(settings.apiKey ?? "");
      })
      .catch((error: unknown) => logger.debug("failed to load global immich settings", error))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setTestResult(null);
    const trimmedUrl = baseUrl.trim();
    const trimmedKey = apiKey.trim();
    try {
      // An empty field is an explicit "remove this"; a filled one is sent as-is
      // (a masked key means "keep the stored one" to the backend).
      const next = await immichApi.updateAdminSettings({
        baseUrl: trimmedUrl === "" ? null : trimmedUrl,
        apiKey: trimmedKey === "" ? null : trimmedKey,
      });
      setBaseUrl(next.baseUrl ?? "");
      setApiKey(next.apiKey ?? "");
      addToast("success", next.baseUrl === null ? t("admin.cleared") : t("admin.saved"));
    } catch (error) {
      logger.debug("failed to save global immich settings", error);
      addToast("error", t("admin.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    const trimmedUrl = baseUrl.trim();
    const trimmedKey = apiKey.trim();
    try {
      // Omit empty fields entirely: the route falls back to the STORED pair only
      // when they are absent. An empty string would trip the schema's .min(1).
      const payload: { baseUrl?: string; apiKey?: string } = {};
      if (trimmedUrl !== "") payload.baseUrl = trimmedUrl;
      if (trimmedKey !== "") payload.apiKey = trimmedKey;
      setTestResult(await immichApi.testAdminConnection(payload));
    } catch (error) {
      // A thrown error carries the same machine-readable `kind` vocabulary as a
      // 200 with success:false, so both paths render through failureKey.
      const kind = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
      setTestResult({
        success: false,
        message: "",
        kind: isImmichFailureKind(kind) ? kind : undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) {
    return <p style={{ color: "var(--text-muted)" }}>{t("common:loading.title")}</p>;
  }

  return (
    <section className="flex flex-col gap-4 p-6">
      <div>
        <h3 className="font-medium" style={{ color: "var(--text-primary)" }}>
          {t("admin.title")}
        </h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("admin.subtitle")}
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm" htmlFor="immich-admin-base-url">
        <span style={{ color: "var(--text-primary)" }}>{t("admin.baseUrl")}</span>
        <input
          id="immich-admin-base-url"
          className="w-full rounded border p-2"
          style={{ borderColor: "var(--color-border)", background: "var(--bg-elevated)" }}
          placeholder={t("admin.baseUrlPlaceholder")}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm" htmlFor="immich-admin-api-key">
        <span style={{ color: "var(--text-primary)" }}>{t("admin.apiKey")}</span>
        <input
          id="immich-admin-api-key"
          className="w-full rounded border p-2"
          style={{ borderColor: "var(--color-border)", background: "var(--bg-elevated)" }}
          placeholder={t("admin.apiKeyPlaceholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("admin.apiKeyHint")}
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing || saving}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          style={{ borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        >
          {testing ? t("admin.testing") : t("admin.test")}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || testing}
          className="rounded-md px-3 py-1.5 text-sm bg-blue-600 text-white disabled:opacity-50"
        >
          {saving ? t("admin.saving") : t("admin.save")}
        </button>
      </div>

      {testResult && (
        <p className={`text-sm ${testResult.success ? "text-emerald-400" : "text-rose-400"}`}>
          {testResult.success
            ? t("connected", { version: testResult.details?.version ?? "?" })
            : t(failureKey(testResult.kind))}
        </p>
      )}
    </section>
  );
}
