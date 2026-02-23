import { memo } from "react";
import { useTranslation } from "../hooks/useTranslation";

export interface FilterState {
  // Zeit
  yearFilter: number | null;
  monthFilter: number | null;

  // Routen
  minRouteCount: number;

  // Airlines
  selectedAirlines: string[];

  // Status
  showFlown: boolean;
  showScheduled: boolean;
  showCancelled: boolean;
}

export const defaultFilterState: FilterState = {
  yearFilter: null,
  monthFilter: null,
  minRouteCount: 1,
  selectedAirlines: [],
  showFlown: true,
  showScheduled: true,
  showCancelled: true,
};

interface GlobeFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  availableYears: number[];
  availableAirlines: string[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

// MONTHS will be generated dynamically using translations

function GlobeFilters({
  filters,
  onChange,
  availableYears,
  availableAirlines,
  isCollapsed,
  onToggleCollapse,
}: GlobeFiltersProps): JSX.Element {
  const { t } = useTranslation(["map", "common", "flights"]);

  const MONTHS = [
    { value: 1, label: t("stats:calendar.months.january") },
    { value: 2, label: t("stats:calendar.months.february") },
    { value: 3, label: t("stats:calendar.months.march") },
    { value: 4, label: t("stats:calendar.months.april") },
    { value: 5, label: t("stats:calendar.months.may") },
    { value: 6, label: t("stats:calendar.months.june") },
    { value: 7, label: t("stats:calendar.months.july") },
    { value: 8, label: t("stats:calendar.months.august") },
    { value: 9, label: t("stats:calendar.months.september") },
    { value: 10, label: t("stats:calendar.months.october") },
    { value: 11, label: t("stats:calendar.months.november") },
    { value: 12, label: t("stats:calendar.months.december") },
  ];

  const handleReset = () => {
    onChange(defaultFilterState);
  };

  const toggleAirline = (airline: string) => {
    const newSelection = filters.selectedAirlines.includes(airline)
      ? filters.selectedAirlines.filter((a) => a !== airline)
      : [...filters.selectedAirlines, airline];
    onChange({ ...filters, selectedAirlines: newSelection });
  };

  const toggleAllAirlines = () => {
    if (filters.selectedAirlines.length === availableAirlines.length) {
      onChange({ ...filters, selectedAirlines: [] });
    } else {
      onChange({ ...filters, selectedAirlines: [...availableAirlines] });
    }
  };

  return (
    <div className="absolute top-4 left-4 z-[9999]">
      {/* Collapse Button */}
      <button
        onClick={onToggleCollapse}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-lg px-4 py-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
        style={{ touchAction: "auto", pointerEvents: "auto" }}
      >
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {isCollapsed ? "▶" : "▼"} {t("map:filters.title")}
        </span>
      </button>

      {/* Filter Panel */}
      {!isCollapsed && (
        <div
          className="mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 border border-gray-200 dark:border-gray-700 max-w-xs max-h-[calc(100vh-120px)] overflow-y-auto"
          style={{ touchAction: "auto", pointerEvents: "auto" }}
        >
          {/* Zeit-Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              📅 {t("map:filters.timePeriod")}
            </h3>

            <select
              value={filters.yearFilter ?? ""}
              onChange={(e) =>
                onChange({ ...filters, yearFilter: e.target.value ? Number(e.target.value) : null })
              }
              className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("map:filters.allYears")}</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              value={filters.monthFilter ?? ""}
              onChange={(e) =>
                onChange({
                  ...filters,
                  monthFilter: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 mt-2 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("map:filters.allMonths")}</option>
              {MONTHS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>

          {/* Routen-Frequenz Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              🛫 {t("map:filters.routeFrequency")}
            </h3>
            <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">
              {t("map:filters.minFlown", { count: filters.minRouteCount })}
            </label>
            <input
              type="range"
              min="1"
              max="20"
              value={filters.minRouteCount}
              onChange={(e) => onChange({ ...filters, minRouteCount: Number(e.target.value) })}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>1x</span>
              <span>20x+</span>
            </div>
          </div>

          {/* Airline-Filter */}
          {availableAirlines.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  🏢 {t("map:filters.airlines")}
                </h3>
                <button
                  onClick={toggleAllAirlines}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {filters.selectedAirlines.length === availableAirlines.length
                    ? t("map:filters.none")
                    : t("map:filters.all")}
                </button>
              </div>
              <div className="max-h-32 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded p-2 bg-gray-50 dark:bg-gray-700">
                {availableAirlines.slice(0, 15).map((airline) => (
                  <label
                    key={airline}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={
                        filters.selectedAirlines.length === 0 ||
                        filters.selectedAirlines.includes(airline)
                      }
                      onChange={() => toggleAirline(airline)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="truncate">{airline || t("common:labels.unknown")}</span>
                  </label>
                ))}
                {availableAirlines.length > 15 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
                    {t("map:filters.moreAirlines", { count: availableAirlines.length - 15 })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status-Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              ✈️ {t("map:filters.status")}
            </h3>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showFlown}
                onChange={(e) => onChange({ ...filters, showFlown: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              {t("flights:status.flown")}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showScheduled}
                onChange={(e) => onChange({ ...filters, showScheduled: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              {t("flights:status.scheduled")}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showCancelled}
                onChange={(e) => onChange({ ...filters, showCancelled: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              {t("flights:status.cancelled")}
            </label>
          </div>

          {/* Reset Button */}
          <button
            onClick={handleReset}
            className="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 p-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium transition-colors"
          >
            {t("map:filters.reset")}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(GlobeFilters);
