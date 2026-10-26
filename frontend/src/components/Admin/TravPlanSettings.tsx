import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { travplanApi, travPlanErrorKey } from "../../lib/api/travplan";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { Switch } from "../ui/Field";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";

const NS = "admin:travPlan";

/**
 * Admin → Instanz → TravPlan (owner, 2026-10-26): the instance switch for the
 * planning mode, as TravTrack has one. The section is registered behind the
 * `travPlan` beta key (`adminSections.ts`), so it is only drawn while the
 * server would accept the save at all.
 *
 * It saves `{enabled}` alone: the daily limits live on `/plan/admin`, which
 * edits the same `travel_plan_config` row, and a switch flipped here must not
 * write back limits it loaded minutes ago.
 */
export default function TravPlanSettings(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    travplanApi.config().then(
      (config) => {
        if (alive) setEnabled(config.enabled);
      },
      (err: unknown) => {
        logger.error("Loading the TravPlan switch failed:", err);
        if (alive) setError(t(`${NS}.errors.loadFailed`));
      }
    );
    return () => {
      alive = false;
    };
  }, [t]);

  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setEnabled((await travplanApi.setConfig({ enabled: on })).enabled);
    } catch (err) {
      logger.error("Saving the TravPlan switch failed:", err);
      setError(t(travPlanErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      {enabled !== null && (
        <>
          <Switch
            id="travplan-enabled"
            checked={enabled}
            disabled={busy}
            onChange={(on) => void toggle(on)}
            label={t(`${NS}.switch`)}
            sub={t(`${NS}.switchSub`)}
          />
          <Link to="/plan/admin" className="t-caption underline">
            {t(`${NS}.moreLink`)}
          </Link>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </SectionCard>
  );
}
