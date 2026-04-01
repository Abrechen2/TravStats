import { useState, useEffect, useCallback } from "react";
import { flightsApi, statsApi } from "../lib/api";
import type { SummaryStats } from "../lib/api";
import NavigationBar from "../components/NavigationBar";
import FlightCalendar from "../components/FlightCalendar";
import YearHeatmap from "../components/YearHeatmap";
import ContextualHint from "../components/Onboarding/ContextualHint";
import type { Flight, FunStats, BusinessStats, UniqueStats, SeatStats } from "../types";
import { STORAGE_KEYS } from "../lib/constants";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import { useAuthStore } from "../store/authStore";
import { FlightCertificate, type FlightCertificateStats } from "../components/FlightCertificate";
import AirlineRankingCard from "../components/Stats/AirlineRankingCard";
import CountryDistributionCard from "../components/Stats/CountryDistributionCard";
import { generateYearReportPdf } from "../lib/yearReportPdf";
import { useToastStore } from "../store/toastStore";
import { convertDistance, formatDistance, formatCurrency, getDistanceLabel } from "../lib/units";
import { logger } from "../lib/logger";
import { SkeletonStatCards } from "../components/SkeletonLoader";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import PageTransition from "../components/PageTransition";

interface DeltaBadgeProps {
  current: number;
  compare: number;
}

function DeltaBadge({ current, compare }: DeltaBadgeProps): JSX.Element {
  const delta = current - compare;
  const pct = compare !== 0 ? Math.round((delta / compare) * 100) : 0;
  const positive = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded ${
        positive
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      }`}
    >
      {positive ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

export default function AdvancedStatsPage(): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const { units } = useSettingsStore();
  const { user } = useAuthStore();
  const addToast = useToastStore((state) => state.addToast);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [funStats, setFunStats] = useState<FunStats | null>(null);
  const [businessStats, setBusinessStats] = useState<BusinessStats | null>(null);
  const [uniqueStats, setUniqueStats] = useState<UniqueStats | null>(null);
  const [seatStats, setSeatStats] = useState<SeatStats | null>(null);
  const [showCertificate, setShowCertificate] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Year filter + comparison state
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [compareYear, setCompareYear] = useState<number | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [yearSummary, setYearSummary] = useState<SummaryStats | null>(null);
  const [compareSummary, setCompareSummary] = useState<SummaryStats | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const loadYearSummary = useCallback(
    async (year: number, cmpYear: number | null): Promise<void> => {
      setSummaryLoading(true);
      try {
        if (cmpYear !== null) {
          const resp = await statsApi.getSummary({ year, compareYear: cmpYear });
          if ("current" in resp) {
            setYearSummary(resp.current);
            setCompareSummary(resp.compare);
          }
        } else {
          const resp = await statsApi.getSummary({ year });
          if (!("current" in resp)) {
            setYearSummary(resp);
            setCompareSummary(null);
          }
        }
      } catch (err) {
        logger.error("Failed to load year summary:", err);
      } finally {
        setSummaryLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedYear !== null) {
      void loadYearSummary(selectedYear, compareEnabled ? compareYear : null);
    } else {
      setYearSummary(null);
      setCompareSummary(null);
    }
  }, [selectedYear, compareEnabled, compareYear, loadYearSummary]);

  useEffect(() => {
    loadFlights();
    // Mark stats as viewed in onboarding
    const onboarding = JSON.parse(localStorage.getItem(STORAGE_KEYS.ONBOARDING_CHECKLIST) || "{}");
    if (!onboarding.statsViewed) {
      onboarding.statsViewed = true;
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_CHECKLIST, JSON.stringify(onboarding));
    }
  }, []);

  const loadFlights = async (): Promise<void> => {
    try {
      setLoading(true);
      // Load all flights by pagination (max 100 per request)
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = 100;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const data = await flightsApi.getAll({ limit, offset });
        allFlights = [...allFlights, ...data.flights];

        // If we received fewer flights than the limit, we've reached the end
        if (data.flights.length < limit) {
          break;
        }

        offset += limit;
      }

      setFlights(allFlights);

      // Load additional statistics
      const [fun, business, unique, seat] = await Promise.all([
        statsApi.getFunStats().catch((err) => {
          logger.error("Failed to load fun stats:", err);
          return null;
        }),
        statsApi.getBusinessStats().catch((err) => {
          logger.error("Failed to load business stats:", err);
          return null;
        }),
        statsApi.getUniqueStats().catch((err) => {
          logger.error("Failed to load unique stats:", err);
          return null;
        }),
        statsApi.getSeatStats().catch((err) => {
          logger.error("Failed to load seat stats:", err);
          return null;
        }),
      ]);

      if (fun) setFunStats(fun);
      if (business) setBusinessStats(business);
      if (unique) {
        logger.debug("Loaded unique stats:", unique);
        setUniqueStats(unique);
      } else {
        logger.warn("Unique stats are null or failed to load");
      }
      if (seat) setSeatStats(seat);
    } catch (error) {
      logger.error("Failed to load flights:", error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate flight duration in hours
  const calculateDuration = (departure: string, arrival: string): number => {
    const dep = new Date(departure).getTime();
    const arr = new Date(arrival).getTime();
    return (arr - dep) / (1000 * 60 * 60); // Convert to hours
  };

  // Calculate distance between two coordinates using Haversine formula
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  };

  // Airline statistics
  const airlineStats = flights.reduce(
    (acc, flight) => {
      if (!acc[flight.airline]) {
        acc[flight.airline] = {
          count: 0,
          totalDuration: 0,
          flights: [],
        };
      }
      acc[flight.airline].count++;
      acc[flight.airline].totalDuration += calculateDuration(
        flight.departureTime,
        flight.arrivalTime
      );
      acc[flight.airline].flights.push(flight);
      return acc;
    },
    {} as Record<string, { count: number; totalDuration: number; flights: Flight[] }>
  );

  // Sort airlines by count
  const sortedAirlines = Object.entries(airlineStats)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10);

  // Seat class statistics
  const seatClassStats = flights.reduce(
    (acc, flight) => {
      const seatClass = flight.seatClass || "unknown";
      acc[seatClass] = (acc[seatClass] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Aircraft statistics
  const aircraftStats = flights.reduce(
    (acc, flight) => {
      if (flight.aircraft) {
        acc[flight.aircraft] = (acc[flight.aircraft] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  const sortedAircraft = Object.entries(aircraftStats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  // Status statistics
  const statusStats = flights.reduce(
    (acc, flight) => {
      acc[flight.status] = (acc[flight.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Total flight time
  const totalFlightTime = flights.reduce((sum, flight) => {
    return sum + calculateDuration(flight.departureTime, flight.arrivalTime);
  }, 0);

  // Average flight duration
  const avgFlightDuration = flights.length > 0 ? totalFlightTime / flights.length : 0;

  // Longest and shortest flights
  const flightDurations = flights
    .map((f) => ({
      flight: f,
      duration: calculateDuration(f.departureTime, f.arrivalTime),
    }))
    .filter((fd) => !isNaN(fd.duration) && fd.duration > 0); // Filter out invalid durations

  const longestFlight =
    flightDurations.length > 0
      ? flightDurations.sort((a, b) => b.duration - a.duration)[0]
      : undefined;
  const shortestFlight =
    flightDurations.length > 0
      ? flightDurations.sort((a, b) => a.duration - b.duration)[0]
      : undefined;

  // Distance calculations
  const flightDistances = flights.map((f) => {
    // Skip flights with missing coordinates
    const hasCoords = f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null;
    if (!hasCoords) {
      return { flight: f, distance: 0 };
    }
    try {
      const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      return { flight: f, distance: dist };
    } catch {
      return { flight: f, distance: 0 };
    }
  });

  const totalDistance = flightDistances.reduce((sum, f) => sum + f.distance, 0);
  const avgDistance = flights.length > 0 ? totalDistance / flights.length : 0;
  const longestDistance =
    flightDistances.length > 0
      ? flightDistances.sort((a, b) => b.distance - a.distance)[0]
      : undefined;
  const shortestDistance =
    flightDistances.length > 0
      ? flightDistances.sort((a, b) => a.distance - b.distance)[0]
      : undefined;

  // Distance equivalents
  const earthCircumference = 40075; // km
  const earthCircumnavigations = totalDistance / earthCircumference;
  const moonDistance = 384400; // km
  const moonPercentage = (totalDistance / moonDistance) * 100;
  const marsDistance = 225000000; // km (average)
  const marsPercentage = (totalDistance / marsDistance) * 100;
  const voyagerDistance = 24000000000; // km (Voyager 1, ~24 billion km)
  const voyagerPercentage = (totalDistance / voyagerDistance) * 100;

  // Most visited airports
  const airportVisits = flights.reduce(
    (acc, flight) => {
      const depCode = flight.depIata || flight.depIcao || "Unknown";
      const arrCode = flight.arrIata || flight.arrIcao || "Unknown";
      acc[depCode] = (acc[depCode] || 0) + 1;
      acc[arrCode] = (acc[arrCode] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const sortedAirports = Object.entries(airportVisits)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  // Boarding group statistics
  const boardingGroupStats = flights.reduce(
    (acc, flight) => {
      if (flight.boardingGroup) {
        acc[flight.boardingGroup] = (acc[flight.boardingGroup] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  // Seat class translation
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

  // Time-based analytics
  // Flights per month
  const flightsPerMonth = flights.reduce(
    (acc, flight) => {
      const date = new Date(flight.departureTime);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const monthlyData = Object.entries(flightsPerMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({
      month,
      flights: count,
    }));

  // Flights per year
  const flightsPerYear = flights.reduce(
    (acc, flight) => {
      const year = new Date(flight.departureTime).getFullYear();
      acc[year] = (acc[year] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  const yearlyData = Object.entries(flightsPerYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, count]) => ({
      year,
      flights: count,
    }));

  // Available years from flights (descending)
  const availableYears: number[] = Object.keys(flightsPerYear)
    .map(Number)
    .sort((a, b) => b - a);

  // Weekday analysis
  const weekdayNames = [
    t("stats:weekdays.sunday"),
    t("stats:weekdays.monday"),
    t("stats:weekdays.tuesday"),
    t("stats:weekdays.wednesday"),
    t("stats:weekdays.thursday"),
    t("stats:weekdays.friday"),
    t("stats:weekdays.saturday"),
  ];
  const flightsPerWeekday = flights.reduce(
    (acc, flight) => {
      const weekday = new Date(flight.departureTime).getDay();
      acc[weekday] = (acc[weekday] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  const weekdayData = weekdayNames.map((name, index) => ({
    day: name,
    flights: flightsPerWeekday[index] || 0,
  }));

  // Seasonal patterns (by month name)
  const monthNames = [
    t("stats:months.jan"),
    t("stats:months.feb"),
    t("stats:months.mar"),
    t("stats:months.apr"),
    t("stats:months.may"),
    t("stats:months.jun"),
    t("stats:months.jul"),
    t("stats:months.aug"),
    t("stats:months.sep"),
    t("stats:months.oct"),
    t("stats:months.nov"),
    t("stats:months.dec"),
  ];
  const flightsPerMonthOfYear = flights.reduce(
    (acc, flight) => {
      const month = new Date(flight.departureTime).getMonth();
      acc[month] = (acc[month] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  const seasonalData = monthNames.map((name, index) => ({
    month: name,
    flights: flightsPerMonthOfYear[index] || 0,
  }));

  // Certificate derived stats
  const topAirline: string | null = sortedAirlines.length > 0 ? sortedAirlines[0][0] : null;

  const routeCounts = flights.reduce(
    (acc, flight) => {
      const dep = flight.depIata || flight.depIcao || null;
      const arr = flight.arrIata || flight.arrIcao || null;
      if (dep && arr) {
        const key = `${dep} → ${arr}`;
        acc[key] = (acc[key] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );
  const favoriteRoute: string | null =
    Object.keys(routeCounts).length > 0
      ? Object.entries(routeCounts).sort(([, a], [, b]) => b - a)[0][0]
      : null;

  const yearsActive: number[] = [
    ...new Set(
      flights.map((f) => new Date(f.departureTime).getFullYear()).filter((y) => !isNaN(y))
    ),
  ];

  const handleYearReport = async (): Promise<void> => {
    if (!selectedYear) {
      addToast("warning", t("stats:yearReport.noYear"));
      return;
    }
    setGeneratingPdf(true);
    try {
      const yearFlights = flights.filter(
        (f) => new Date(f.departureTime).getFullYear() === selectedYear
      );
      const pdfUnits = units.distanceUnit === "miles" ? "mi" : "km";
      await generateYearReportPdf({
        year: selectedYear,
        flights: yearFlights,
        userName: user?.username ?? "User",
        units: pdfUnits,
      });
    } finally {
      setGeneratingPdf(false);
    }
  };

  const certificateStats: FlightCertificateStats = {
    totalFlights: flights.length,
    totalDistance,
    totalFlightTime,
    topAirline,
    favoriteRoute,
    yearsActive,
    userName: user?.username ?? "Traveler",
  };

  if (loading) {
    return (
      <PageTransition>
        <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
          <NavigationBar />
          <div className="container mx-auto px-6 py-8">
            <SkeletonStatCards />
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />

        {/* Main Content */}
        <div className="container mx-auto px-6 py-8">
          <ContextualHint
            id="stats-page-hint"
            title={t("stats:hint.title")}
            message={t("stats:hint.message")}
            linkTo="/"
            linkText={t("stats:hint.linkText")}
          />

          {/* Generate Certificate Button */}
          {flights.length > 0 && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowCertificate(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
                style={{
                  backgroundColor: "var(--color-primary)",
                  color: "#ffffff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ✈ {t("stats:certificate.generate")}
              </button>
              <button
                onClick={() => {
                  void handleYearReport();
                }}
                disabled={generatingPdf || !selectedYear}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
              >
                {generatingPdf ? t("stats:yearReport.generating") : t("stats:yearReport.btn")}
              </button>
            </div>
          )}

          {/* Certificate Modal */}
          {showCertificate && (
            <FlightCertificate stats={certificateStats} onClose={() => setShowCertificate(false)} />
          )}

          {/* Year Filter Controls */}
          {availableYears.length > 0 && (
            <div
              className="rounded-lg shadow p-4 mb-6 flex flex-wrap items-center gap-4"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <div className="flex items-center gap-2">
                <label
                  htmlFor="year-select"
                  className="text-sm font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("stats:yearFilter.selectYear")}
                </label>
                <select
                  id="year-select"
                  value={selectedYear ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      setSelectedYear(null);
                      setCompareEnabled(false);
                      setCompareYear(null);
                    } else {
                      setSelectedYear(Number(val));
                    }
                  }}
                  className="rounded border px-2 py-1 text-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="">{t("stats:yearFilter.allTime")}</option>
                  {availableYears.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>

              {selectedYear !== null && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={compareEnabled}
                    onChange={(e) => {
                      setCompareEnabled(e.target.checked);
                      if (!e.target.checked) {
                        setCompareYear(null);
                      }
                    }}
                    className="rounded"
                  />
                  <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                    {t("stats:yearFilter.compareWith")}
                  </span>
                </label>
              )}

              {selectedYear !== null && compareEnabled && (
                <select
                  value={compareYear ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCompareYear(val === "" ? null : Number(val));
                  }}
                  className="rounded border px-2 py-1 text-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--color-border)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="">—</option>
                  {availableYears
                    .filter((yr) => yr !== selectedYear)
                    .map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                </select>
              )}

              {summaryLoading && (
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("stats:loading")}
                </span>
              )}
            </div>
          )}

          {/* Year-Filtered Summary Cards */}
          {yearSummary !== null && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {/* Total Flights */}
              <div
                className="rounded-lg shadow p-6"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                  {t("stats:overview.totalFlights")}
                  {compareSummary !== null && (
                    <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("stats:yearFilter.vs", { year: compareYear })}
                    </span>
                  )}
                </h3>
                <div className="flex items-end gap-2 mt-2">
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {yearSummary.totalFlights}
                  </p>
                  {compareSummary !== null && (
                    <DeltaBadge
                      current={yearSummary.totalFlights}
                      compare={compareSummary.totalFlights}
                    />
                  )}
                </div>
                {compareSummary !== null && (
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {compareSummary.totalFlights} ({compareYear})
                  </p>
                )}
              </div>

              {/* Total Distance */}
              <div
                className="rounded-lg shadow p-6"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                  {t("stats:overview.totalDistance")}
                  {compareSummary !== null && (
                    <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("stats:yearFilter.vs", { year: compareYear })}
                    </span>
                  )}
                </h3>
                <div className="flex items-end gap-2 mt-2">
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {convertDistance(yearSummary.totalDistance, units.distanceUnit)
                      .toFixed(0)
                      .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                    <span className="text-lg ml-1">{getDistanceLabel(units.distanceUnit, t)}</span>
                  </p>
                  {compareSummary !== null && (
                    <DeltaBadge
                      current={yearSummary.totalDistance}
                      compare={compareSummary.totalDistance}
                    />
                  )}
                </div>
                {compareSummary !== null && (
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {convertDistance(compareSummary.totalDistance, units.distanceUnit).toFixed(0)}{" "}
                    {getDistanceLabel(units.distanceUnit, t)} ({compareYear})
                  </p>
                )}
              </div>

              {/* Total Flight Time */}
              <div
                className="rounded-lg shadow p-6"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                  {t("stats:overview.totalFlightTime")}
                  {compareSummary !== null && (
                    <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("stats:yearFilter.vs", { year: compareYear })}
                    </span>
                  )}
                </h3>
                <div className="flex items-end gap-2 mt-2">
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {(yearSummary.totalFlightTime / 60).toFixed(1)}
                    <span className="text-lg ml-1">{t("stats:overview.hours")}</span>
                  </p>
                  {compareSummary !== null && (
                    <DeltaBadge
                      current={yearSummary.totalFlightTime}
                      compare={compareSummary.totalFlightTime}
                    />
                  )}
                </div>
                {compareSummary !== null && (
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {(compareSummary.totalFlightTime / 60).toFixed(1)} {t("stats:overview.hours")} (
                    {compareYear})
                  </p>
                )}
              </div>

              {/* Total Cost */}
              <div
                className="rounded-lg shadow p-6"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                  {t("stats:overview.totalCost")}
                  {compareSummary !== null && (
                    <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {t("stats:yearFilter.vs", { year: compareYear })}
                    </span>
                  )}
                </h3>
                <div className="flex items-end gap-2 mt-2">
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(yearSummary.totalCost, units.currency)}
                  </p>
                  {compareSummary !== null && (
                    <DeltaBadge
                      current={yearSummary.totalCost}
                      compare={compareSummary.totalCost}
                    />
                  )}
                </div>
                {compareSummary !== null && (
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {formatCurrency(compareSummary.totalCost, units.currency)} ({compareYear})
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Overview Stats (all-time, always shown) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div
              className="rounded-lg shadow p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalFlights")}
              </h3>
              <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                {flights.length}
              </p>
            </div>
            <div
              className="rounded-lg shadow p-6"
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
              className="rounded-lg shadow p-6"
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
              className="rounded-lg shadow p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.airlines")}
              </h3>
              <p className="text-3xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                {Object.keys(airlineStats).length}
              </p>
            </div>
          </div>

          {/* Time-based Charts Section */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
              {t("stats:timeBasedAnalytics.title")}
            </h2>

            {/* Yearly Trend */}
            {yearlyData.length > 0 && (
              <div
                className="rounded-lg shadow-lg p-6 mb-6"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                  {t("stats:timeBasedAnalytics.yearlyTrend")}
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={yearlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="year"
                      stroke="var(--text-muted)"
                      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                    />
                    <YAxis
                      stroke="var(--text-muted)"
                      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "8px",
                        color: "var(--text-primary)",
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="flights"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      name={t("stats:timeBasedAnalytics.flightsLabel")}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Monthly Bar Chart */}
            {monthlyData.length > 0 && (
              <div
                className="rounded-lg shadow-lg p-6 mb-6"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                  {t("stats:timeBasedAnalytics.monthlyFlights")}
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="month"
                      stroke="var(--text-muted)"
                      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis
                      stroke="var(--text-muted)"
                      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "8px",
                        color: "var(--text-primary)",
                      }}
                    />
                    <Legend />
                    <Bar
                      dataKey="flights"
                      fill="var(--accent)"
                      radius={[4, 4, 0, 0]}
                      name={t("stats:timeBasedAnalytics.flightsLabel")}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Seasonal Patterns and Weekday Analysis */}
            {flights.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Seasonal Pattern */}
                <div
                  className="rounded-lg shadow-lg p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                    {t("stats:timeBasedAnalytics.seasonalPatterns")}
                  </h3>
                  {seasonalData.some((d) => d.flights > 0) ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={seasonalData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis
                          dataKey="month"
                          stroke="var(--text-muted)"
                          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                        />
                        <YAxis
                          stroke="var(--text-muted)"
                          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--bg-elevated)",
                            border: "1px solid var(--color-border)",
                            borderRadius: "8px",
                            color: "var(--text-primary)",
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="flights"
                          fill="var(--accent)"
                          radius={[4, 4, 0, 0]}
                          name={t("stats:timeBasedAnalytics.flightsLabel")}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      className="flex items-center justify-center h-[300px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <p>{t("stats:timeBasedAnalytics.noData")}</p>
                    </div>
                  )}
                </div>

                {/* Weekday Analysis */}
                <div
                  className="rounded-lg shadow-lg p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                    {t("stats:timeBasedAnalytics.weekdayAnalysis")}
                  </h3>
                  {weekdayData.some((d) => d.flights > 0) ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={weekdayData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis
                          dataKey="day"
                          stroke="var(--text-muted)"
                          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                        />
                        <YAxis
                          stroke="var(--text-muted)"
                          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--bg-elevated)",
                            border: "1px solid var(--color-border)",
                            borderRadius: "8px",
                            color: "var(--text-primary)",
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="flights"
                          fill="var(--success)"
                          radius={[4, 4, 0, 0]}
                          name={t("stats:timeBasedAnalytics.flightsLabel")}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      className="flex items-center justify-center h-[300px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <p>{t("stats:timeBasedAnalytics.noData")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Calendar Views Section */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
              {t("stats:calendar.title")}
            </h2>

            {/* Year Heatmap */}
            <div className="mb-6">
              <YearHeatmap flights={flights} />
            </div>

            {/* Monthly Calendar */}
            <div>
              <FlightCalendar flights={flights} />
            </div>
          </div>

          {/* Distance Visualization */}
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
                  {formatDistance(moonDistance, units.distanceUnit, t)}{" "}
                  {t("stats:distance.distance")}
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
                  {formatDistance(marsDistance, units.distanceUnit, t)}{" "}
                  {t("stats:distance.distance")} ({t("stats:distance.average")})
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
                  {formatDistance(voyagerDistance, units.distanceUnit, t)}{" "}
                  {t("stats:distance.fromEarth")}
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

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Airlines */}
            <div
              className="rounded-lg shadow p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h2 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                {t("stats:airlines.title")}
              </h2>
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
              className="rounded-lg shadow p-6"
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
              className="rounded-lg shadow p-6"
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
                        {((count / flights.length) * 100).toFixed(1)}%
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
              className="rounded-lg shadow p-6"
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
              className="rounded-lg shadow p-6"
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
                      <span
                        className="font-medium capitalize"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                        {((count / flights.length) * 100).toFixed(1)}%
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
                className="rounded-lg shadow p-6"
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
                className="rounded-lg shadow p-6"
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
                className="rounded-lg shadow p-6"
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

          {/* Fun Statistics */}
          {funStats && (
            <div className="mt-8">
              <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
                {t("stats:fun.title")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:fun.timezoneHopper")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{funStats.timezoneHopper}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:fun.timezoneHopperDesc", { count: funStats.timezoneHopper })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-yellow-500 to-orange-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:fun.earlyBird")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{funStats.earlyBird}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:fun.earlyBirdDesc", { count: funStats.earlyBird })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-indigo-500 to-blue-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t("stats:fun.nightOwl")}</h3>
                  <p className="text-4xl font-bold mb-1">{funStats.nightOwl}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:fun.nightOwlDesc", { count: funStats.nightOwl })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-pink-500 to-rose-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:fun.weekendWarrior")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{funStats.weekendWarrior}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:fun.weekendWarriorDesc", {
                      count: funStats.weekendWarrior,
                      percentage: funStats.weekendPercentage,
                    })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:fun.loyaltyScore")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{funStats.loyaltyScore}%</p>
                  <p className="text-sm opacity-75">
                    {t("stats:fun.loyaltyScoreDesc", {
                      score: funStats.loyaltyScore,
                      airline: funStats.mostUsedAirline || "N/A",
                    })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-cyan-500 to-blue-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:fun.shortHaulKing")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{funStats.shortHaulKing}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:fun.shortHaulKingDesc", { count: funStats.shortHaulKing })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-red-500 to-orange-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:fun.longHaulPilot")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{funStats.longHaulPilot}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:fun.longHaulPilotDesc", { count: funStats.longHaulPilot })}
                  </p>
                </div>

                {funStats.fastestDay && (
                  <div className="bg-gradient-to-br from-violet-500 to-purple-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:fun.fastestDay")}
                    </h3>
                    <p className="text-2xl font-bold mb-1">{funStats.fastestDayFlights}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:fun.fastestDayDesc", {
                        date: new Date(funStats.fastestDay).toLocaleDateString(),
                        count: funStats.fastestDayFlights,
                      })}
                    </p>
                  </div>
                )}

                <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:fun.co2Footprint")}
                  </h3>
                  <p className="text-3xl font-bold mb-1">
                    {funStats.co2FootprintKg.toLocaleString()} kg
                  </p>
                  <p className="text-sm opacity-75">
                    {t("stats:fun.co2FootprintDesc", {
                      kg: funStats.co2FootprintKg.toLocaleString(),
                      elephants: funStats.co2InElephants.toFixed(1),
                    })}
                  </p>
                </div>

                {funStats.milestoneYear && (
                  <div className="bg-gradient-to-br from-amber-500 to-yellow-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:fun.milestoneYear")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{funStats.milestoneYear}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:fun.milestoneYearDesc", {
                        year: funStats.milestoneYear,
                        count: funStats.milestoneYearFlights,
                      })}
                    </p>
                  </div>
                )}

                {funStats.routeMaster && (
                  <div className="bg-gradient-to-br from-sky-500 to-cyan-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:fun.routeMaster")}
                    </h3>
                    <p className="text-2xl font-bold mb-1">{funStats.routeMaster}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:fun.routeMasterDesc", {
                        route: funStats.routeMaster,
                        count: funStats.routeMasterCount,
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Business Statistics */}
          {businessStats && (
            <div className="mt-8">
              <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
                {t("stats:business.title")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div
                  className="rounded-lg shadow p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.costPerKm")}
                  </h3>
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(businessStats.costPerKm, units.currency)}
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.costPerKmDesc", {
                      cost: businessStats.costPerKm.toFixed(2),
                    })}
                  </p>
                </div>

                <div
                  className="rounded-lg shadow p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.costPerHour")}
                  </h3>
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(businessStats.costPerHour, units.currency)}
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.costPerHourDesc", {
                      cost: businessStats.costPerHour.toFixed(2),
                    })}
                  </p>
                </div>

                <div
                  className="rounded-lg shadow p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.totalCost")}
                  </h3>
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(businessStats.totalCost, units.currency)}
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.totalCostDesc", {
                      cost: businessStats.totalCost.toLocaleString(),
                      distance: formatDistance(businessStats.totalDistance, units.distanceUnit, t),
                    })}
                  </p>
                </div>

                <div
                  className="rounded-lg shadow p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.airportDiversity")}
                  </h3>
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {businessStats.airportDiversity}
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.airportDiversityDesc", {
                      count: businessStats.airportDiversity,
                    })}
                  </p>
                </div>

                <div
                  className="rounded-lg shadow p-6"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.avgFlightDuration")}
                  </h3>
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {businessStats.avgFlightDuration.toFixed(1)}h
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("stats:business.avgFlightDurationDesc", {
                      hours: businessStats.avgFlightDuration.toFixed(1),
                    })}
                  </p>
                </div>

                {businessStats.busiestMonth && (
                  <div
                    className="rounded-lg shadow p-6"
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                      {t("stats:business.busiestMonth")}
                    </h3>
                    <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                      {businessStats.busiestMonth}
                    </p>
                    <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                      {t("stats:business.busiestMonthDesc", {
                        month: businessStats.busiestMonth,
                        count: businessStats.busiestMonthFlights,
                      })}
                    </p>
                  </div>
                )}

                {businessStats.mostCommonCategory && (
                  <div
                    className="rounded-lg shadow p-6"
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                      {t("stats:business.mostCommonCategory")}
                    </h3>
                    <p
                      className="text-3xl font-bold capitalize"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {businessStats.mostCommonCategory}
                    </p>
                  </div>
                )}

                {Object.keys(businessStats.seatClassDistribution).length > 0 && (
                  <div
                    className="rounded-lg shadow p-6 col-span-1 md:col-span-2 lg:col-span-3"
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <h3
                      className="text-lg font-semibold mb-4"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {t("stats:business.seatClassDistribution")}
                    </h3>
                    <div className="space-y-2">
                      {Object.entries(businessStats.seatClassDistribution).map(
                        ([seatClass, percentage]) => (
                          <div key={seatClass} className="flex items-center justify-between">
                            <span className="capitalize" style={{ color: "var(--text-muted)" }}>
                              {seatClass.replace("_", " ")}
                            </span>
                            <div className="flex items-center gap-4">
                              <div
                                className="w-32 rounded-full h-2"
                                style={{ background: "var(--bg-muted)" }}
                              >
                                <div
                                  className="h-2 rounded-full"
                                  style={{ background: "var(--accent)", width: `${percentage}%` }}
                                />
                              </div>
                              <span
                                className="text-sm font-semibold w-12 text-right"
                                style={{ color: "var(--text-primary)" }}
                              >
                                {percentage}%
                              </span>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Unique Statistics */}
          {uniqueStats ? (
            <div className="mt-8">
              <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
                {t("stats:unique.title")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Always show some stats even if values are 0 */}
                <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:unique.timeTravelIndex")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.timeTravelIndex}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:unique.timeTravelIndexDesc", { count: uniqueStats.timeTravelIndex })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:unique.equatorCrossings")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.equatorCrossings}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:unique.equatorCrossingsDesc", {
                      count: uniqueStats.equatorCrossings,
                    })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-cyan-500 to-blue-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:unique.arcticFlights")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.arcticFlights}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:unique.arcticFlightsDesc", { count: uniqueStats.arcticFlights })}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-blue-500 to-teal-500 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">
                    {t("stats:unique.oceanCrossings")}
                  </h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.oceanCrossings}</p>
                  <p className="text-sm opacity-75">
                    {t("stats:unique.oceanCrossingsDesc", { count: uniqueStats.oceanCrossings })}
                  </p>
                </div>

                {uniqueStats.hemisphereHops !== undefined && (
                  <div className="bg-gradient-to-br from-emerald-500 to-green-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.hemisphereHops")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.hemisphereHops}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.hemisphereHopsDesc", { count: uniqueStats.hemisphereHops })}
                    </p>
                  </div>
                )}

                {uniqueStats.dateLineCrossings !== undefined && (
                  <div className="bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.dateLineCrossings")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.dateLineCrossings}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.dateLineCrossingsDesc", {
                        count: uniqueStats.dateLineCrossings,
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.continentalExplorer !== undefined && (
                  <div className="bg-gradient-to-br from-amber-500 to-yellow-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.continentalExplorer")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.continentalExplorer}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.continentalExplorerDesc", {
                        count: uniqueStats.continentalExplorer,
                      })}
                    </p>
                    {uniqueStats.continents && uniqueStats.continents.length > 0 && (
                      <p className="text-xs opacity-60 mt-2">{uniqueStats.continents.join(", ")}</p>
                    )}
                  </div>
                )}

                {uniqueStats.tropicsTraveler !== undefined && (
                  <div className="bg-gradient-to-br from-orange-400 to-yellow-400 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.tropicsTraveler")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.tropicsTraveler}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.tropicsTravelerDesc", {
                        count: uniqueStats.tropicsTraveler,
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.eastWestBalance && (
                  <div className="bg-gradient-to-br from-slate-500 to-gray-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.eastWestBalance")}
                    </h3>
                    <p className="text-2xl font-bold mb-1">
                      {uniqueStats.eastWestBalance.eastward}E /{" "}
                      {uniqueStats.eastWestBalance.westward}W
                    </p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.eastWestBalanceDesc", {
                        eastward: uniqueStats.eastWestBalance.eastward,
                        westward: uniqueStats.eastWestBalance.westward,
                        ratio: uniqueStats.eastWestBalance.ratio.toFixed(2),
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.sameDayReturns !== undefined && (
                  <div className="bg-gradient-to-br from-teal-500 to-cyan-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.sameDayReturns")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.sameDayReturns}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.sameDayReturnsDesc", { count: uniqueStats.sameDayReturns })}
                    </p>
                  </div>
                )}

                {uniqueStats.midnightFlights !== undefined && (
                  <div className="bg-gradient-to-br from-indigo-600 to-blue-600 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.midnightFlights")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.midnightFlights}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.midnightFlightsDesc", {
                        count: uniqueStats.midnightFlights,
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.seasonalExplorer !== undefined && (
                  <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.seasonalExplorer")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">
                      {uniqueStats.seasonalExplorer ? "✓" : "✗"}
                    </p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.seasonalExplorerDesc", {
                        count: uniqueStats.seasonsCount || 0,
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.internationalVsDomestic && (
                  <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.internationalVsDomestic")}
                    </h3>
                    <p className="text-2xl font-bold mb-1">
                      {uniqueStats.internationalVsDomestic.international}I /{" "}
                      {uniqueStats.internationalVsDomestic.domestic}D
                    </p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.internationalVsDomesticDesc", {
                        international: uniqueStats.internationalVsDomestic.international,
                        domestic: uniqueStats.internationalVsDomestic.domestic,
                        ratio: uniqueStats.internationalVsDomestic.ratio.toFixed(2),
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.roundTripMaster !== undefined && (
                  <div className="bg-gradient-to-br from-cyan-500 to-blue-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.roundTripMaster")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.roundTripMaster}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.roundTripMasterDesc", {
                        count: uniqueStats.roundTripMaster,
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.highestAirport && (
                  <div className="bg-gradient-to-br from-gray-600 to-gray-700 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.highestAirport")}
                    </h3>
                    <p className="text-2xl font-bold mb-1">{uniqueStats.highestAirport.name}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.highestAirportDesc", {
                        name: uniqueStats.highestAirport.name,
                        code: uniqueStats.highestAirport.code,
                        altitude: uniqueStats.highestAirport.altitude,
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.northernmost && (
                  <div className="bg-gradient-to-br from-sky-500 to-cyan-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.northernmost")}
                    </h3>
                    <p className="text-2xl font-bold mb-1">{uniqueStats.northernmost.code}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.northernmostDesc", {
                        code: uniqueStats.northernmost.code,
                        lat: uniqueStats.northernmost.lat.toFixed(2),
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.southernmost && (
                  <div className="bg-gradient-to-br from-teal-500 to-green-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.southernmost")}
                    </h3>
                    <p className="text-2xl font-bold mb-1">{uniqueStats.southernmost.code}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.southernmostDesc", {
                        code: uniqueStats.southernmost.code,
                        lat: Math.abs(uniqueStats.southernmost.lat).toFixed(2),
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.longestTravelChain > 1 && (
                  <div className="bg-gradient-to-br from-violet-500 to-purple-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.longestTravelChain")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.longestTravelChain}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.longestTravelChainDesc", {
                        count: uniqueStats.longestTravelChain,
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.fastestRoute && (
                  <div className="bg-gradient-to-br from-yellow-500 to-orange-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.fastestRoute")}
                    </h3>
                    <p className="text-2xl font-bold mb-1">{uniqueStats.fastestRoute.route}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.fastestRouteDesc", {
                        route: uniqueStats.fastestRoute.route,
                        speed: uniqueStats.fastestRoute.speed,
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.mostCountriesInDay > 0 && uniqueStats.mostCountriesDate && (
                  <div className="bg-gradient-to-br from-rose-500 to-pink-500 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.mostCountriesInDay")}
                    </h3>
                    <p className="text-4xl font-bold mb-1">{uniqueStats.mostCountriesInDay}</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.mostCountriesInDayDesc", {
                        count: uniqueStats.mostCountriesInDay,
                        date: new Date(uniqueStats.mostCountriesDate).toLocaleDateString(),
                      })}
                    </p>
                  </div>
                )}

                {uniqueStats.longestLayover && (
                  <div className="bg-gradient-to-br from-amber-600 to-orange-600 rounded-lg p-6 text-white shadow-md">
                    <h3 className="text-sm font-medium opacity-90 mb-2">
                      {t("stats:unique.longestLayover")}
                    </h3>
                    <p className="text-3xl font-bold mb-1">{uniqueStats.longestLayover.hours}h</p>
                    <p className="text-sm opacity-75">
                      {t("stats:unique.longestLayoverDesc", {
                        hours: uniqueStats.longestLayover.hours,
                        from: uniqueStats.longestLayover.from,
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-8">
              <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
                {t("stats:unique.title")}
              </h2>
              <div
                className="rounded-lg shadow p-6 text-center"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                <p className="" style={{ color: "var(--text-muted)" }}>
                  {t("stats:loading")}
                </p>
              </div>
            </div>
          )}
          {/* Seat Statistics */}
          {seatStats &&
          seatStats.windowCount +
            seatStats.middleCount +
            seatStats.aisleCount +
            seatStats.unknownCount >
            0 ? (
            <div className="mt-8">
              <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
                {t("stats:seats.title")}
              </h2>
              <div
                className="rounded-lg shadow p-6"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Position distribution */}
                  <div>
                    <h3
                      className="text-lg font-semibold mb-3"
                      style={{ color: "var(--text-primary)" }}
                    >
                      Window / Middle / Aisle
                    </h3>
                    {[
                      {
                        label: t("stats:seats.window"),
                        count: seatStats.windowCount,
                        color: "bg-blue-500",
                      },
                      {
                        label: t("stats:seats.middle"),
                        count: seatStats.middleCount,
                        color: "bg-yellow-500",
                      },
                      {
                        label: t("stats:seats.aisle"),
                        count: seatStats.aisleCount,
                        color: "bg-green-500",
                      },
                    ].map((item) => {
                      const total =
                        seatStats.windowCount + seatStats.middleCount + seatStats.aisleCount;
                      const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                      return (
                        <div key={item.label} className="mb-2">
                          <div
                            className="flex justify-between text-sm mb-1"
                            style={{ color: "var(--text-primary)" }}
                          >
                            <span>{item.label}</span>
                            <span>
                              {item.count} ({pct}%)
                            </span>
                          </div>
                          <div
                            className="w-full rounded-full h-2"
                            style={{ background: "var(--color-border)" }}
                          >
                            <div
                              className={`${item.color} h-2 rounded-full`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Zone distribution */}
                  <div>
                    <h3
                      className="text-lg font-semibold mb-3"
                      style={{ color: "var(--text-primary)" }}
                    >
                      Front / Middle / Back
                    </h3>
                    {[
                      {
                        label: t("stats:seats.front"),
                        count: seatStats.frontCount,
                        color: "bg-purple-500",
                      },
                      {
                        label: t("stats:seats.middleZone"),
                        count: seatStats.middleZoneCount,
                        color: "bg-indigo-500",
                      },
                      {
                        label: t("stats:seats.back"),
                        count: seatStats.backCount,
                        color: "bg-pink-500",
                      },
                    ].map((item) => {
                      const total =
                        seatStats.frontCount + seatStats.middleZoneCount + seatStats.backCount;
                      const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
                      return (
                        <div key={item.label} className="mb-2">
                          <div
                            className="flex justify-between text-sm mb-1"
                            style={{ color: "var(--text-primary)" }}
                          >
                            <span>{item.label}</span>
                            <span>
                              {item.count} ({pct}%)
                            </span>
                          </div>
                          <div
                            className="w-full rounded-full h-2"
                            style={{ background: "var(--color-border)" }}
                          >
                            <div
                              className={`${item.color} h-2 rounded-full`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Most common seat + avg row */}
                  <div className="flex flex-col gap-3">
                    {seatStats.mostCommonSeat && (
                      <div
                        className="p-4 rounded-lg"
                        style={{
                          background: "var(--bg-muted)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                          {t("stats:seats.mostCommon")}
                        </p>
                        <p
                          className="text-3xl font-bold mt-1"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {seatStats.mostCommonSeat}
                        </p>
                      </div>
                    )}
                    {seatStats.avgRowNumber !== null && (
                      <div
                        className="p-4 rounded-lg"
                        style={{
                          background: "var(--bg-muted)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                          {t("stats:seats.avgRow")}
                        </p>
                        <p
                          className="text-3xl font-bold mt-1"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {seatStats.avgRowNumber}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Seat class distribution */}
                  {Object.keys(seatStats.seatClassDistribution).length > 0 && (
                    <div>
                      <h3
                        className="text-lg font-semibold mb-3"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {t("stats:seats.seatClassTitle")}
                      </h3>
                      {Object.entries(seatStats.seatClassDistribution).map(([cls, count]) => {
                        const total = Object.values(seatStats.seatClassDistribution).reduce(
                          (a, b) => a + b,
                          0
                        );
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                          <div key={cls} className="mb-2">
                            <div
                              className="flex justify-between text-sm mb-1"
                              style={{ color: "var(--text-primary)" }}
                            >
                              <span className="capitalize">{cls.replace(/_/g, " ")}</span>
                              <span>
                                {count} ({pct}%)
                              </span>
                            </div>
                            <div
                              className="w-full rounded-full h-2"
                              style={{ background: "var(--color-border)" }}
                            >
                              <div
                                className="bg-teal-500 h-2 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            seatStats !== null && (
              <div className="mt-8">
                <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
                  {t("stats:seats.title")}
                </h2>
                <div
                  className="rounded-lg shadow p-6 text-center"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <p style={{ color: "var(--text-muted)" }}>{t("stats:seats.noData")}</p>
                </div>
              </div>
            )
          )}

          {/* Airline Loyalty Ranking */}
          <div className="mt-8 bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <AirlineRankingCard />
          </div>

          {/* Country Distribution */}
          <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <CountryDistributionCard />
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
