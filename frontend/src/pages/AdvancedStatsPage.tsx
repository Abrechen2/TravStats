import { useState, useEffect, useCallback } from "react";
import { flightsApi, statsApi } from "../lib/api";
import type { SummaryStats } from "../lib/api";
import NavigationBar from "../components/NavigationBar";
import FlightCalendar from "../components/FlightCalendar";
import YearHeatmap from "../components/YearHeatmap";
import type {
  AirportStats,
  Flight,
  FunStats,
  BusinessStats,
  UniqueStats,
  SeatStats,
} from "../types";
import { API_LIMITS } from "../lib/constants";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import { useAuthStore } from "../store/authStore";
import { FlightCertificate, type FlightCertificateStats } from "../components/FlightCertificate";
import AirlineRankingCard from "../components/Stats/AirlineRankingCard";
import CountryDistributionCard from "../components/Stats/CountryDistributionCard";
import StatsYearFilter from "../components/Stats/StatsYearFilter";
import StatsOverviewCards from "../components/Stats/StatsOverviewCards";
import StatsChartsSection from "../components/Stats/StatsChartsSection";
import StatsDistanceSection from "../components/Stats/StatsDistanceSection";
import StatsFlightBreakdown from "../components/Stats/StatsFlightBreakdown";
import StatsFunSection from "../components/Stats/StatsFunSection";
import StatsBusinessSection from "../components/Stats/StatsBusinessSection";
import StatsUniqueSection from "../components/Stats/StatsUniqueSection";
import StatsAirportsSection from "../components/Stats/StatsAirportsSection";
import StatsSeatSection from "../components/Stats/StatsSeatSection";
import { generateYearReportPdf } from "../lib/yearReportPdf";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";
import { SkeletonStatCards } from "../components/SkeletonLoader";
import PageTransition from "../components/PageTransition";

export default function AdvancedStatsPage(): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const { units, features } = useSettingsStore();
  const { user } = useAuthStore();
  const addToast = useToastStore((state) => state.addToast);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [funStats, setFunStats] = useState<FunStats | null>(null);
  const [businessStats, setBusinessStats] = useState<BusinessStats | null>(null);
  const [uniqueStats, setUniqueStats] = useState<UniqueStats | null>(null);
  const [airportStats, setAirportStats] = useState<AirportStats | null>(null);
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

  // Auto-select the most recent year once flight data has loaded so the
  // year-scoped buttons (PDF report, comparisons) are enabled by default.
  // Without this, "PDF Jahresbericht" appears permanently greyed out and
  // looks broken until the user discovers the year dropdown above.
  useEffect(() => {
    if (selectedYear === null && flights.length > 0) {
      const years = flights
        .map((f) => (f.departureTime ? new Date(f.departureTime).getFullYear() : null))
        .filter((y): y is number => y !== null);
      if (years.length > 0) {
        setSelectedYear(Math.max(...years));
      }
    }
  }, [flights, selectedYear]);

  useEffect(() => {
    loadFlights();
  }, []);

  const loadFlights = async (): Promise<void> => {
    try {
      setLoading(true);
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = API_LIMITS.MAX_PAGE_SIZE;

      const MAX_PAGES = 200;
      let pages = 0;
      while (pages < MAX_PAGES) {
        pages++;
        const data = await flightsApi.getAll({ limit, offset });
        allFlights = [...allFlights, ...data.flights];
        if (data.flights.length < limit) {
          break;
        }
        offset += limit;
      }

      // Only use flown flights for statistics; scheduled/cancelled are excluded
      setFlights(allFlights.filter((f) => f.status === "flown"));

      const [fun, business, unique, airports, seat] = await Promise.all([
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
        statsApi.getAirportStats().catch((err) => {
          logger.error("Failed to load airport stats:", err);
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
      if (airports) setAirportStats(airports);
      if (seat) setSeatStats(seat);
    } catch (error) {
      logger.error("Failed to load flights:", error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate flight duration in hours
  const calculateDuration = (
    departure: string | null,
    arrival: string | null,
    durationMinutes?: number
  ): number => {
    // Prefer backend-computed timezone-aware duration when available
    if (durationMinutes != null && durationMinutes > 0) {
      return durationMinutes / 60;
    }
    if (!departure || !arrival) return 0;
    // Fallback to naïve calculation (same-timezone flights)
    const dep = new Date(departure).getTime();
    const arr = new Date(arrival).getTime();
    return (arr - dep) / (1000 * 60 * 60);
  };

  // Calculate distance between two coordinates using Haversine formula
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Airline statistics
  const airlineStats = flights.reduce(
    (acc, flight) => {
      if (!acc[flight.airline]) {
        acc[flight.airline] = { count: 0, totalDuration: 0, flights: [] };
      }
      acc[flight.airline].count++;
      acc[flight.airline].totalDuration += calculateDuration(
        flight.departureTime,
        flight.arrivalTime,
        flight.durationMinutes
      );
      acc[flight.airline].flights.push(flight);
      return acc;
    },
    {} as Record<string, { count: number; totalDuration: number; flights: Flight[] }>
  );

  const sortedAirlines = Object.entries(airlineStats)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10);

  const seatClassStats = flights.reduce(
    (acc, flight) => {
      const seatClass = flight.seatClass || "unknown";
      acc[seatClass] = (acc[seatClass] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

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

  const statusStats = flights.reduce(
    (acc, flight) => {
      acc[flight.status] = (acc[flight.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const totalFlightTime = flights.reduce((sum, flight) => {
    if (!flight.departureTime || !flight.arrivalTime) return sum;
    const dur = calculateDuration(flight.departureTime, flight.arrivalTime, flight.durationMinutes);
    return isNaN(dur) || dur <= 0 ? sum : sum + dur;
  }, 0);

  const avgFlightDuration = flights.length > 0 ? totalFlightTime / flights.length : 0;

  const flightDurations = flights
    .map((f) => ({
      flight: f,
      duration: calculateDuration(f.departureTime, f.arrivalTime, f.durationMinutes),
    }))
    .filter((fd) => !isNaN(fd.duration) && fd.duration > 0);

  const longestFlight =
    flightDurations.length > 0
      ? [...flightDurations].sort((a, b) => b.duration - a.duration)[0]
      : undefined;
  const shortestFlight =
    flightDurations.length > 0
      ? [...flightDurations].sort((a, b) => a.duration - b.duration)[0]
      : undefined;

  const flightDistances = flights.map((f) => {
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
  const flightsWithDistance = flightDistances.filter((f) => f.distance > 0);
  const avgDistance =
    flightsWithDistance.length > 0 ? totalDistance / flightsWithDistance.length : 0;
  const longestDistance =
    flightsWithDistance.length > 0
      ? [...flightsWithDistance].sort((a, b) => b.distance - a.distance)[0]
      : undefined;
  const shortestDistance =
    flightsWithDistance.length > 0
      ? [...flightsWithDistance].sort((a, b) => a.distance - b.distance)[0]
      : undefined;

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

  const boardingGroupStats = flights.reduce(
    (acc, flight) => {
      if (flight.boardingGroup) {
        acc[flight.boardingGroup] = (acc[flight.boardingGroup] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  // Time-based analytics
  const flightsPerMonth = flights.reduce(
    (acc, flight) => {
      if (!flight.departureTime) return acc;
      const date = new Date(flight.departureTime);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const monthlyData = Object.entries(flightsPerMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, flights: count }));

  const flightsPerYear = flights.reduce(
    (acc, flight) => {
      if (!flight.departureTime) return acc;
      const year = new Date(flight.departureTime).getFullYear();
      acc[year] = (acc[year] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  const yearlyData = Object.entries(flightsPerYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, count]) => ({ year, flights: count }));

  const availableYears: number[] = Object.keys(flightsPerYear)
    .map(Number)
    .sort((a, b) => b - a);

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
      if (!flight.departureTime) return acc;
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
      if (!flight.departureTime) return acc;
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
      flights
        .filter((f) => f.departureTime != null)
        .map((f) => new Date(f.departureTime!).getFullYear())
        .filter((y) => !isNaN(y))
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
        (f) => f.departureTime && new Date(f.departureTime).getFullYear() === selectedYear
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

        <div className="container mx-auto px-6 py-8">
          {/* Generate Certificate + Year Report Buttons */}
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

          {/* Year Filter + Year-Filtered Summary Cards */}
          <StatsYearFilter
            availableYears={availableYears}
            selectedYear={selectedYear}
            compareYear={compareYear}
            compareEnabled={compareEnabled}
            summaryLoading={summaryLoading}
            yearSummary={yearSummary}
            compareSummary={compareSummary}
            onSelectedYearChange={setSelectedYear}
            onCompareYearChange={setCompareYear}
            onCompareEnabledChange={setCompareEnabled}
          />

          {/* Overview Stats (all-time) — clearly separated from year-scoped */}
          <div
            className="flex items-baseline gap-3 mb-3 mt-2"
            style={{
              borderBottom: "1px solid var(--color-border)",
              paddingBottom: "8px",
            }}
          >
            <span
              className="text-xs uppercase tracking-widest font-semibold"
              style={{ color: "var(--text-muted)" }}
            >
              {t("stats:overview.scopeLabel")}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("stats:overview.scopeHint")}
            </span>
          </div>
          <StatsOverviewCards
            totalFlights={flights.length}
            totalFlightTime={totalFlightTime}
            avgFlightDuration={avgFlightDuration}
            airlineCount={Object.keys(airlineStats).length}
          />

          {/* Time-based Charts */}
          <StatsChartsSection
            yearlyData={yearlyData}
            monthlyData={monthlyData}
            seasonalData={seasonalData}
            weekdayData={weekdayData}
            hasFlights={flights.length > 0}
          />

          {/* Calendar Views Section */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
              {t("stats:calendar.title")}
            </h2>
            <div className="mb-6">
              <YearHeatmap flights={flights} />
            </div>
            <div>
              <FlightCalendar flights={flights} />
            </div>
          </div>

          {/* Distance Visualization */}
          <StatsDistanceSection
            totalDistance={totalDistance}
            avgDistance={avgDistance}
            longestDistance={longestDistance}
            shortestDistance={shortestDistance}
          />

          {/* Flight Breakdown: airlines, airports, seat classes, aircraft, status, boarding, longest/shortest */}
          <StatsFlightBreakdown
            sortedAirlines={sortedAirlines}
            sortedAirports={sortedAirports}
            seatClassStats={seatClassStats}
            sortedAircraft={sortedAircraft}
            statusStats={statusStats}
            boardingGroupStats={boardingGroupStats}
            longestFlight={longestFlight}
            shortestFlight={shortestFlight}
            totalFlights={flights.length}
          />

          {/* Fun Statistics */}
          {funStats && <StatsFunSection funStats={funStats} />}

          {/* Business Statistics */}
          {features.enableCostTracking && businessStats && (
            <StatsBusinessSection businessStats={businessStats} />
          )}

          {/* Unique Statistics */}
          <StatsUniqueSection uniqueStats={uniqueStats} />

          {/* Airport Statistics */}
          <StatsAirportsSection airportStats={airportStats} />

          {/* Seat Statistics */}
          <StatsSeatSection seatStats={seatStats} />

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
