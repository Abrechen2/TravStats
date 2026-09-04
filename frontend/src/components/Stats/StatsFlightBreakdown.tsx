import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

interface FlightWithDuration {
  flight: Flight;
  duration: number;
}

interface StatsFlightBreakdownProps {
  sortedAirlines: [string, { count: number; totalDuration: number; flights: Flight[] }][];
  /** Counted flights that name no airline — said, never ranked (forgejo#81). */
  flightsWithoutAirline?: number;
  sortedAirports: [string, number][];
  seatClassStats: Record<string, number>;
  sortedAircraft: [string, number][];
  statusStats: Record<string, number>;
  boardingGroupStats: Record<string, number>;
  longestFlight: FlightWithDuration | undefined;
  shortestFlight: FlightWithDuration | undefined;
  totalFlights: number;
}

export default function StatsFlightBreakdown({
  sortedAirlines,
  flightsWithoutAirline = 0,
  sortedAirports,
  seatClassStats,
  sortedAircraft,
  statusStats,
  boardingGroupStats,
  longestFlight,
  shortestFlight,
  totalFlights,
}: StatsFlightBreakdownProps): JSX.Element {
  const { t } = useTranslation(["stats"]);

  const seatClassLabel = (key: string): string => {
    const labels: Record<string, string> = {
      economy: t("stats:seatClasses.economy"),
      premium_economy: t("stats:seatClasses.premiumEconomy"),
      business: t("stats:seatClasses.business"),
      first: t("stats:seatClasses.first"),
      unknown: t("stats:seatClasses.unknown"),
    };
    return labels[key] || key;
  };

  return (
    <>
      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Airlines */}
        <div
          className="rounded-lg shadow-sm p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            {t("stats:airlines.title")}
          </h2>
          {flightsWithoutAirline > 0 && (
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              {t("stats:airlines.withoutAirline", { count: flightsWithoutAirline })}
            </p>
          )}
          <div className="space-y-3">
            {sortedAirlines.map(([airline, data]) => (
              <div key={airline} className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                    {airline}
                  </div>
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {t("stats:airlines.flightsTotal", {
                      count: data.count,
                      hours: data.totalDuration.toFixed(1),
                    })}
                  </div>
                </div>
                <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
                  {data.count}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Airports */}
        <div
          className="rounded-lg shadow-sm p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            {t("stats:airports.title")}
          </h2>
          <div className="space-y-3">
            {sortedAirports.map(([airport, count]) => (
              <div key={airport} className="flex items-center justify-between">
                <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                  {airport}
                </div>
                <div className="text-2xl font-bold" style={{ color: "var(--success)" }}>
                  {count}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Seat Classes */}
        <div
          className="rounded-lg shadow-sm p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            {t("stats:seatClasses.title")}
          </h2>
          <div className="space-y-3">
            {Object.entries(seatClassStats).map(([seatClass, count]) => (
              <div key={seatClass} className="flex items-center justify-between">
                <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                  {seatClassLabel(seatClass)}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {((count / totalFlights) * 100).toFixed(1)}%
                  </div>
                  <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
                    {count}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Aircraft Types */}
        <div
          className="rounded-lg shadow-sm p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            {t("stats:aircraft.title")}
          </h2>
          <div className="space-y-3">
            {sortedAircraft.map(([aircraft, count]) => (
              <div key={aircraft} className="flex items-center justify-between">
                <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                  {aircraft}
                </div>
                <div className="text-2xl font-bold" style={{ color: "var(--warning)" }}>
                  {count}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status Distribution */}
        <div
          className="rounded-lg shadow-sm p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            {t("stats:flightStatus.title")}
          </h2>
          <div className="space-y-3">
            {Object.entries(statusStats).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      background:
                        status === "flown"
                          ? "var(--success)"
                          : status === "scheduled"
                            ? "var(--accent)"
                            : "var(--danger)",
                    }}
                  />
                  <span className="font-medium capitalize" style={{ color: "var(--text-primary)" }}>
                    {status}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {((count / totalFlights) * 100).toFixed(1)}%
                  </div>
                  <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {count}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Boarding Groups */}
        {Object.keys(boardingGroupStats).length > 0 && (
          <div
            className="rounded-lg shadow-sm p-6"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("stats:boardingGroups.title")}
            </h2>
            <div className="space-y-3">
              {Object.entries(boardingGroupStats)
                .sort(([, a], [, b]) => b - a)
                .map(([group, count]) => (
                  <div key={group} className="flex items-center justify-between">
                    <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                      {t("stats:boardingGroups.group", { group })}
                    </div>
                    <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
                      {count}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Longest/Shortest Flights */}
      {longestFlight && shortestFlight && longestFlight.flight && shortestFlight.flight && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <div
            className="rounded-lg shadow-sm p-6"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("stats:flights.longest")}
            </h2>
            <div className="space-y-2">
              <p className="" style={{ color: "var(--text-primary)" }}>
                <span className="font-medium">
                  {longestFlight.flight.airline || t("stats:flights.unknown")}
                </span>{" "}
                {longestFlight.flight.flightNumber || ""}
              </p>
              <p className="" style={{ color: "var(--text-muted)" }}>
                {longestFlight.flight.depIata || longestFlight.flight.depIcao || "N/A"} →{" "}
                {longestFlight.flight.arrIata || longestFlight.flight.arrIcao || "N/A"}
              </p>
              <p className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
                {longestFlight.duration?.toFixed(1) || "0.0"}h
              </p>
            </div>
          </div>

          <div
            className="rounded-lg shadow-sm p-6"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("stats:flights.shortest")}
            </h2>
            <div className="space-y-2">
              <p className="" style={{ color: "var(--text-primary)" }}>
                <span className="font-medium">
                  {shortestFlight.flight.airline || t("stats:flights.unknown")}
                </span>{" "}
                {shortestFlight.flight.flightNumber || ""}
              </p>
              <p className="" style={{ color: "var(--text-muted)" }}>
                {shortestFlight.flight.depIata || shortestFlight.flight.depIcao || "N/A"} →{" "}
                {shortestFlight.flight.arrIata || shortestFlight.flight.arrIcao || "N/A"}
              </p>
              <p className="text-2xl font-bold" style={{ color: "var(--success)" }}>
                {shortestFlight.duration?.toFixed(1) || "0.0"}h
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
