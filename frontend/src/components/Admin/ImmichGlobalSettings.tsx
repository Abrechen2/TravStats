import { useEffect, useState } from "react";
import { failureKey, immichApi, immichFailureKind } from "../../lib/api/immich";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { ImmichTestResult } from "../../types/immich";

/** Best-effort extraction of an HTTP status from an axios-shaped error, without
 * logging the error object itself (which, on the save path, carries the
 * request body — i.e. the freshly typed plaintext API key). */
function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { response?: { status?: unknown } }).response?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Instance-wide Immich connection (tier 2 of the resolver: user → admin-global
 * → env). Self-contained on purpose — AdminPage is already over its line budget
 * and must not grow another block of state.
 *
 * The API key round-trips MASKED. Echoing the mask back in the PUT is how the
 * backend (`looksMasked`) recognises "unchanged" — and an EMPTY string is also
 * treated as "unchanged" by `looksMasked` (`!value`), so it is a no-op, not a
 * wipe (Zod's `.min(1)` would reject it before that anyway). What actually
 * clears a field is an explicit `null`, which `handleSave` sends below when the
 * trimmed field is empty.
 *
 * A failed initial load must never render the editable form: baseUrl/apiKey
 * stay at their "" initial state, which is visually identical to "nothing
 * configured yet". If the form rendered anyway, clicking save would PUT
 * {baseUrl: null, apiKey: null} and the backend would execute that as an
 * explicit CLEAR of whatever connection is actually stored — so a transient
 * GET failure (500, timeout, blip) could silently destroy a working
 * connection the admin never even saw. `loadError` gates the form instead.
 */
export default function ImmichGlobalSettings(): JSX.Element {
  const { t } = useTranslation(["immich", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ImmichTestResult | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void immichApi
      .getAdminSettings()
      .then((settings) => {
        if (cancelled) return;
        setBaseUrl(settings.baseUrl ?? "");
        setApiKey(settings.apiKey ?? "");
        setLoadError(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.debug("failed to load global immich settings", { status: errorStatus(error) });
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  const handleRetryLoad = (): void => {
    setLoaded(false);
    setRetryToken((n) => n + 1);
  };

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
      // "cleared" must only be claimed once the connection is actually gone. If
      // only one field was cleared (e.g. baseUrl:null with the key's mask echoed
      // back), the backend's `looksMasked()` guard keeps the stored key and the
      // response still carries a non-null apiKey — that is a partial save, not a
      // removal, so the message must say "saved".
      const fullyCleared = next.baseUrl === null && next.apiKey === null;
      addToast("success", fullyCleared ? t("admin.cleared") : t("admin.saved"));
    } catch (error) {
      // Never log the raw error here: for an axios error, `error.config.data`
      // is the REQUEST BODY, which on this path contains the freshly typed
      // plaintext API key. Log only a status code.
      logger.debug("failed to save global immich settings", { status: errorStatus(error) });
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
      // when a field is absent. `immichTestSchema` already coerces an empty
      // string to `undefined` before validation (`optionalConnectionField`), so
      // this omission isn't a workaround for `.min(1)` — it's just clearer than
      // relying on that preprocessing step.
      const payload: { baseUrl?: string; apiKey?: string } = {};
      if (trimmedUrl !== "") payload.baseUrl = trimmedUrl;
      if (trimmedKey !== "") payload.apiKey = trimmedKey;
      setTestResult(await immichApi.testAdminConnection(payload));
    } catch (error) {
      // A thrown error carries the same machine-readable `kind` vocabulary as a
      // 200 with success:false, so both paths render through failureKey.
      setTestResult({
        success: false,
        message: "",
        kind: immichFailureKind(error) ?? undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) {
    return <p style={{ color: "var(--text-muted)" }}>{t("common:loading.title")}</p>;
  }

  if (loadError) {
    return (
      <section className="flex flex-col gap-3 p-6">
        <div>
          <h3 className="font-medium" style={{ color: "var(--text-primary)" }}>
            {t("admin.title")}
          </h3>
        </div>
        <p className="text-sm text-rose-400">{t("admin.loadFailed")}</p>
        <button
          type="button"
          onClick={handleRetryLoad}
          className="w-fit rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        >
          {t("errors.retry")}
        </button>
      </section>
    );
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
          className="w-full rounded-sm border p-2"
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
          type="password"
          autoComplete="off"
          className="w-full rounded-sm border p-2"
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
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          {testing ? t("admin.testing") : t("admin.test")}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || testing}
          className="btn-primary px-3 py-1.5 text-sm"
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
