/**
 * Statistics Impact Preview Component
 *
 * Shows how pending update will affect user statistics
 */

import { useTranslation } from "../hooks/useTranslation";

interface StatisticsImpact {
  distance: {
    before: number;
    after: number;
    change: number;
  };
  flightTime: {
    before: number;
    after: number;
    change: number;
  };
  airlines: {
    before: Set<string>;
    after: Set<string>;
    added: string[];
    removed: string[];
  };
  airports: {
    before: Set<string>;
    after: Set<string>;
    added: string[];
    removed: string[];
  };
}

interface StatisticsImpactPreviewProps {
  impact: StatisticsImpact | Record<string, unknown> | null | undefined;
}

export default function StatisticsImpactPreview({
  impact,
}: StatisticsImpactPreviewProps): JSX.Element {
  const { t } = useTranslation(["pendingUpdates"]);

  if (!impact) {
    return (
      <div className="text-center text-(--text-muted) py-8">
        {t("pendingUpdates:preview.noData")}
      </div>
    );
  }

  // Cast to internal type for property access
  const data = impact as StatisticsImpact;

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("de-DE").format(num);
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const getChangeColor = (change: number) => {
    if (change > 0) return "text-green-600";
    if (change < 0) return "text-red-600";
    return "text-(--text-muted)";
  };

  const getChangeIcon = (change: number) => {
    if (change > 0) return "↑";
    if (change < 0) return "↓";
    return "→";
  };

  return (
    <div className="space-y-6">
      {/* Distance */}
      {data.distance && (
        <div className="p-4 rounded-lg bg-(--bg-surface)">
          <h3 className="text-lg font-semibold text-(--text-primary) mb-3">
            {t("pendingUpdates:preview.distance")}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.before")}
              </div>
              <div className="text-xl font-bold text-(--text-primary)">
                {formatNumber(data.distance.before)} km
              </div>
            </div>
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.after")}
              </div>
              <div className="text-xl font-bold text-(--text-primary)">
                {formatNumber(data.distance.after)} km
              </div>
            </div>
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.change")}
              </div>
              <div className={`text-xl font-bold ${getChangeColor(data.distance.change)}`}>
                {getChangeIcon(data.distance.change)} {formatNumber(Math.abs(data.distance.change))}{" "}
                km
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flight Time */}
      {data.flightTime && (
        <div className="p-4 rounded-lg bg-(--bg-surface)">
          <h3 className="text-lg font-semibold text-(--text-primary) mb-3">
            {t("pendingUpdates:preview.flightTime")}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.before")}
              </div>
              <div className="text-xl font-bold text-(--text-primary)">
                {formatTime(data.flightTime.before)}
              </div>
            </div>
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.after")}
              </div>
              <div className="text-xl font-bold text-(--text-primary)">
                {formatTime(data.flightTime.after)}
              </div>
            </div>
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.change")}
              </div>
              <div className={`text-xl font-bold ${getChangeColor(data.flightTime.change)}`}>
                {getChangeIcon(data.flightTime.change)}{" "}
                {formatTime(Math.abs(data.flightTime.change))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Airlines */}
      {data.airlines && (
        <div className="p-4 rounded-lg bg-(--bg-surface)">
          <h3 className="text-lg font-semibold text-(--text-primary) mb-3">
            {t("pendingUpdates:preview.airlines")}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.before")}
              </div>
              <div className="text-lg font-bold text-(--text-primary)">
                {Array.isArray(data.airlines.before)
                  ? data.airlines.before.length
                  : data.airlines.before?.size || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.after")}
              </div>
              <div className="text-lg font-bold text-(--text-primary)">
                {Array.isArray(data.airlines.after)
                  ? data.airlines.after.length
                  : data.airlines.after?.size || 0}
              </div>
            </div>
          </div>
          {data.airlines.added && data.airlines.added.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-green-600 mb-1">{t("pendingUpdates:preview.added")}</div>
              <div className="text-sm text-(--text-primary)">
                {data.airlines.added.join(", ")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Airports */}
      {data.airports && (
        <div className="p-4 rounded-lg bg-(--bg-surface)">
          <h3 className="text-lg font-semibold text-(--text-primary) mb-3">
            {t("pendingUpdates:preview.airports")}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.before")}
              </div>
              <div className="text-lg font-bold text-(--text-primary)">
                {Array.isArray(data.airports.before)
                  ? data.airports.before.length
                  : data.airports.before?.size || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-(--text-muted) mb-1">
                {t("pendingUpdates:preview.after")}
              </div>
              <div className="text-lg font-bold text-(--text-primary)">
                {Array.isArray(data.airports.after)
                  ? data.airports.after.length
                  : data.airports.after?.size || 0}
              </div>
            </div>
          </div>
          {data.airports.added && data.airports.added.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-green-600 mb-1">{t("pendingUpdates:preview.added")}</div>
              <div className="text-sm text-(--text-primary)">
                {data.airports.added.join(", ")}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
