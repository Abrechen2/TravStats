import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { convertDistance, formatDistance, getDistanceLabel } from "../../lib/units";

interface FlightWithDistance {
  flight: Flight;
  distance: number;
}

interface StatsDistanceSectionProps {
  totalDistance: number;
  avgDistance: number;
  longestDistance: FlightWithDistance | undefined;
  shortestDistance: FlightWithDistance | undefined;
}

export default function StatsDistanceSection({
  totalDistance,
  avgDistance,
  longestDistance,
  shortestDistance,
}: StatsDistanceSectionProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const { units } = useSettingsStore();

  const earthCircumference = 40075; // km
  const earthCircumnavigations = totalDistance / earthCircumference;
  const moonDistance = 384400; // km
  const moonPercentage = (totalDistance / moonDistance) * 100;
  const marsDistance = 225000000; // km (average)
  const marsPercentage = (totalDistance / marsDistance) * 100;
  const voyagerDistance = 24000000000; // km (Voyager 1, ~24 billion km)
  const voyagerPercentage = (totalDistance / voyagerDistance) * 100;

  return (
    <div
      className="rounded-lg shadow-lg p-8 mb-8"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h2 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:distance.title")}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">
            {t("stats:distance.totalDistance")}
          </h3>
          <p className="text-4xl font-bold">
            {convertDistance(totalDistance, units.distanceUnit)
              .toFixed(0)
              .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
          </p>
          <p className="text-sm opacity-75 mt-1">{getDistanceLabel(units.distanceUnit, t)}</p>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">
            {t("stats:distance.avgPerFlight")}
          </h3>
          <p className="text-4xl font-bold">
            {convertDistance(avgDistance, units.distanceUnit).toFixed(0)}
          </p>
          <p className="text-sm opacity-75 mt-1">{getDistanceLabel(units.distanceUnit, t)}</p>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">
            {t("stats:distance.earthCircumnavigations")}
          </h3>
          <p className="text-4xl font-bold">{earthCircumnavigations.toFixed(2)}</p>
          <p className="text-sm opacity-75 mt-1">{t("stats:distance.timesAroundEarth")}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg p-4" style={{ background: "var(--bg-elevated)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {t("stats:distance.earthCircumnavigation")}
            </span>
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>
              {earthCircumnavigations.toFixed(2)}×
            </span>
          </div>
          <div className="w-full rounded-full h-3" style={{ background: "var(--bg-muted)" }}>
            <div
              className="rounded-full h-3 transition-all"
              style={{
                background: "var(--success)",
                width: `${Math.min((earthCircumnavigations / 1) * 100, 100)}%`,
              }}
            />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            {formatDistance(earthCircumference, units.distanceUnit, t)}{" "}
            {t("stats:distance.circumference")}
          </p>
        </div>

        <div className="rounded-lg p-4" style={{ background: "var(--bg-elevated)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {t("stats:distance.pathToMoon")}
            </span>
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>
              {moonPercentage.toFixed(2)}%
            </span>
          </div>
          <div className="w-full rounded-full h-3" style={{ background: "var(--bg-muted)" }}>
            <div
              className="rounded-full h-3 transition-all"
              style={{
                background: "var(--accent)",
                width: `${Math.min(moonPercentage, 100)}%`,
              }}
            />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            {formatDistance(moonDistance, units.distanceUnit, t)} {t("stats:distance.distance")}
          </p>
        </div>

        <div className="rounded-lg p-4" style={{ background: "var(--bg-elevated)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {t("stats:distance.pathToMars")}
            </span>
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>
              {marsPercentage.toFixed(4)}%
            </span>
          </div>
          <div className="w-full rounded-full h-3" style={{ background: "var(--bg-muted)" }}>
            <div
              className="rounded-full h-3 transition-all"
              style={{
                background: "var(--danger)",
                width: `${Math.min(marsPercentage, 100)}%`,
              }}
            />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            {formatDistance(marsDistance, units.distanceUnit, t)} {t("stats:distance.distance")} (
            {t("stats:distance.average")})
          </p>
        </div>

        <div className="rounded-lg p-4" style={{ background: "var(--bg-elevated)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {t("stats:distance.pathToVoyager")}
            </span>
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>
              {voyagerPercentage.toFixed(6)}%
            </span>
          </div>
          <div className="w-full rounded-full h-3" style={{ background: "var(--bg-muted)" }}>
            <div
              className="rounded-full h-3 transition-all"
              style={{
                background: "var(--text-muted)",
                width: `${Math.min(voyagerPercentage, 100)}%`,
              }}
            />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            {formatDistance(voyagerDistance, units.distanceUnit, t)} {t("stats:distance.fromEarth")}
          </p>
        </div>
      </div>

      {/* Longest/Shortest Distance */}
      {longestDistance && shortestDistance && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-4 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">
              {t("stats:distance.longestDistance")}
            </h3>
            <p className="text-2xl font-bold mb-1">
              {formatDistance(longestDistance.distance, units.distanceUnit, t)}
            </p>
            <p className="text-sm opacity-75">
              {longestDistance.flight.depIata || longestDistance.flight.depIcao} →{" "}
              {longestDistance.flight.arrIata || longestDistance.flight.arrIcao}
            </p>
          </div>

          <div className="bg-gradient-to-br from-teal-500 to-teal-600 rounded-lg p-4 text-white shadow-md">
            <h3 className="text-sm font-medium opacity-90 mb-2">
              {t("stats:distance.shortestDistance")}
            </h3>
            <p className="text-2xl font-bold mb-1">
              {formatDistance(shortestDistance.distance, units.distanceUnit, t)}
            </p>
            <p className="text-sm opacity-75">
              {shortestDistance.flight.depIata || shortestDistance.flight.depIcao} →{" "}
              {shortestDistance.flight.arrIata || shortestDistance.flight.arrIcao}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
