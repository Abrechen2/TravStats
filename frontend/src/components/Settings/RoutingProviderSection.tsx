import { useCallback, useEffect, useState } from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import ApiKeyCard from "./ApiKeyCard";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { ROUTING_PROVIDER_IDS, type RoutingProviderId } from "../../types/tour";

type LoadStatus = "loading" | "error" | "ready";

/** The `<select>`'s own vocabulary — `""` stands in for "no provider
 *  selected" (`routingProvider: null` on the wire), since a native
 *  `<select>` option value is always a string. */
type ProviderChoice = RoutingProviderId | "";

interface RoutingProviderSectionProps {
  isAdmin: boolean;
}

/**
 * Admin-only "Routing provider" card (Task 7, phase 3): which provider
 * powers "Route this leg" / "Route the whole section" across every tour on
 * the instance, plus that provider's own connection field.
 *
 * There is deliberately no per-user provider CHOICE — `routingProvider`/
 * `routingCustomUrl` live only on `AdminSettings` (see
 * `backend/src/services/tour/routing/resolveProvider.ts`'s own doc
 * comment). What a per-user key CAN override is which OpenRouteService/
 * GraphHopper key is actually used — that per-user override already has
 * no dedicated UI here either; only the operator's global key is offered.
 *
 * Follows the established `GeocoderSettingsCard` shape for this same
 * problem (another admin-only setting embedded in the general Settings
 * page, gated by an `isAdmin` prop, self-contained load/save): a failed
 * GET renders an explicit error state with NO fields and NO way to save,
 * never an empty form whose Save would silently clear a working
 * configuration.
 *
 * The provider-specific field is the part that changes shape: only the
 * field the CHOSEN provider actually needs is rendered — a key (via the
 * existing `ApiKeyCard`, `isAdmin` so it tests against
 * `/admin/api-keys/test/<provider>`, the same "provider card" component
 * every other flight-lookup key on this page already uses) for the two
 * hosted services, a plain base-URL input for a self-hosted OSRM. There is
 * no test button for "custom" — no backend test endpoint exists for an
 * arbitrary OSRM URL, so offering one would be a control whose only
 * outcome is an error.
 */
export default function RoutingProviderSection({
  isAdmin,
}: RoutingProviderSectionProps): JSX.Element | null {
  const { t } = useTranslation(["settings", "common"]);

  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [provider, setProvider] = useState<ProviderChoice>("");
  const [customUrl, setCustomUrl] = useState("");
  const [orsKey, setOrsKey] = useState("");
  const [ghKey, setGhKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Mount-only fetch — `t` is not guaranteed referentially stable across
  // renders (same rationale as `GeocoderSettingsCard`/`InstanceSettings`,
  // #190), so depending on it here would re-trigger the load on every
  // re-render and stomp on whatever the admin is currently typing.
  const load = useCallback(async () => {
    setLoadStatus("loading");
    try {
      const keys = await adminApi.getGlobalApiKeys();
      setProvider(keys.routingProvider ?? "");
      setCustomUrl(keys.routingCustomUrl ?? "");
      setOrsKey(keys.globalOpenrouteserviceApiKey ?? "");
      setGhKey(keys.globalGraphhopperApiKey ?? "");
      setLoadStatus("ready");
    } catch (err) {
      logger.error("Failed to load routing provider settings", err);
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
    setSaving(true);
    setSaveMessage(null);
    try {
      const result = await adminApi.updateGlobalApiKeys({
        routingProvider: provider === "" ? null : provider,
        routingCustomUrl: customUrl.trim() || null,
        globalOpenrouteserviceApiKey: orsKey,
        globalGraphhopperApiKey: ghKey,
      });
      setSaveMessage({ ok: true, text: result.message || t("settings:routing.saveSuccess") });
      // Re-load so masked key echoes and the normalised custom URL (the
      // backend trims a trailing slash — see `normalizeRoutingCustomUrl`)
      // reflect what was actually persisted, not just what was typed.
      await load();
    } catch (err) {
      logger.error("Failed to save routing provider settings", err);
      setSaveMessage({ ok: false, text: t("settings:routing.saveError") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:routing.title")}
        description={t("settings:routing.description")}
      />

      {loadStatus === "loading" && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }} data-testid="routing-loading">
          {t("common:loading.title")}
        </p>
      )}

      {loadStatus === "error" && (
        <div className="space-y-2" data-testid="routing-load-error">
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {t("settings:routing.loadError")}
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
            {t("settings:routing.retry")}
          </button>
        </div>
      )}

      {loadStatus === "ready" && (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="routing-provider-select">
              {t("settings:routing.providerLabel")}
            </label>
            <select
              id="routing-provider-select"
              className="input"
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderChoice)}
            >
              <option value="">{t("settings:routing.provider.none")}</option>
              {ROUTING_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`settings:routing.provider.${id}`)}
                </option>
              ))}
            </select>
          </div>

          {provider === "" && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings:routing.noneHint")}
            </p>
          )}

          {provider === "openrouteservice" && (
            <ApiKeyCard
              provider="openrouteservice"
              label={t("settings:routing.openrouteservice.label")}
              description={t("settings:routing.openrouteservice.description")}
              getKeyUrl="https://openrouteservice.org/dev/#/signup"
              isShared={false}
              hasAccess={!!orsKey}
              value={orsKey}
              onChange={setOrsKey}
              onClear={() => setOrsKey("")}
              isAdmin
            />
          )}

          {provider === "graphhopper" && (
            <ApiKeyCard
              provider="graphhopper"
              label={t("settings:routing.graphhopper.label")}
              description={t("settings:routing.graphhopper.description")}
              getKeyUrl="https://www.graphhopper.com/dashboard/#/register"
              isShared={false}
              hasAccess={!!ghKey}
              value={ghKey}
              onChange={setGhKey}
              onClear={() => setGhKey("")}
              isAdmin
            />
          )}

          {provider === "custom" && (
            <div>
              <label className="label" htmlFor="routing-custom-url">
                {t("settings:routing.customUrlLabel")}
              </label>
              <input
                id="routing-custom-url"
                type="url"
                className="input"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                // Deliberately not routed through t() (Task 8): an example
                // domain is the same literal in every locale, and
                // `customUrlHint` already spells it out in translated prose.
                placeholder="https://osrm.example.com"
              />
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings:routing.customUrlHint")}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md font-medium disabled:opacity-50"
              style={{ background: "var(--accent)", color: "var(--bg-base)" }}
            >
              {saving ? t("common:buttons.saving") : t("common:buttons.save")}
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
        </div>
      )}
    </SectionCard>
  );
}
