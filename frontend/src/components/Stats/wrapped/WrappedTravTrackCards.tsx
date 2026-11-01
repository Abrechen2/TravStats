import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { formatDistance, formatHoursValue, localeForLanguage } from "../../../lib/units";
import { useSettingsStore } from "../../../store/settingsStore";
import type { WrappedTravTrack } from "../../../types/wrapped";
import StatCard from "../StatCard";

/**
 * What the account's own TravTrack recorded in the year (forgejo#400). The
 * figures are measured by the phone, so none is an entry of the logbook, none
 * opens an evidence list, and none is added to a domain's total. Each abstains
 * on its own: no believable top speed or height draws no card rather than a
 * card reading "0".
 */
export default function WrappedTravTrackCards({
  data,
  count,
}: {
  data: WrappedTravTrack;
  count: (value: number) => string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "common"]);
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const locale = localeForLanguage(i18n.language);
  // Standing still is not travel: it stays out of the class card.
  const moving = data.byMotion.filter((m) => m.motion !== "stationary" && m.hours > 0);
  const movingHours = moving.reduce((sum, m) => sum + m.hours, 0);
  const breakdown = moving
    .map(
      (m) =>
        `${t(`stats:wrapped.travTrack.motion.${m.motion}`)} ${formatHoursValue(m.hours, i18n.language)} h`
    )
    .join(" · ");
  return (
    <>
      <StatCard
        title={t("stats:wrapped.travTrack.days")}
        value={count(data.daysRecorded)}
        description={
          data.kmGround === null
            ? t("stats:wrapped.travTrack.kmNone")
            : t("stats:wrapped.travTrack.kmDesc", {
                km: formatDistance(data.kmGround, distanceUnit, t, i18n.language),
              })
        }
      />
      {data.topSpeedKmh !== null && (
        <StatCard
          title={t("stats:wrapped.travTrack.topSpeed")}
          value={`${data.topSpeedKmh.toLocaleString(locale)} km/h`}
          description={t("stats:wrapped.travTrack.topSpeedDesc")}
        />
      )}
      {data.highestPointM !== null && (
        <StatCard
          title={t("stats:wrapped.travTrack.highest")}
          value={`${data.highestPointM.toLocaleString(locale)} m`}
          description={t("stats:wrapped.travTrack.highestDesc")}
        />
      )}
      {moving.length > 0 && (
        <StatCard
          title={t("stats:wrapped.travTrack.byMotion")}
          value={`${formatHoursValue(movingHours, i18n.language)} h`}
          description={breakdown}
        />
      )}
    </>
  );
}
