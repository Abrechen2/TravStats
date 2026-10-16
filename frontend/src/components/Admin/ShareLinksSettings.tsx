import { useEffect, useState } from "react";
import type { JSX } from "react";
import { adminApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { Switch } from "../ui/Field";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";

const NS = "sharing:links.section";

/** Instance-wide permission, separate from the user's own public links. */
export default function ShareLinksSettings(): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    adminApi.getInstanceSettings().then(
      ({ settings }) => {
        if (alive) setEnabled(settings.shareLinksEnabled);
      },
      (error: unknown) => {
        logger.error("Loading the share-link instance setting failed:", error);
        if (alive) setLoadFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true);
    setSaveFailed(false);
    try {
      const { settings } = await adminApi.updateInstanceSettings({ shareLinksEnabled: on });
      setEnabled(settings.shareLinksEnabled);
    } catch (error) {
      logger.error("Saving the share-link instance setting failed:", error);
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.adminDescription`)} />
      {enabled !== null && (
        <Switch
          id="share-links-enabled"
          checked={enabled}
          disabled={busy}
          onChange={(on) => void toggle(on)}
          label={t(`${NS}.switch`)}
          sub={t(`${NS}.switchSub`)}
        />
      )}
      {loadFailed && <p role="alert">{t(`${NS}.loadFailed`)}</p>}
      {saveFailed && <p role="alert">{t(`${NS}.saveFailed`)}</p>}
    </SectionCard>
  );
}
