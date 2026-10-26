import { useEffect, useState } from "react";
import type { JSX } from "react";
import { travTrackApi, travTrackErrorKey } from "../../lib/api/travtrack";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { Switch } from "../ui/Field";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";
import { useCapabilitiesEpochStore } from "../../store/capabilitiesEpochStore";

const NS = "admin:travTrack";

/**
 * Admin → Instanz → TravTrack (TravTrack plan, T1): the instance switch for the
 * own location history. Effective only while the beta switch is on — the
 * server answers `TRAVTRACK_DISABLED` otherwise, so with the beta key closed
 * the card says what to do first instead of drawing a switch that fails.
 * Switching off deletes nothing.
 */
export default function TravTrackSettings(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const { isFeatureVisible } = useBetaFeatures();
  const offered = isFeatureVisible("travTrack");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bumpCapabilities = useCapabilitiesEpochStore((s) => s.bump);

  useEffect(() => {
    if (!offered) return;
    let alive = true;
    travTrackApi.config().then(
      (config) => {
        if (alive) setEnabled(config.enabled);
      },
      (err: unknown) => {
        logger.error("Loading the TravTrack switch failed:", err);
        if (alive) setError(t(`${NS}.errors.loadFailed`));
      }
    );
    return () => {
      alive = false;
    };
  }, [offered, t]);

  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setEnabled((await travTrackApi.setConfig({ enabled: on })).enabled);
      bumpCapabilities("travTrack");
    } catch (err) {
      logger.error("Saving the TravTrack switch failed:", err);
      setError(t(travTrackErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      {!offered && <p className="t-caption">{t(`${NS}.needsBeta`)}</p>}
      {offered && enabled !== null && (
        <Switch
          id="travtrack-enabled"
          checked={enabled}
          disabled={busy}
          onChange={(on) => void toggle(on)}
          label={t(`${NS}.switch`)}
          sub={t(`${NS}.switchSub`)}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </SectionCard>
  );
}
