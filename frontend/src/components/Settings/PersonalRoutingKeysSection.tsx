import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import ApiKeyCard from "./ApiKeyCard";
import DemoLockedNotice from "./DemoLockedNotice";
import { SettingRows } from "../ui/SettingRow";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { settingsApi } from "../../lib/api";
import { logger } from "../../lib/logger";

type RoutingKeyProvider = "openrouteservice" | "graphhopper";
type KeyStatus = { hasKey: boolean; isShared: boolean; hasAccess: boolean };
type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; status: Record<RoutingKeyProvider, KeyStatus> };

const FIELD: Record<RoutingKeyProvider, "openrouteserviceApiKey" | "graphhopperApiKey"> = {
  openrouteservice: "openrouteserviceApiKey",
  graphhopper: "graphhopperApiKey",
};
const KEY_URL: Record<RoutingKeyProvider, string> = {
  openrouteservice: "https://openrouteservice.org/dev/#/signup",
  graphhopper: "https://graphhopper.com/dashboard/#/register",
};
const PROVIDERS: readonly RoutingKeyProvider[] = ["openrouteservice", "graphhopper"];

/**
 * The ACCOUNT's own routing keys, on the personal settings page.
 *
 * Which provider routes a tour is an instance setting (admin only,
 * `admin_settings.routing_provider`). The KEY resolves per request as user →
 * instance → environment (`services/apiKeyResolver.ts` `getApiKey`, read by
 * `services/tour/routing/resolveProvider.ts`). Until 2026-09-26 this page
 * showed admins the INSTANCE card instead, worded "used as the global key for
 * everyone as long as nobody stores their own" — on a page whose header says
 * its settings are yours, offering a per-user key there was no way to store
 * (Alex, Discord 2026-09-26). The instance card lives in Administration →
 * Externe Dienste now; this is the per-user half.
 *
 * Saves only the field the reader typed or cleared. The flight-key form next
 * door sends every field, empty ones included, and the server stores an empty
 * string as "no key" — a routing key must not vanish because a flight key was
 * saved, nor the other way round.
 */
export default function PersonalRoutingKeysSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const isDemo = useIsDemoAccount();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [drafts, setDrafts] = useState<Partial<Record<RoutingKeyProvider, string | null>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const all = await settingsApi.getApiKeys();
      setLoad({
        kind: "ready",
        status: { openrouteservice: all.openrouteservice, graphhopper: all.graphhopper },
      });
    } catch (err: unknown) {
      logger.error("PersonalRoutingKeysSection: load failed", err);
      setLoad({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (): Promise<void> => {
    const payload: Partial<Record<(typeof FIELD)[RoutingKeyProvider], string | null>> = {};
    for (const provider of PROVIDERS) {
      const draft = drafts[provider];
      if (draft === undefined) continue;
      // An emptied field is an explicit "remove my key", sent as null.
      payload[FIELD[provider]] = draft === null || draft.trim() === "" ? null : draft.trim();
    }
    if (Object.keys(payload).length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      await settingsApi.updateApiKeys(payload);
      setDrafts({});
      setMessage({ ok: true, text: t("settings:routingPersonal.saved") });
      await reload();
    } catch (err: unknown) {
      logger.error("PersonalRoutingKeysSection: save failed", err);
      setMessage({ ok: false, text: t("settings:routingPersonal.saveError") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:routingPersonal.title")}
        description={t("settings:routingPersonal.description")}
      />
      {load.kind === "loading" && <p className="t-caption">{t("common:buttons.loading")}</p>}
      {load.kind === "error" && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t("settings:routingPersonal.loadError")}
        </p>
      )}
      {load.kind === "ready" && (
        <>
          <SettingRows>
            {PROVIDERS.map((provider) => (
              <ApiKeyCard
                key={provider}
                layout="row"
                provider={provider}
                whenUnreachable={t("settings:unreachable.routing")}
                label={t(`settings:routingPersonal.${provider}.label`)}
                description={t(`settings:routingPersonal.${provider}.description`)}
                getKeyUrl={KEY_URL[provider]}
                isShared={load.status[provider].isShared}
                hasAccess={load.status[provider].hasAccess}
                hasOwnKey={load.status[provider].hasKey}
                value={drafts[provider] ?? ""}
                onChange={(value) => setDrafts((prev) => ({ ...prev, [provider]: value }))}
                onClear={() => setDrafts((prev) => ({ ...prev, [provider]: null }))}
              />
            ))}
          </SettingRows>
          {/* The key card cannot show a stored key (the server never sends it
              back), so it has nothing to clear; removing one's own key is its
              own control. */}
          {PROVIDERS.filter((p) => load.status[p].hasKey && drafts[p] !== null).map((provider) => (
            <button
              key={provider}
              type="button"
              data-testid={`routing-personal-remove-${provider}`}
              onClick={() => setDrafts((prev) => ({ ...prev, [provider]: null }))}
              className="text-xs hover:underline"
              style={{ color: "var(--ts-bad)", fontWeight: 600 }}
            >
              {t(`settings:routingPersonal.${provider}.remove`)}
            </button>
          ))}
          {PROVIDERS.filter((p) => drafts[p] === null).map((provider) => (
            <p key={provider} className="t-caption">
              {t(`settings:routingPersonal.${provider}.removePending`)}
            </p>
          ))}
          {message !== null && (
            <p
              className="t-caption"
              role={message.ok ? "status" : "alert"}
              style={{ color: message.ok ? "var(--ts-good)" : "var(--ts-bad)" }}
            >
              {message.text}
            </p>
          )}
          <div
            className="flex justify-end pt-4"
            style={{ borderTop: "1px solid var(--ts-border)" }}
          >
            {isDemo ? (
              <DemoLockedNotice />
            ) : (
              <button
                type="button"
                data-testid="routing-personal-save"
                onClick={() => void save()}
                disabled={saving || Object.keys(drafts).length === 0}
                className="btn-primary"
              >
                {saving ? t("common:buttons.saving") : t("common:buttons.save")}
              </button>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}
