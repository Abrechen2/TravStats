import { useState, useEffect, useRef } from "react";
import { flightsApi } from "../lib/api";
import HelpIcon from "./Help/HelpIcon";
import type { Flight, FlightFilters } from "../types";
import { API_LIMITS } from "../lib/constants";
import { useTranslation } from "../hooks/useTranslation";
import { logger } from "../lib/logger";
interface FiltersProps {
  onFilterChange: (filters: FlightFilters & { minRouteCount?: number }) => void;
  /**
   * Show map-only filters (route-frequency slider). Defaults to `true`.
   * Set to `false` on pages without a map, where the slider has no effect.
   */
  showMapOnlyFilters?: boolean;
}

interface AirlineOption {
  name: string;
  count: number;
}
export default function Filters({
  onFilterChange,
  showMapOnlyFilters = true,
}: FiltersProps): JSX.Element {
  const { t } = useTranslation(["map", "common", "flights"]);

  const MONTHS = [
    { value: 1, label: t("stats:months.jan") },
    { value: 2, label: t("stats:months.feb") },
    { value: 3, label: t("stats:months.mar") },
    { value: 4, label: t("stats:months.apr") },
    { value: 5, label: t("stats:months.may") },
    { value: 6, label: t("stats:months.jun") },
    { value: 7, label: t("stats:months.jul") },
    { value: 8, label: t("stats:months.aug") },
    { value: 9, label: t("stats:months.sep") },
    { value: 10, label: t("stats:months.oct") },
    { value: 11, label: t("stats:months.nov") },
    { value: 12, label: t("stats:months.dec") },
  ];
  const [showFilters, setShowFilters] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Determine open direction based on button position in viewport
  useEffect(() => {
    if (showFilters && filterRef.current) {
      const rect = filterRef.current.getBoundingClientRect();
      setOpenUpward(rect.bottom > window.innerHeight * 0.6);
    }
  }, [showFilters]);

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
        const MAX_PAGES = 200;
        let pages = 0;
        while (pages < MAX_PAGES) {
          pages++;
          const { flights } = await flightsApi.getAll({ limit, offset });
          allFlights = [...allFlights, ...flights];

          if (flights.length < limit) break;
          offset += limit;
        }

        // Extract years
        const years = new Set<number>();
        const airlineMap = new Map<string, number>();

        allFlights.forEach((flight) => {
          if (!flight.departureTime) return;
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
        logger.error("Failed to load filter options:", error);
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

    // Status filter. Only flown/scheduled/cancelled have UI toggles;
    // `historical` and `duplicated` are first-class statuses with no toggle,
    // so they must stay visible regardless of the toggle state — otherwise a
    // partial selection silently hides legitimate flights. We always append
    // them to any status allowlist we send. All three toggles on => omit the
    // filter entirely (everything shows).
    const ALWAYS_VISIBLE: Array<"historical" | "duplicated"> = ["historical", "duplicated"];
    const toggled: Array<"scheduled" | "flown" | "cancelled"> = [];
    if (showFlown) toggled.push("flown");
    if (showScheduled) toggled.push("scheduled");
    if (showCancelled) toggled.push("cancelled");

    if (toggled.length < 3) {
      filters.status = [...toggled, ...ALWAYS_VISIBLE];
    }

    // Route count (frontend only, not sent to backend) — only emit on map-enabled pages
    if (showMapOnlyFilters) {
      filters.minRouteCount = minRouteCount;
    }

    onFilterChange(filters);
  }, [
    yearFilter,
    monthFilter,
    minRouteCount,
    selectedAirlines,
    showFlown,
    showScheduled,
    showCancelled,
    availableAirlines.length,
    showMapOnlyFilters,
  ]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilters(false);
      }
    };

    if (showFilters) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
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
    setSelectedAirlines((prev) =>
      prev.includes(airline) ? prev.filter((a) => a !== airline) : [...prev, airline]
    );
  };

  const toggleAllAirlines = () => {
    // If all airlines are selected, deselect all
    // Otherwise, select all
    if (selectedAirlines.length === availableAirlines.length) {
      setSelectedAirlines([]);
    } else {
      setSelectedAirlines(availableAirlines.map((a) => a.name));
    }
  };

  const activeFilterCount = () => {
    let count = 0;
    if (yearFilter) count++;
    if (monthFilter) count++;
    if (showMapOnlyFilters && minRouteCount > 1) count++;
    if (selectedAirlines.length > 0 && selectedAirlines.length < availableAirlines.length) count++;
    if (!showFlown || !showScheduled || !showCancelled) count++;
    return count;
  };

  return (
    <div ref={filterRef} className="relative">
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
        style={{
          background: "rgba(255, 255, 255, 0.06)",
          color: "var(--text-secondary, #94a3b8)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          backdropFilter: "blur(8px)",
        }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        <span className="font-semibold text-sm">{t("map:filters.title")}</span>
        {activeFilterCount() > 0 && (
          <span
            className="text-xs rounded-full w-5 h-5 flex items-center justify-center"
            style={{ background: "var(--accent)", color: "var(--bg-base)" }}
          >
            {activeFilterCount()}
          </span>
        )}
      </button>

      {showFilters && (
        <div
          className={`absolute right-0 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg shadow-xl z-50 max-h-[calc(100vh-120px)] overflow-y-auto ${openUpward ? "bottom-full mb-2" : "mt-2"}`}
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("map:filters.title")}
              </h3>
              <button
                onClick={() => setShowFilters(false)}
                className="p-1 rounded-sm transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Zeit-Filter */}
            <div className="mb-4">
              <h4
                className="text-sm font-semibold mb-2 flex items-center gap-2"
                style={{ color: "var(--text-muted)" }}
              >
                📅 {t("map:filters.timePeriod")}
                <HelpIcon
                  content={t("map:filters.help.timePeriod")}
                  expandedContent={t("map:filters.help.timePeriodExpanded")}
                  position="right"
                />
              </h4>
              <select
                value={yearFilter ?? ""}
                onChange={(e) => setYearFilter(e.target.value ? Number(e.target.value) : null)}
                className="w-full p-2 text-sm rounded-sm"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                }}
              >
                <option value="">{t("map:filters.allYears")}</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>

              <select
                value={monthFilter ?? ""}
                onChange={(e) => setMonthFilter(e.target.value ? Number(e.target.value) : null)}
                className="w-full p-2 text-sm rounded-sm mt-2"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                }}
              >
                <option value="">{t("map:filters.allMonths")}</option>
                {MONTHS.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Routen-Frequenz Filter — map-only (no effect on list/stats pages) */}
            {showMapOnlyFilters && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
                  🛫 {t("map:filters.routeFrequency")}
                </h4>
                <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
                  {t("map:filters.minFlown", { count: minRouteCount })}
                </label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={minRouteCount}
                  onChange={(e) => setMinRouteCount(Number(e.target.value))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                  style={{ background: "var(--bg-muted)" }}
                />
                <div
                  className="flex justify-between text-xs mt-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span>1x</span>
                  <span>20x+</span>
                </div>
              </div>
            )}

            {/* Airline-Filter */}
            {availableAirlines.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h4
                    className="text-sm font-semibold flex items-center gap-2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    🏢 {t("map:filters.airlines")}
                    <HelpIcon
                      content={t("map:filters.help.airlines")}
                      expandedContent={t("map:filters.help.airlinesExpanded")}
                      position="right"
                    />
                  </h4>
                  <button
                    onClick={toggleAllAirlines}
                    className="text-xs hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {selectedAirlines.length === availableAirlines.length
                      ? t("map:filters.none")
                      : t("map:filters.all")}
                  </button>
                </div>
                <div
                  className="max-h-32 overflow-y-auto rounded-sm p-2"
                  style={{
                    border: "1px solid var(--color-border)",
                    background: "var(--bg-elevated)",
                  }}
                >
                  {availableAirlines.slice(0, API_LIMITS.MAX_FILTER_AIRLINES).map((airline) => (
                    <label
                      key={airline.name}
                      className="flex items-center gap-2 text-sm mb-1 cursor-pointer p-1 rounded-sm"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <input
                        type="checkbox"
                        checked={
                          selectedAirlines.length === 0 || selectedAirlines.includes(airline.name)
                        }
                        onChange={() => toggleAirline(airline.name)}
                        className="checkbox"
                      />
                      <span className="truncate flex-1">
                        {airline.name || t("common:labels.unknown")}
                      </span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        ({airline.count})
                      </span>
                    </label>
                  ))}
                  {availableAirlines.length > API_LIMITS.MAX_FILTER_AIRLINES && (
                    <div className="text-xs mt-2 italic" style={{ color: "var(--text-muted)" }}>
                      {t("map:filters.moreAirlines", {
                        count: availableAirlines.length - API_LIMITS.MAX_FILTER_AIRLINES,
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Status-Filter */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
                ✈️ {t("map:filters.status")}
              </h4>
              <label
                className="flex items-center gap-2 text-sm mb-1 cursor-pointer"
                style={{ color: "var(--text-primary)" }}
              >
                <input
                  type="checkbox"
                  checked={showFlown}
                  onChange={(e) => setShowFlown(e.target.checked)}
                  className="checkbox"
                />
                {t("flights:status.flown")}
              </label>
              <label
                className="flex items-center gap-2 text-sm mb-1 cursor-pointer"
                style={{ color: "var(--text-primary)" }}
              >
                <input
                  type="checkbox"
                  checked={showScheduled}
                  onChange={(e) => setShowScheduled(e.target.checked)}
                  className="checkbox"
                />
                {t("flights:status.scheduled")}
              </label>
              <label
                className="flex items-center gap-2 text-sm cursor-pointer"
                style={{ color: "var(--text-primary)" }}
              >
                <input
                  type="checkbox"
                  checked={showCancelled}
                  onChange={(e) => setShowCancelled(e.target.checked)}
                  className="checkbox"
                />
                {t("flights:status.cancelled")}
              </label>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleReset}
              className="w-full p-2 rounded-sm text-sm font-medium transition-colors"
              style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
            >
              {t("map:filters.reset")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
