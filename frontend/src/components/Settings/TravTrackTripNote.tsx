import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { settingsApi } from "../../lib/api/settings";
import { logger } from "../../lib/logger";

const NS = "track:settings";

/**
 * Why TravTrack asks about no trip (TravTrack plan L4): away periods are
 * measured from a CONFIRMED residence, and without one nothing is inferred.
 * Shown only when the account has none; a failed read shows nothing rather
 * than a claim it could not check.
 */
export default function TravTrackTripNote(): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    settingsApi
      .getHomeAirports()
      .then(({ periods }) => {
        if (live) setConfirmed(periods.some((p) => p.residenceConfirmed && p.residence));
      })
      .catch((err) => logger.warn("TravTrack settings: home periods not loaded", err));
    return () => {
      live = false;
    };
  }, []);
  if (confirmed !== false) return null;
  return (
    <p className="t-caption" role="status" data-testid="travtrack-trips-no-residence">
      {t(`${NS}.tripsNoResidence`)}
    </p>
  );
}
