import { useTranslation } from "../../hooks/useTranslation";

interface StatsOverviewCardsProps {
  totalFlights: number;
  totalFlightTime: number;
  avgFlightDuration: number;
  airlineCount: number;
}

export default function StatsOverviewCards({
  totalFlights,
  totalFlightTime,
  avgFlightDuration,
  airlineCount,
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
