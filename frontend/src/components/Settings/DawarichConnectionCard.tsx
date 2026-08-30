import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { dawarichApi, dawarichFailureKey, dawarichFailureKind } from "../../lib/api/dawarich";
import type { DawarichConnectionStatus, DawarichTestResult } from "../../types/dawarich";

/**
 * User-facing Dawarich connection settings (phase 3b, task 8). Mirrors
 * `ImmichConnectionCard` closely on purpose (same doc comment on the
 * backend route, `routes/settings/dawarich.ts`), minus the link/import
 * mode toggle — Dawarich is pull-only location history, not albums, so
 * there is nothing to choose a default mode for.
 *
 * The API key is write-only: the backend returns `hasKey`, never the
 * value, so an empty key field means "leave the stored key alone" and the
 * explicit "remove key" action sends `null`.
 *
 * Copy lives under `trips:tours.dawarichSettings.*` rather than a
 * dedicated namespace — Dawarich only has one consumer in this app (the
 * tour track feature), so its settings copy sits alongside
 * `tours.tracks.*` instead of opening a fourth i18n file for six strings.
 */
export default function DawarichConnectionCard(): JSX.Element {
  const { t } = useTranslation("trips");

  const [status, setStatus] = useState<DawarichConnectionStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DawarichTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: DawarichConnectionStatus) => {
    setStatus(next);
    setBaseUrl(next.baseUrl ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await dawarichApi.getSettings();
        if (!cancelled) apply(next);
      } catch {
        // This GET hits OUR OWN API (`/settings/dawarich`), not Dawarich —
        // a session hiccup or a 500 here has nothing to do with the
        // Dawarich server, so it must not be reported as "Dawarich is
        // unreachable" (that message belongs to the `errors.*` vocabulary
        // used for calls that actually talk to Dawarich).
        if (!cancelled) setError(t("trips:tours.dawarichSettings.loadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, t]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      // An untouched key field must not overwrite the stored key. An empty
      // baseUrl is sent on purpose — the backend treats "" as "clear the
      // stored URL" — this is the only way the UI can express that.
      const payload: { baseUrl: string; apiKey?: string } = { baseUrl };
      if (apiKey.trim() !== "") payload.apiKey = apiKey.trim();

      apply(await dawarichApi.updateSettings(payload));
      setApiKey("");
    } catch (err) {
      // Preserve a machine-readable kind when the backend sent one (a
      // mistyped base URL comes back as `invalidUrl`) instead of always
      // reporting "Dawarich is unreachable" — this request never even
      // contacts Dawarich, so that label was actively wrong for the most
      // common failure (a typo).
      const kind = dawarichFailureKind(err);
      setError(t(kind ? dawarichFailureKey(kind) : "trips:tours.dawarichSettings.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      apply(await dawarichApi.updateSettings({ apiKey: null }));
      setApiKey("");
    } catch (err) {
      const kind = dawarichFailureKind(err);
      setError(t(kind ? dawarichFailureKey(kind) : "trips:tours.dawarichSettings.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      // Omit empty fields entirely rather than sending "": an admin-provided
      // connection leaves the user's own fields blank, and an empty body
      // means "test whatever is resolved for me" (user → global → ENV).
      const payload: { baseUrl?: string; apiKey?: string } = {};
      const trimmedUrl = baseUrl.trim();
      const trimmedKey = apiKey.trim();
      if (trimmedUrl !== "") payload.baseUrl = trimmedUrl;
      if (trimmedKey !== "") payload.apiKey = trimmedKey;
      setTestResult(await dawarichApi.testConnection(payload));
    } catch (err) {
      // A thrown error (network failure, or the "notConfigured" case for an
      // empty body with no stored connection) still maps onto the same
      // localized failure vocabulary.
      setTestResult({ success: false, message: "", kind: dawarichFailureKind(err) ?? undefined });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <header className="mb-3">
        <h3 className="text-lg font-semibold">{t("trips:tours.dawarichSettings.title")}</h3>
        <p className="text-sm text-slate-400">{t("trips:tours.dawarichSettings.subtitle")}</p>
        {status?.isShared && (
          <span className="text-xs text-amber-400">{t("trips:tours.dawarichSettings.shared")}</span>
        )}
      </header>

      <label className="block text-sm" htmlFor="dawarich-base-url">
        {t("trips:tours.dawarichSettings.baseUrl")}
      </label>
      <input
        id="dawarich-base-url"
        className="mb-3 w-full rounded-sm border border-slate-600 bg-slate-900 p-2"
        placeholder={t("trips:tours.dawarichSettings.baseUrlPlaceholder")}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />

      <label className="block text-sm" htmlFor="dawarich-api-key">
        {t("trips:tours.dawarichSettings.apiKey")}
      </label>
      <input
        id="dawarich-api-key"
        type="password"
        autoComplete="off"
        className="w-full rounded-sm border border-slate-600 bg-slate-900 p-2"
        placeholder={t("trips:tours.dawarichSettings.apiKeyPlaceholder")}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      {status?.hasKey && (
        <div className="mb-3 mt-1 flex items-center gap-2 text-xs text-slate-400">
          <span>{t("trips:tours.dawarichSettings.apiKeyStored")}</span>
          <button type="button" className="underline" onClick={() => void handleClearKey()}>
            {t("trips:tours.dawarichSettings.clearKey")}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          className="btn-primary px-3 py-1.5 text-sm"
          onClick={() => void handleSave()}
        >
          {saving
            ? t("trips:tours.dawarichSettings.saving")
            : t("trips:tours.dawarichSettings.save")}
        </button>
        <button
          type="button"
          disabled={testing}
          className="btn-secondary px-3 py-1.5 text-sm"
          onClick={() => void handleTest()}
        >
          {testing
            ? t("trips:tours.dawarichSettings.testing")
            : t("trips:tours.dawarichSettings.test")}
        </button>
      </div>

      {testResult && (
        <p className={`mt-2 text-sm ${testResult.success ? "text-emerald-400" : "text-rose-400"}`}>
          {testResult.success
            ? t("trips:tours.dawarichSettings.connected", {
                version: testResult.details?.version ?? "?",
              })
            : t(dawarichFailureKey(testResult.kind))}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </section>
  );
}
