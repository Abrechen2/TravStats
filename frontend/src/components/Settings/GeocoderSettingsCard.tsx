import { useCallback, useEffect, useState } from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import { searchPlaces } from "../../lib/api/geo";
import { logger } from "../../lib/logger";

const DEFAULT_PHOTON_URL = "https://photon.komoot.io";
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const TEST_QUERY = "Berlin";

type LoadStatus = "loading" | "error" | "ready";
type TestStatus = "idle" | "loading" | "ok" | "empty" | "error";

interface GeocoderSettingsCardProps {
  isAdmin: boolean;
}

interface LoadedGeocoderUrls {
  photonUrl: string;
  nominatimUrl: string;
}

/**
 * Admin-only "Geocoder" card on the lodging settings tab (owner directive,
 * plan Task 11). Lets an admin point Photon (search-as-you-type) and
 * Nominatim (one-shot geocode) at a self-hosted instance instead of the
 * public defaults — both resolved backend-side via `resolveGeocoderUrls()`
 * (DB override > ENV > public default).
 *
 * GUARD (Immich near-miss recorded in ROADMAP): the Immich admin card once
 * rendered an empty form when its GET failed — indistinguishable from
 * "nothing configured" — and the next Save sent nulls, silently clearing
 * the stored connection. This card gates on an explicit `loadStatus`: a
 * failed GET renders an error state with NO input fields and NO way to
 * save, so a transient load failure can never clobber a working config.
 */
export default function GeocoderSettingsCard({
  isAdmin,
}: GeocoderSettingsCardProps): JSX.Element | null {
  const { t } = useTranslation(["settings", "common"]);

  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [photonUrl, setPhotonUrl] = useState("");
  const [nominatimUrl, setNominatimUrl] = useState("");
  // Snapshot of the values as last returned by the backend (GET or PUT
  // response). GET always returns RESOLVED urls — never null — so on a
  // fresh instance the inputs are pre-filled with the literal default
  // (e.g. https://photon.komoot.io). Comparing against this snapshot lets
  // handleSave detect "nothing was actually edited" and skip sending that
  // resolved default back as an explicit DB override (see finding: an
  // untouched Save would otherwise pin the default forever and silently
  // ignore future ENV/default changes).
  const [loaded, setLoaded] = useState<LoadedGeocoderUrls | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);

  // Mount-only fetch, same rationale as `InstanceSettings.tsx` (#190): `t`
  // is not guaranteed referentially stable across renders, so depending on
  // it here would re-trigger the load on every re-render and stomp on
  // whatever the admin is currently typing.
  const load = useCallback(async () => {
    setLoadStatus("loading");
    try {
      const { settings } = await adminApi.getInstanceSettings();
      setPhotonUrl(settings.photonUrl);
      setNominatimUrl(settings.nominatimUrl);
      setLoaded({ photonUrl: settings.photonUrl, nominatimUrl: settings.nominatimUrl });
      setLoadStatus("ready");
    } catch (err) {
      logger.error("Failed to load geocoder settings", err);
      setLoadStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  // Visible to admins only — non-admins never even trigger the GET.
  if (!isAdmin) return null;

  const handleSave = async (): Promise<void> => {
    const trimmedPhotonUrl = photonUrl.trim();
    const trimmedNominatimUrl = nominatimUrl.trim();

    // Per-field dirty tracking: only include a field in the patch when it
    // actually differs from what was loaded. An absent key means
    // "unchanged" on the backend (instancePatchSchema fields are all
    // `.optional()`), so an untouched field never gets re-sent as an
    // explicit override.
    const patch: { photonUrl?: string; nominatimUrl?: string } = {};
    if (loaded === null || trimmedPhotonUrl !== loaded.photonUrl) {
      patch.photonUrl = trimmedPhotonUrl;
    }
    if (loaded === null || trimmedNominatimUrl !== loaded.nominatimUrl) {
      patch.nominatimUrl = trimmedNominatimUrl;
    }

    setSaving(true);
    setSaveMessage(null);
    try {
      if (Object.keys(patch).length === 0) {
        // Nothing was edited — skip the PUT entirely so we never pin the
        // resolved default (or the current override) back into the DB.
        setSaveMessage({ ok: true, text: t("settings:lodgingPreferences.geocoder.saveSuccess") });
        return;
      }
      const { settings } = await adminApi.updateInstanceSettings(patch);
      setPhotonUrl(settings.photonUrl);
      setNominatimUrl(settings.nominatimUrl);
      setLoaded({ photonUrl: settings.photonUrl, nominatimUrl: settings.nominatimUrl });
      setSaveMessage({ ok: true, text: t("settings:lodgingPreferences.geocoder.saveSuccess") });
    } catch (err) {
      logger.error("Failed to save geocoder settings", err);
      setSaveMessage({ ok: false, text: t("settings:lodgingPreferences.geocoder.saveError") });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTestStatus("loading");
    setTestMessage(null);
    try {
      const results = await searchPlaces(TEST_QUERY);
      if (results.length > 0) {
        setTestStatus("ok");
        setTestMessage(
          t("settings:lodgingPreferences.geocoder.testSuccess", { count: results.length })
        );
      } else {
        // Zero hits is still a SUCCESSFUL connection (the copy says so) —
        // a distinct "empty" status keeps this out of the error/red
        // styling reserved for an actual connection failure.
        setTestStatus("empty");
        setTestMessage(t("settings:lodgingPreferences.geocoder.testEmpty"));
      }
    } catch (err) {
      logger.error("Geocoder connection test failed", err);
      setTestStatus("error");
      setTestMessage(t("settings:lodgingPreferences.geocoder.testError"));
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:lodgingPreferences.geocoder.title")}
        description={t("settings:lodgingPreferences.geocoder.description")}
      />

      {loadStatus === "loading" && (
        <p
          className="text-sm"
          style={{ color: "var(--text-muted)" }}
          data-testid="geocoder-loading"
        >
          {t("common:loading.title")}
        </p>
      )}

      {loadStatus === "error" && (
        <div className="space-y-2" data-testid="geocoder-load-error">
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {t("settings:lodgingPreferences.geocoder.loadError")}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1.5 text-sm rounded-md"
            style={{
              background: "transparent",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
          >
            {t("settings:lodgingPreferences.geocoder.retry")}
          </button>
        </div>
      )}

      {loadStatus === "ready" && (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="geocoder-photon-url">
              {t("settings:lodgingPreferences.geocoder.photonUrlLabel")}
            </label>
            <input
              id="geocoder-photon-url"
              type="url"
              className="input"
              value={photonUrl}
              onChange={(e) => setPhotonUrl(e.target.value)}
              placeholder={DEFAULT_PHOTON_URL}
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("settings:lodgingPreferences.geocoder.photonUrlHint")}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="geocoder-nominatim-url">
              {t("settings:lodgingPreferences.geocoder.nominatimUrlLabel")}
            </label>
            <input
              id="geocoder-nominatim-url"
              type="url"
              className="input"
              value={nominatimUrl}
              onChange={(e) => setNominatimUrl(e.target.value)}
              placeholder={DEFAULT_NOMINATIM_URL}
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("settings:lodgingPreferences.geocoder.nominatimUrlHint")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md font-medium disabled:opacity-50"
              style={{ background: "var(--accent)", color: "var(--bg-base)" }}
            >
              {saving ? t("common:buttons.saving") : t("common:buttons.save")}
            </button>
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testStatus === "loading"}
              className="px-3 py-1.5 text-sm rounded-md disabled:opacity-50"
              style={{
                background: "transparent",
                border: "1px solid var(--color-border)",
                color: "var(--text-primary)",
              }}
            >
              {testStatus === "loading"
                ? t("settings:lodgingPreferences.geocoder.testing")
                : t("settings:lodgingPreferences.geocoder.testButton")}
            </button>
          </div>

          {saveMessage && (
            <p
              className="text-sm"
              style={{ color: saveMessage.ok ? "var(--success)" : "var(--danger)" }}
            >
              {saveMessage.text}
            </p>
          )}
          {testMessage && (
            <p
              className="text-sm"
              style={{ color: testStatus === "error" ? "var(--danger)" : "var(--success)" }}
            >
              {testMessage}
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
