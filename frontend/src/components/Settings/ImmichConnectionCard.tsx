import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { failureKey, immichApi, immichFailureKind } from "../../lib/api/immich";
import type { ImmichConnectionStatus, ImmichMode, ImmichTestResult } from "../../types/immich";

/**
 * User-facing Immich connection settings.
 *
 * The API key is write-only: the backend returns `hasKey`, never the value, so
 * an empty key field means "leave the stored key alone" and the explicit
 * "remove key" action sends `null`.
 */
export default function ImmichConnectionCard(): JSX.Element {
  const { t } = useTranslation("immich");

  const [status, setStatus] = useState<ImmichConnectionStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultMode, setDefaultMode] = useState<ImmichMode>("link");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ImmichTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: ImmichConnectionStatus) => {
    setStatus(next);
    setBaseUrl(next.baseUrl ?? "");
    setDefaultMode(next.defaultMode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await immichApi.getSettings();
        if (!cancelled) apply(next);
      } catch {
        if (!cancelled) setError(t("errors.unreachable"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately mount-only: `t` gets a fresh function identity on every
    // render (useTranslation does not memoize it), so including it here
    // would re-run this effect — and re-fetch + re-apply the stored
    // connection, clobbering in-progress edits — on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      // An untouched key field must not overwrite the stored key.
      const payload: { baseUrl: string; defaultMode: ImmichMode; apiKey?: string } = {
        baseUrl,
        defaultMode,
      };
      if (apiKey.trim() !== "") payload.apiKey = apiKey.trim();

      apply(await immichApi.updateSettings(payload));
      setApiKey("");
    } catch {
      setError(t("errors.unreachable"));
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async (): Promise<void> => {
    setSaving(true);
    try {
      apply(await immichApi.updateSettings({ apiKey: null }));
      setApiKey("");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      // Omit empty fields entirely rather than sending "": an admin-provided
      // connection leaves the user's own fields blank, and an empty body means
      // "test whatever is resolved for me" (user → admin global → ENV).
      const payload: { baseUrl?: string; apiKey?: string } = {};
      const trimmedUrl = baseUrl.trim();
      const trimmedKey = apiKey.trim();
      if (trimmedUrl !== "") payload.baseUrl = trimmedUrl;
      if (trimmedKey !== "") payload.apiKey = trimmedKey;
      setTestResult(await immichApi.testConnection(payload));
    } catch (err) {
      // A thrown error (network failure, or a 409/400 carrying a kind such as
      // `notConfigured`) still maps onto the same localized failure vocabulary.
      setTestResult({ success: false, message: "", kind: immichFailureKind(err) ?? undefined });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <header className="mb-3">
        <h3 className="text-lg font-semibold">{t("title")}</h3>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
        {status?.isShared && <span className="text-xs text-amber-400">{t("shared")}</span>}
      </header>

      <label className="block text-sm" htmlFor="immich-base-url">
        {t("baseUrl")}
      </label>
      <input
        id="immich-base-url"
        className="mb-3 w-full rounded-sm border border-slate-600 bg-slate-900 p-2"
        placeholder={t("baseUrlPlaceholder")}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />

      <label className="block text-sm" htmlFor="immich-api-key">
        {t("apiKey")}
      </label>
      <input
        id="immich-api-key"
        type="password"
        autoComplete="off"
        className="w-full rounded-sm border border-slate-600 bg-slate-900 p-2"
        placeholder={t("apiKeyPlaceholder")}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      {status?.hasKey && (
        <div className="mb-3 mt-1 flex items-center gap-2 text-xs text-slate-400">
          <span>{t("apiKeyStored")}</span>
          <button type="button" className="underline" onClick={() => void handleClearKey()}>
            {t("clearKey")}
          </button>
        </div>
      )}

      <fieldset className="my-3">
        <legend className="text-sm">{t("defaultMode")}</legend>
        {(["link", "import"] as const).map((mode) => (
          <label key={mode} className="mr-4 inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="immich-default-mode"
              checked={defaultMode === mode}
              onChange={() => setDefaultMode(mode)}
            />
            {mode === "link" ? t("modeLink") : t("modeImport")}
          </label>
        ))}
        <p className="text-xs text-slate-400">
          {defaultMode === "link" ? t("modeLinkHint") : t("modeImportHint")}
        </p>
      </fieldset>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          className="btn-primary px-3 py-1.5 text-sm"
          onClick={() => void handleSave()}
        >
          {saving ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          disabled={testing}
          className="btn-secondary px-3 py-1.5 text-sm"
          onClick={() => void handleTest()}
        >
          {testing ? t("testing") : t("test")}
        </button>
      </div>

      {testResult && (
        <p className={`mt-2 text-sm ${testResult.success ? "text-emerald-400" : "text-rose-400"}`}>
          {testResult.success
            ? t("connected", { version: testResult.details?.version ?? "?" })
            : t(failureKey(testResult.kind))}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </section>
  );
}
