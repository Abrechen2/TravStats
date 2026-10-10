import { useTranslation } from "../../hooks/useTranslation";
import { formatHours, formatHoursValue } from "../../lib/units";
import EvidenceTrigger from "./EvidenceTrigger";
import CountingHelp from "./counting/CountingHelp";

interface StatsOverviewCardsProps {
  totalFlights: number;
  totalFlightTime: number;
  avgFlightDuration: number;
  airlineCount: number;
  /**
   * Hours of `totalFlightTime` that came from a great-circle estimate rather
   * than from clocks, and how many flights those were (#268). Rows that carry
   * only a date have no times to measure; leaving them out understated the
   * total, and folding them in silently made a guess look measured. Shown as a
   * footnote so the figure stays one number and still says what it is.
   */
  estimatedHours?: number;
  estimatedFlightCount?: number;
}

export default function StatsOverviewCards({
  totalFlights,
  totalFlightTime,
  avgFlightDuration,
  airlineCount,
  estimatedHours = 0,
  estimatedFlightCount = 0,
}: StatsOverviewCardsProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats"]);
  const cardClass = "rounded-lg shadow-sm p-6";
  const cardStyle = { background: "var(--bg-surface)", border: "1px solid var(--color-border)" };
  // The tiles are always all-time (`AdvancedStatsPage.tsx` builds them from
  // the FULL countable-flight set, never the page's year filter) — matching
  // `evidenceMeasuresFlightCore.ts`'s `scopes: ["allTime"]` for all three.
  const allTime = { period: "allTime" as const };

  /** "So wird gezählt" for the four tiles (forgejo#256). */
  const help = [
    { term: t("stats:overview.totalFlights"), helpKey: "flightStatsHelp:overview.totalFlights" },
    { term: t("stats:overview.totalFlightTime"), helpKey: "flightStatsHelp:overview.flightTime" },
    {
      term: t("stats:overview.avgFlightDuration"),
      helpKey: "flightStatsHelp:overview.avgDuration",
    },
    { term: t("stats:overview.airlines"), helpKey: "flightStatsHelp:overview.airlines" },
  ];

  return (
    <div className="mb-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <EvidenceTrigger
          kind="metric"
          evidenceKey="flightCount"
          scope={allTime}
          renderedValue={totalFlights}
          label={t("stats:overview.totalFlights")}
          className={cardClass}
          style={cardStyle}
        >
          <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.totalFlights")}
          </h3>
          <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
            {totalFlights}
          </p>
        </EvidenceTrigger>
        <EvidenceTrigger
          kind="metric"
          evidenceKey="flightTimeMinutes"
          scope={allTime}
          renderedValue={Math.round(totalFlightTime * 60)}
          label={t("stats:overview.totalFlightTime")}
          className={cardClass}
          style={cardStyle}
        >
          <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.totalFlightTime")}
          </h3>
          <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
            {formatHours(totalFlightTime, i18n.language)}
          </p>
          {estimatedFlightCount > 0 && (
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {t("stats:overview.flightTimeEstimatedNote", {
                hours: formatHoursValue(estimatedHours, i18n.language),
                count: estimatedFlightCount,
              })}
            </p>
          )}
        </EvidenceTrigger>
        {/* An average opens the flights it is taken over — the flight-time
          measure, whose rows are those durations; no value to recount, the
          panel sums hours where the tile divides them. */}
        <EvidenceTrigger
          kind="metric"
          evidenceKey="flightTimeMinutes"
          scope={allTime}
          renderedValue={null}
          label={t("stats:overview.avgFlightDuration")}
          className={cardClass}
          style={cardStyle}
        >
          <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.avgFlightDuration")}
          </h3>
          <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
            {formatHours(avgFlightDuration, i18n.language)}
          </p>
        </EvidenceTrigger>
        <EvidenceTrigger
          kind="metric"
          evidenceKey="airlineCount"
          scope={allTime}
          renderedValue={airlineCount}
          label={t("stats:overview.airlines")}
          className={cardClass}
          style={cardStyle}
        >
          <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.airlines")}
          </h3>
          <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
            {airlineCount}
          </p>
        </EvidenceTrigger>
      </div>
      <CountingHelp entries={help} testId="overview-counting-help" />
    </div>
  );
}
