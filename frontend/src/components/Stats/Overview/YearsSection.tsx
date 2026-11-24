import { useEffect, useState } from "react";
import type { JSX } from "react";

import { statsApi } from "../../../lib/api/stats";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";
import { useSettingsStore } from "../../../store/settingsStore";
import { formatDistance, formatNumber } from "../../../lib/units";
import type { YearStats } from "../../../types/yearStats";
import CountingHelp from "../counting/CountingHelp";
import { Link } from "react-router-dom";
import StatCard, { STAT_CARD_CLASS, STAT_CARD_STYLE, STAT_VALUE_CLASS } from "../StatCard";
import YearCard from "./YearCard";

/**
 * "Jahre": distance per year and month, one card per year, newest first — after the statistics
 * page of Dawarich, but with the logbook's own distance (every domain, by colour) and
 * TravTrack's recorded distance apart from it, never added.
 *
 * It fetches on its own, like `CrossDomainSection`: a failure here must not take the overview
 * down, and says so instead of drawing an empty page. No year at all draws nothing.
 */
/** Where the recorded figures live, month by month (TravTrack L3). */
export const TRACK_MONTHS_PATH = "/track/months";

/**
 * A recorded figure: its entries are TravTrack's own months, not logbook rows, so the card
 * opens the month view instead of an evidence list — every figure opens what is behind it.
 */
function TrackFigure({
  title,
  value,
  description,
  testId,
}: {
  title: string;
  value: string;
  description: string;
  testId: string;
}): JSX.Element {
  return (
    <Link
      to={TRACK_MONTHS_PATH}
      data-stat-figure
      data-testid={testId}
      className={`${STAT_CARD_CLASS} block`}
      style={STAT_CARD_STYLE}
    >
      <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <p className={`mb-1 font-bold ${STAT_VALUE_CLASS.lg}`} style={{ color: "var(--accent)" }}>
        {value}
      </p>
      <p className="text-sm opacity-75">{description}</p>
    </Link>
  );
}

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
            evidence={{
              kind: "metric",
              key: "loggedDistanceKm",
              scope: { period: "allTime" },
              renderedValue: loggedKm,
            }}
          />
        )}
        {recordedKm !== null && (
          <TrackFigure
            title={t("stats:years.totalRecorded")}
            value={formatDistance(recordedKm, unit, t, lang)}
            description={t("stats:years.totalRecordedHint")}
            testId="years-recorded-km"
          />
        )}
        {recordedPoints !== null && (
          <TrackFigure
            title={t("stats:years.totalPoints")}
            value={formatNumber(recordedPoints, undefined, lang)}
            description={t("stats:years.totalPointsHint")}
            testId="years-recorded-points"
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
