import { useTranslation } from "../../hooks/useTranslation";

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
  const { t } = useTranslation(["stats"]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div
        className="rounded-lg shadow-sm p-6"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {t("stats:overview.totalFlights")}
        </h3>
        <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
          {totalFlights}
        </p>
      </div>
      <div
        className="rounded-lg shadow-sm p-6"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {t("stats:overview.totalFlightTime")}
        </h3>
        <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
          {totalFlightTime.toFixed(1)}h
        </p>
        {estimatedFlightCount > 0 && (
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("stats:overview.flightTimeEstimatedNote", {
              hours: estimatedHours.toFixed(1),
              count: estimatedFlightCount,
            })}
          </p>
        )}
      </div>
      <div
        className="rounded-lg shadow-sm p-6"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {t("stats:overview.avgFlightDuration")}
        </h3>
        <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
          {avgFlightDuration.toFixed(1)}h
        </p>
      </div>
      <div
        className="rounded-lg shadow-sm p-6"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {t("stats:overview.airlines")}
        </h3>
        <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
          {airlineCount}
        </p>
      </div>
    </div>
  );
}
