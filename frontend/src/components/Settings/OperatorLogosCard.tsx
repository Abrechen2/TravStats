import { useEffect, useState } from "react";
import type { JSX } from "react";

import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";

/**
 * Administration → Externe Dienste: may operator logos on the map cards come
 * from Wikidata and Wikimedia Commons (forgejo#323)? ON by default — unlike
 * the open data switch, the request carries only a company name the user
 * wrote, never a place or a date — and asked by the server, never the browser.
 *
 * Loads its own state. Shows the value the server CONFIRMED, never the one the
 * switch asked for; a failed load or save says so instead of guessing.
 */
export default function OperatorLogosCard(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<"load" | "save" | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getInstanceSettings()
      .then(({ settings }) => {
        if (!cancelled) setEnabled(settings.operatorLogosOpenDataEnabled);
      })
      .catch((err: unknown) => {
        logger.warn("Loading the operator logo switch failed", err);
        if (!cancelled) setFailed("load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (on: boolean): Promise<void> => {
    setSaving(true);
    setFailed(null);
    try {
      const { settings } = await adminApi.updateInstanceSettings({
        operatorLogosOpenDataEnabled: on,
      });
      setEnabled(settings.operatorLogosOpenDataEnabled);
    } catch (err) {
      logger.warn("Saving the operator logo switch failed", err);
      setFailed("save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("admin:operatorLogos.title")}
        description={t("admin:operatorLogos.description")}
      />
      <SettingRows>
        <Switch
          id="operator-logos-open-data"
          checked={enabled === true}
          disabled={saving || enabled === null}
          onChange={(on) => void toggle(on)}
          label={t("admin:operatorLogos.switch")}
          sub={t("admin:operatorLogos.switchSub")}
        />
        {failed && (
          <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t(
              failed === "load"
                ? "admin:operatorLogos.loadFailed"
                : "admin:operatorLogos.saveFailed"
            )}
          </p>
        )}
      </SettingRows>
    </SectionCard>
  );
}
