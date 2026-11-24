import { useEffect, useState } from "react";
import type { JSX } from "react";

import { statsApi } from "../../../lib/api/stats";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";
import { useSettingsStore } from "../../../store/settingsStore";
import { formatDistance, formatNumber } from "../../../lib/units";
import type { YearStats } from "../../../types/yearStats";
import CountingHelp from "../counting/CountingHelp";
import StatCard from "../StatCard";
import YearCard from "./YearCard";

/**
 * "Jahre": distance per year and month, one card per year, newest first — after the statistics
 * page of Dawarich, but with the logbook's own distance (every domain, by colour) and
 * TravTrack's recorded distance apart from it, never added.
 *
 * It fetches on its own, like `CrossDomainSection`: a failure here must not take the overview
 * down, and says so instead of drawing an empty page. No year at all draws nothing.
 */
export default function YearsSection(): JSX.Element | null {
  const { t, i18n } = useTranslation(["stats"]);
  const unit = useSettingsStore((s) => s.units.distanceUnit);
  const [data, setData] = useState<YearStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    statsApi
      .getYearStats()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err: unknown) => {
        logger.error("YearsSection: fetch failed", err);
        if (!cancelled) setFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const heading = (
    <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
      {t("stats:years.title")}
    </h2>
  );
  if (failed) {
    return (
      <section data-testid="years-section">
        {heading}
        <p className="text-sm opacity-75" role="alert">
          {t("stats:years.loadFailed")}
        </p>
      </section>
    );
  }
  if (data === null || data.years.length === 0) return null;

  const lang = i18n.language;
  const { loggedKm, recordedKm, recordedPoints } = data.totals;
  return (
    <section data-testid="years-section">
      {heading}
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("stats:years.help")}
      </p>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {loggedKm !== null && (
          <StatCard
            title={t("stats:years.totalLogged")}
            value={formatDistance(loggedKm, unit, t, lang)}
            description={t("stats:years.totalLoggedHint")}
          />
        )}
        {recordedKm !== null && (
          <StatCard
            title={t("stats:years.totalRecorded")}
            value={formatDistance(recordedKm, unit, t, lang)}
            description={t("stats:years.totalRecordedHint")}
          />
        )}
        {recordedPoints !== null && (
          <StatCard
            title={t("stats:years.totalPoints")}
            value={formatNumber(recordedPoints, undefined, lang)}
            description={t("stats:years.totalPointsHint")}
          />
        )}
      </div>
      <CountingHelp
        entries={[
          ...(loggedKm !== null
            ? [{ term: t("stats:years.totalLogged"), helpKey: "stats:years.countingHelp.logged" }]
            : []),
          ...(recordedKm !== null
            ? [
                {
                  term: t("stats:years.totalRecorded"),
                  helpKey: "stats:years.countingHelp.recorded",
                },
              ]
            : []),
          ...(recordedPoints !== null
            ? [{ term: t("stats:years.totalPoints"), helpKey: "stats:years.countingHelp.points" }]
            : []),
        ]}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.years.map((card) => (
          <YearCard key={card.year} card={card} />
        ))}
      </div>
    </section>
  );
}
