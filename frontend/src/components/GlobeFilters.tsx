import { memo } from 'react';

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

const MONTHS = [
  { value: 1, label: 'Januar' },
  { value: 2, label: 'Februar' },
  { value: 3, label: 'März' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mai' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Dezember' },
];

function GlobeFilters({
  filters,
  onChange,
  availableYears,
  availableAirlines,
  isCollapsed,
  onToggleCollapse,
}: GlobeFiltersProps) {
  const handleReset = () => {
    onChange(defaultFilterState);
  };

  const toggleAirline = (airline: string) => {
    const newSelection = filters.selectedAirlines.includes(airline)
      ? filters.selectedAirlines.filter(a => a !== airline)
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
        style={{ touchAction: 'auto', pointerEvents: 'auto' }}
      >
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {isCollapsed ? '▶' : '▼'} Filter
        </span>
      </button>

      {/* Filter Panel */}
      {!isCollapsed && (
        <div
          className="mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 border border-gray-200 dark:border-gray-700 max-w-xs max-h-[calc(100vh-120px)] overflow-y-auto"
          style={{ touchAction: 'auto', pointerEvents: 'auto' }}
        >
          {/* Zeit-Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              📅 Zeitraum
            </h3>

            <select
              value={filters.yearFilter ?? ''}
              onChange={(e) => onChange({ ...filters, yearFilter: e.target.value ? Number(e.target.value) : null })}
              className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Alle Jahre</option>
              {availableYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            <select
              value={filters.monthFilter ?? ''}
              onChange={(e) => onChange({ ...filters, monthFilter: e.target.value ? Number(e.target.value) : null })}
              className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 mt-2 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Alle Monate</option>
              {MONTHS.map(month => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </div>

          {/* Routen-Frequenz Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              🛫 Routenfrequenz
            </h3>
            <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">
              Mindestens {filters.minRouteCount}x geflogen
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
                  🏢 Airlines
                </h3>
                <button
                  onClick={toggleAllAirlines}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {filters.selectedAirlines.length === availableAirlines.length ? 'Keine' : 'Alle'}
                </button>
              </div>
              <div className="max-h-32 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded p-2 bg-gray-50 dark:bg-gray-700">
                {availableAirlines.slice(0, 15).map(airline => (
                  <label key={airline} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={filters.selectedAirlines.length === 0 || filters.selectedAirlines.includes(airline)}
                      onChange={() => toggleAirline(airline)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="truncate">{airline || 'Unbekannt'}</span>
                  </label>
                ))}
                {availableAirlines.length > 15 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
                    +{availableAirlines.length - 15} weitere...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status-Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              ✈️ Status
            </h3>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showFlown}
                onChange={(e) => onChange({ ...filters, showFlown: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              Geflogen
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showScheduled}
                onChange={(e) => onChange({ ...filters, showScheduled: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              Geplant
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showCancelled}
                onChange={(e) => onChange({ ...filters, showCancelled: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              Storniert
            </label>
          </div>

          {/* Reset Button */}
          <button
            onClick={handleReset}
            className="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 p-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium transition-colors"
          >
            Filter zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(GlobeFilters);
