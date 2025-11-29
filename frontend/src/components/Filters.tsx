import { useState, useEffect, useRef } from 'react';
import { useThemeStore } from '../store/themeStore';
import { flightsApi } from '../lib/api';
import type { Flight, FlightFilters } from '../types';
import { API_LIMITS } from '../lib/constants';

interface FiltersProps {
  onFilterChange: (filters: FlightFilters & { minRouteCount?: number }) => void;
}

interface AirlineOption {
  name: string;
  count: number;
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

export default function Filters({ onFilterChange }: FiltersProps) {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Filter state
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [monthFilter, setMonthFilter] = useState<number | null>(null);
  const [minRouteCount, setMinRouteCount] = useState(1);
  const [selectedAirlines, setSelectedAirlines] = useState<string[]>([]);
  const [showFlown, setShowFlown] = useState(true);
  const [showScheduled, setShowScheduled] = useState(true);
  const [showCancelled, setShowCancelled] = useState(true);

  // Available options
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [availableAirlines, setAvailableAirlines] = useState<AirlineOption[]>([]);

  // Load available years and airlines from user's flights
  useEffect(() => {
    const loadOptions = async () => {
      try {
        let allFlights: Flight[] = [];
        let offset = 0;
        const limit = API_LIMITS.MAX_PAGE_SIZE; // match backend max to avoid validation errors and fewer requests

        // Fetch all flights to build complete filter options
        while (true) {
          const { flights } = await flightsApi.getAll({ limit, offset });
          allFlights = [...allFlights, ...flights];

          if (flights.length < limit) break;
          offset += limit;
        }

        // Extract years
        const years = new Set<number>();
        const airlineMap = new Map<string, number>();

        allFlights.forEach(flight => {
          const year = new Date(flight.departureTime).getFullYear();
          years.add(year);

          if (flight.airline) {
            airlineMap.set(flight.airline, (airlineMap.get(flight.airline) || 0) + 1);
          }
        });

        setAvailableYears(Array.from(years).sort((a, b) => b - a));

        const airlines = Array.from(airlineMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);

        setAvailableAirlines(airlines);
      } catch (error) {
        console.error('Failed to load filter options:', error);
      }
    };

    loadOptions();
  }, []);

  // Apply filters whenever they change
  useEffect(() => {
    const filters: FlightFilters & { minRouteCount?: number } = {};

    // Convert year/month to date range
    if (yearFilter || monthFilter) {
      if (yearFilter && monthFilter) {
        // Specific month and year
        const startDate = new Date(yearFilter, monthFilter - 1, 1);
        const endDate = new Date(yearFilter, monthFilter, 0, 23, 59, 59);
        filters.fromDate = startDate.toISOString();
        filters.toDate = endDate.toISOString();
      } else if (yearFilter) {
        // Whole year
        const startDate = new Date(yearFilter, 0, 1);
        const endDate = new Date(yearFilter, 11, 31, 23, 59, 59);
        filters.fromDate = startDate.toISOString();
        filters.toDate = endDate.toISOString();
      }
    }

    // Airline filter
    if (selectedAirlines.length > 0 && selectedAirlines.length < availableAirlines.length) {
      // Only apply if not all airlines selected
      filters.airline = [...selectedAirlines];
    }

    // Status filter
    const statuses: Array<'scheduled' | 'flown' | 'cancelled'> = [];
    if (showFlown) statuses.push('flown');
    if (showScheduled) statuses.push('scheduled');
    if (showCancelled) statuses.push('cancelled');

    if (statuses.length > 0 && statuses.length < 3) {
      filters.status = statuses;
    } else if (statuses.length === 0) {
      // Explicitly send empty array so backend can return zero results
      filters.status = [];
    }

    // Route count (frontend only, not sent to backend)
    filters.minRouteCount = minRouteCount;

    onFilterChange(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFilter, monthFilter, minRouteCount, selectedAirlines, showFlown, showScheduled, showCancelled, availableAirlines.length]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilters(false);
      }
    };

    if (showFilters) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showFilters]);

  const handleReset = () => {
    setYearFilter(null);
    setMonthFilter(null);
    setMinRouteCount(1);
    setSelectedAirlines([]);
    setShowFlown(true);
    setShowScheduled(true);
    setShowCancelled(true);
  };

  const toggleAirline = (airline: string) => {
    setSelectedAirlines(prev =>
      prev.includes(airline)
        ? prev.filter(a => a !== airline)
        : [...prev, airline]
    );
  };

  const toggleAllAirlines = () => {
    if (selectedAirlines.length === availableAirlines.length || selectedAirlines.length === 0) {
      setSelectedAirlines(availableAirlines.map(a => a.name));
    } else {
      setSelectedAirlines([]);
    }
  };

  const activeFilterCount = () => {
    let count = 0;
    if (yearFilter) count++;
    if (monthFilter) count++;
    if (minRouteCount > 1) count++;
    if (selectedAirlines.length > 0 && selectedAirlines.length < availableAirlines.length) count++;
    if (!showFlown || !showScheduled || !showCancelled) count++;
    return count;
  };

  return (
    <div ref={filterRef} className="relative">
      <button
        onClick={() => setShowFilters(!showFilters)}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg shadow-sm transition-colors ${
          isDarkMode
            ? 'bg-gray-800 text-gray-100 border border-gray-600 hover:bg-gray-700'
            : 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50'
        }`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span className="font-semibold text-sm">Filter</span>
        {activeFilterCount() > 0 && (
          <span className="bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {activeFilterCount()}
          </span>
        )}
      </button>

      {showFilters && (
        <div
          className={`absolute right-0 mt-2 w-80 rounded-lg shadow-xl border z-50 max-h-[calc(100vh-120px)] overflow-y-auto ${
            isDarkMode
              ? 'bg-gray-800 border-gray-700'
              : 'bg-white border-gray-200'
          }`}
        >
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Filter Optionen
              </h3>
              <button
                onClick={() => setShowFilters(false)}
                className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Zeit-Filter */}
            <div className="mb-4">
              <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                📅 Zeitraum
              </h4>
              <select
                value={yearFilter ?? ''}
                onChange={(e) => setYearFilter(e.target.value ? Number(e.target.value) : null)}
                className={`w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-500 ${
                  isDarkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-300'
                    : 'bg-white border-gray-300 text-gray-700'
                }`}
              >
                <option value="">Alle Jahre</option>
                {availableYears.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>

              <select
                value={monthFilter ?? ''}
                onChange={(e) => setMonthFilter(e.target.value ? Number(e.target.value) : null)}
                className={`w-full p-2 text-sm border rounded mt-2 focus:ring-2 focus:ring-blue-500 ${
                  isDarkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-300'
                    : 'bg-white border-gray-300 text-gray-700'
                }`}
              >
                <option value="">Alle Monate</option>
                {MONTHS.map(month => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
            </div>

            {/* Routen-Frequenz Filter */}
            <div className="mb-4">
              <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                🛫 Routenfrequenz
              </h4>
              <label className={`text-xs block mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Mindestens {minRouteCount}x geflogen
              </label>
              <input
                type="range"
                min="1"
                max="20"
                value={minRouteCount}
                onChange={(e) => setMinRouteCount(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <div className={`flex justify-between text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <span>1x</span>
                <span>20x+</span>
              </div>
            </div>

            {/* Airline-Filter */}
            {availableAirlines.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    🏢 Airlines
                  </h4>
                  <button
                    onClick={toggleAllAirlines}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {selectedAirlines.length === availableAirlines.length || selectedAirlines.length === 0 ? 'Alle' : 'Keine'}
                  </button>
                </div>
                <div className={`max-h-32 overflow-y-auto border rounded p-2 ${
                  isDarkMode
                    ? 'border-gray-600 bg-gray-700'
                    : 'border-gray-300 bg-gray-50'
                }`}>
                  {availableAirlines.slice(0, API_LIMITS.MAX_FILTER_AIRLINES).map(airline => (
                    <label
                      key={airline.name}
                      className={`flex items-center gap-2 text-sm mb-1 cursor-pointer p-1 rounded ${
                        isDarkMode
                          ? 'text-gray-300 hover:bg-gray-600'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedAirlines.length === 0 || selectedAirlines.includes(airline.name)}
                        onChange={() => toggleAirline(airline.name)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="truncate flex-1">{airline.name || 'Unbekannt'}</span>
                      <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        ({airline.count})
                      </span>
                    </label>
                  ))}
                  {availableAirlines.length > API_LIMITS.MAX_FILTER_AIRLINES && (
                    <div className={`text-xs mt-2 italic ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      +{availableAirlines.length - API_LIMITS.MAX_FILTER_AIRLINES} weitere...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Status-Filter */}
            <div className="mb-4">
              <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                ✈️ Status
              </h4>
              <label className={`flex items-center gap-2 text-sm mb-1 cursor-pointer ${
                isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                <input
                  type="checkbox"
                  checked={showFlown}
                  onChange={(e) => setShowFlown(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                Geflogen
              </label>
              <label className={`flex items-center gap-2 text-sm mb-1 cursor-pointer ${
                isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                <input
                  type="checkbox"
                  checked={showScheduled}
                  onChange={(e) => setShowScheduled(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                Geplant
              </label>
              <label className={`flex items-center gap-2 text-sm cursor-pointer ${
                isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                <input
                  type="checkbox"
                  checked={showCancelled}
                  onChange={(e) => setShowCancelled(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                Storniert
              </label>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleReset}
              className={`w-full p-2 rounded text-sm font-medium transition-colors ${
                isDarkMode
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Filter zurücksetzen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
