import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { flightsApi, statsApi } from "../lib/api";
import type { SummaryStats } from "../lib/api";
import AppShell from "../components/ui/AppShell";
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
import { isCountableFlight } from "../shared/flightCounting";
import { getFlightDuration, measureFlightMinutes } from "../lib/flightDuration";
import { buildAirlineBreakdown } from "../components/Stats/airlineBreakdown";
import { airlineResolvers } from "../lib/airlineUtils";
import {
  addFlightDuration,
  averageDurationMinutes,
  emptyDurationTotals,
} from "../shared/flightDuration";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import { useAuthStore } from "../store/authStore";
import { FlightCertificate, type FlightCertificateStats } from "../components/FlightCertificate";
import FlightReportActions from "../components/Stats/FlightReportActions";
import EvidencePanel from "../components/evidence/EvidencePanel";
import AirlineRankingCard from "../components/Stats/AirlineRankingCard";
import AircraftRankingCard from "../components/Stats/AircraftRankingCard";
import CountryDistributionCard from "../components/Stats/CountryDistributionCard";
import FlightYearSummaryCards from "../components/Stats/FlightYearSummaryCards";
import StatsToolbar from "../components/Stats/StatsToolbar";
import StatsTabStrip from "../components/Stats/StatsTabStrip";
import { useUrlStatsPeriod } from "../components/Stats/useStatsPeriod";
import { collectYears } from "../components/Stats/Overview/aggregate";
import { useDomainStats } from "../lib/stats/domain-stats";
import StatsOverviewCards from "../components/Stats/StatsOverviewCards";
import StatsChartsSection from "../components/Stats/StatsChartsSection";
import StatsDistanceSection from "../components/Stats/StatsDistanceSection";
import StatsFlightBreakdown from "../components/Stats/StatsFlightBreakdown";
import StatsFunSection from "../components/Stats/StatsFunSection";
import StatsBusinessSection from "../components/Stats/StatsBusinessSection";
import { useSectionVisibility } from "../hooks/useSectionVisibility";
import PunctualitySection from "../components/Stats/PunctualitySection";
import StatsUniqueSection from "../components/Stats/StatsUniqueSection";
import StatsAirportsSection from "../components/Stats/StatsAirportsSection";
import StatsSeatSection from "../components/Stats/StatsSeatSection";
import CruiseStatsSection from "../components/Stats/CruiseStatsSection";
import LodgingStatsSection from "../components/Stats/LodgingStatsSection";
import PoiStatsSection from "../components/Stats/PoiStatsSection";
import OverviewTab from "../components/Stats/Overview/OverviewTab";
import FlightScorecardBlock from "../components/Stats/scorecard/FlightScorecardBlock";
import type { WindowKind } from "../components/Stats/scorecard/TimeRangeControl";
import type { TimeseriesResponse } from "../lib/api/types";
import { achievementsApi } from "../lib/api/achievements";
import type { AchievementSummary } from "../types";
import { generateYearReportPdf } from "../lib/yearReportPdf";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";
import { GlobeLoader } from "../components/GlobeLoader";
import { useMinLoadingState } from "../hooks/useMinLoadingState";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { resolveStatsTab, visibleStatsTabs } from "./statsTabAccess";
import type { DomainKey } from "../shared/domains";

export default function AdvancedStatsPage(): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const { units, features } = useSettingsStore();
  const { user } = useAuthStore();
  const addToast = useToastStore((state) => state.addToast);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const showLoader = useMinLoadingState(loading, 2000);
  const [funStats, setFunStats] = useState<FunStats | null>(null);
  const [businessStats, setBusinessStats] = useState<BusinessStats | null>(null);
  const [uniqueStats, setUniqueStats] = useState<UniqueStats | null>(null);
  const [airportStats, setAirportStats] = useState<AirportStats | null>(null);
  const [seatStats, setSeatStats] = useState<SeatStats | null>(null);
  const [achievementSummary, setAchievementSummary] = useState<AchievementSummary | null>(null);
  const [showCertificate, setShowCertificate] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [rangeWindow, setRangeWindow] = useState<WindowKind>("rolling12m");
  const [timeseries, setTimeseries] = useState<TimeseriesResponse | null>(null);

  // Domain filter — `?tab=<key>` deep-links into a specific domain tab so
  // "Details →" links from the cross-domain Gesamt overview can route to
  // the right drill-down.
  const { enabled } = useEnabledDomains();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilterState] = useState<DomainKey | "all">(() => {
    const tab = searchParams.get("tab");
    if (
      tab === "all" ||
      tab === "flight" ||
      tab === "cruise" ||
      tab === "lodging" ||
      tab === "poi"
    ) {
      return tab;
    }
    return "all";
  });

  const setFilter = useCallback(
    (next: DomainKey | "all") => {
      setFilterState(next);
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === "all") params.delete("tab");
        else params.set("tab", next);
        return params;
      });
    },
    [setSearchParams]
  );

  // Sync URL → state when the user navigates back/forward or follows a
  // deep link from another page (e.g. the Gesamt-tab "Details →").
  useEffect(() => {
    const tab = searchParams.get("tab");
    const next: DomainKey | "all" =
      tab === "flight" || tab === "cruise" || tab === "lodging" || tab === "poi" ? tab : "all";
    if (next !== filter) setFilterState(next);
  }, [searchParams, filter]);

  /**
   * A tab the reader may not have.
   *
   * The tab STRIP is built from `enabled`, so a disabled domain has no button.
   * The filter itself was read straight from `?tab=`, with no such check — so
   * `/stats?tab=poi` drew the POI statistics for an account that had switched
   * the domain off, and on an instance where the beta flag was off entirely.
   * The chrome was gated and the deep link was not, which is the same gap in
   * every application that ever had one.
   *
   * POI needs the three-state answer rather than a boolean: `betaFeaturesEnabled`
   * is instance state and is `null` until `GET /settings` answers, so a hard
   * navigation to this URL would otherwise decide "not allowed" while it simply
   * did not know yet. Pending keeps the tab and shows nothing; denied falls back
   * to the overview, which is a page rather than a blank.
   */
  const placesAccess = usePlacesAccess();
  const effectiveFilter = resolveStatsTab(filter, enabled, placesAccess);

  // Which blocks this tab draws. Per tab, because hiding costs on flights says
  // nothing about cruises — and everything is visible until someone says
  // otherwise, so a section added later still appears for existing readers.
  // Keyed on the tab actually DRAWN: a refused `?tab=poi` shows the overview,
  // and its switches must not be filed under "poi".
  const sections = useSectionVisibility(effectiveFilter);

  // Year filter + comparison state
  // ONE period for every tab (owner review, 2026-09-15). The year list is the
  // union across domains, so it is fed by the same per-domain stats the
  // overview draws; they wait for the flights, which that loader supplies.
  const { stats: domainStats, loading: domainStatsLoading } = useDomainStats({
    flights,
    ready: !loading,
  });
  const periodYears = useMemo(() => collectYears(domainStats, {}), [domainStats]);
  const period = useUrlStatsPeriod(periodYears, domainStatsLoading);
  const { selectedYear, compareYear, compareEnabled, scope } = period;
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
  }, []);

  // Canonical timeseries backing the scorecard tiles + chart. "all" groups by
  // year server-side, everything else by month; "year" reuses the existing
  // selectedYear so there's no second year picker in the scorecard row.
  useEffect(() => {
    const granularity = rangeWindow === "all" ? "year" : "month";
    const year = rangeWindow === "year" ? (selectedYear ?? undefined) : undefined;
    statsApi
      .getTimeseries({ domain: "flight", granularity, window: rangeWindow, year })
      .then(setTimeseries)
      .catch((err: unknown) => {
        logger.error("Failed to load timeseries", err);
        setTimeseries(null);
      });
  }, [rangeWindow, selectedYear]);

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

      // Use flown + historical flights for statistics; scheduled/cancelled are excluded.
      // Historical flights have unreliable times (often 12:00 placeholders) but contribute
      // accurately to airport/distance/airline/route counts, and `calculateDuration` falls
      // back to a great-circle estimate for DATE_ONLY rows so duration aggregates stay sane.
      setFlights(allFlights.filter(isCountableFlight));

      const [fun, business, unique, airports, seat, achievements] = await Promise.all([
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
        achievementsApi.getAll().catch((err) => {
          logger.error("Failed to load achievement summary:", err);
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
      if (achievements) setAchievementSummary(achievements.summary);
    } catch (error) {
      logger.error("Failed to load flights:", error);
    } finally {
      setLoading(false);
    }
  };

  // Flight duration in hours. Prefers the backend-computed tz-aware value
  // (`flight.durationMinutes`) when present, otherwise falls back to
  // `getFlightDuration` which transparently switches to a great-circle
  // estimate for DATE_ONLY rows (collapsed dep == arr) — without that
  // estimate the 63 historical date-only rows in this user's data
  // would have contributed 0h to every aggregate.
  const calculateDuration = (flight: Flight): number => {
    if (flight.durationMinutes != null && flight.durationMinutes > 0) {
      return flight.durationMinutes / 60;
    }
    const d = getFlightDuration(flight);
    return d ? d.minutes / 60 : 0;
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

  // Airline statistics. Grouped by the CODE (forgejo#81), through the same
  // rule the server's ranking uses: "SWISS" and "Swiss" are one carrier, and
  // a flight with no airline is counted apart instead of becoming a group
  // whose label is the empty string — that was the empty row in the list.
  // The fold itself lives in `components/Stats/airlineBreakdown.ts`, where
  // its identity (the group KEY, never the label) has a test of its own. ONE
  // call: the "no airline named" count comes back from the same fold as the
  // rows, rather than from a second `groupAirlines` over the same flights.
  const { byGroupKey: airlineStats, withoutAirline: flightsWithoutAirline } = buildAirlineBreakdown(
    flights,
    airlineResolvers,
    calculateDuration
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

  // #268 — one definition, shared with the server. The measured value is the
  // backend's tz-aware `durationMinutes` where the row has one, otherwise this
  // page's own reading of the timestamps; a row with neither contributes a
  // labelled great-circle estimate instead of a silent zero.
  const durationTotals = flights.reduce((totals, flight) => {
    const backendMinutes =
      flight.durationMinutes != null && flight.durationMinutes > 0 ? flight.durationMinutes : null;
    return addFlightDuration(totals, {
      measuredMinutes: backendMinutes ?? measureFlightMinutes(flight),
      depLat: flight.depLat ?? null,
      depLon: flight.depLon ?? null,
      arrLat: flight.arrLat ?? null,
      arrLon: flight.arrLon ?? null,
    });
  }, emptyDurationTotals());

  const totalFlightTime = durationTotals.totalMinutes / 60;

  // Divided by the flights that CONTRIBUTED a duration, not by every flight.
  // The old denominator (`flights.length`) counted rows that added zero hours,
  // so this figure was systematically lower than the business block's average
  // sitting on the same screen under the identical German label.
  const avgFlightDurationMinutes = averageDurationMinutes(durationTotals);
  const avgFlightDuration = avgFlightDurationMinutes === null ? 0 : avgFlightDurationMinutes / 60;

  const flightDurations = flights
    .map((f) => ({ flight: f, duration: calculateDuration(f) }))
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

  // Certificate derived stats. The label, not the group key — a certificate
  // naming "iata:LH" would be a leak of the identity into the copy.
  const topAirline: string | null = sortedAirlines.length > 0 ? sortedAirlines[0][1].label : null;

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

  if (showLoader) {
    return (
      <AppShell width="list">
        <div className="flex min-h-[60vh] items-center justify-center">
          <GlobeLoader size={180} label={t("common:loading.stats")} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell width="list">
      <div>
        {/* Mounted ONCE for the whole page (Task 9) — every tile below opens
            it by writing `?evidence=<kind>:<key>`, never by rendering a
            second instance. */}
        <EvidencePanel />
        <StatsTabStrip
          tabs={visibleStatsTabs(enabled, placesAccess)}
          active={filter}
          onSelect={setFilter}
        />

        <StatsToolbar
          tab={effectiveFilter}
          years={periodYears}
          period={period}
          visibility={sections}
        />

        <div className="py-6 sm:py-8">
          {/* Gesamt — pure cross-domain overview, no flight deep-dives. */}
          {effectiveFilter === "all" && (
            <OverviewTab
              stats={domainStats}
              loading={domainStatsLoading}
              period={period}
              visibility={sections}
              achievements={achievementSummary}
            />
          )}

          {/* Cruise tab renders its own stats section. */}
          {effectiveFilter === "cruise" && (
            <CruiseStatsSection scope={scope} visibility={sections} />
          )}
          {/* Moved off the dashboard map, where these numbers floated on top of
              the world the user came to look at. */}
          {effectiveFilter === "lodging" && (
            <LodgingStatsSection scope={scope} visibility={sections} />
          )}
          {/* `allowed`, not "not denied": while the instance flag is still
              unknown this renders nothing rather than drawing the section and
              tearing it away a moment later. */}
          {effectiveFilter === "poi" && placesAccess === "allowed" && (
            <PoiStatsSection scope={scope} visibility={sections} />
          )}

          {/* Generate Certificate + Year Report Buttons — flight-only now. */}
          {effectiveFilter === "flight" && flights.length > 0 && (
            <FlightReportActions
              onGenerateCertificate={() => setShowCertificate(true)}
              onYearReport={() => void handleYearReport()}
              generatingPdf={generatingPdf}
              yearReportDisabled={generatingPdf || !selectedYear}
            />
          )}

          {/* Certificate Modal */}
          {showCertificate && (
            <FlightCertificate stats={certificateStats} onClose={() => setShowCertificate(false)} />
          )}

          {/* Flight-specific stats block — flight tab only. */}
          {effectiveFilter === "flight" && (
            <>
              {/* Scorecard: time-range control + KPI tiles + canonical chart.
                  Replaces the old separate "Yearly Trend"/"Monthly Flights"
                  charts with one range-driven view. */}
              <FlightScorecardBlock
                timeseries={timeseries}
                rangeWindow={rangeWindow}
                onRangeChange={setRangeWindow}
                selectedYear={selectedYear}
              />

              {/* Year Filter + Year-Filtered Summary Cards */}
              <FlightYearSummaryCards
                selectedYear={selectedYear}
                compareYear={compareYear}
                summaryLoading={summaryLoading}
                yearSummary={yearSummary}
                compareSummary={compareSummary}
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
              {sections.isVisible("overview") && (
                <StatsOverviewCards
                  totalFlights={flights.length}
                  totalFlightTime={totalFlightTime}
                  estimatedHours={durationTotals.estimatedMinutes / 60}
                  estimatedFlightCount={durationTotals.estimatedCount}
                  avgFlightDuration={avgFlightDuration}
                  airlineCount={Object.keys(airlineStats).length}
                />
              )}

              {/* Time-based Charts */}
              {sections.isVisible("charts") && (
                <StatsChartsSection
                  seasonalData={seasonalData}
                  weekdayData={weekdayData}
                  hasFlights={flights.length > 0}
                />
              )}

              {/* Calendar Views Section */}
              {sections.isVisible("calendar") && (
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
              )}

              {/* Distance Visualization */}
              {sections.isVisible("distance") && (
                <StatsDistanceSection
                  totalDistance={totalDistance}
                  avgDistance={avgDistance}
                  longestDistance={longestDistance}
                  shortestDistance={shortestDistance}
                />
              )}

              {/* Flight Breakdown: airlines, airports, seat classes, aircraft, status, boarding, longest/shortest */}
              {sections.isVisible("breakdown") && (
                <StatsFlightBreakdown
                  sortedAirlines={sortedAirlines}
                  flightsWithoutAirline={flightsWithoutAirline}
                  sortedAirports={sortedAirports}
                  seatClassStats={seatClassStats}
                  sortedAircraft={sortedAircraft}
                  statusStats={statusStats}
                  boardingGroupStats={boardingGroupStats}
                  longestFlight={longestFlight}
                  shortestFlight={shortestFlight}
                  totalFlights={flights.length}
                />
              )}

              {/* Punctuality (#2) — self-fetching, hides without a delay sample */}
              {sections.isVisible("punctuality") && <PunctualitySection />}

              {/* Fun Statistics */}
              {sections.isVisible("fun") && funStats && <StatsFunSection funStats={funStats} />}

              {/* Business Statistics */}
              {sections.isVisible("business") && features.enableCostTracking && businessStats && (
                <StatsBusinessSection businessStats={businessStats} />
              )}

              {/* Unique Statistics */}
              {sections.isVisible("unique") && <StatsUniqueSection uniqueStats={uniqueStats} />}

              {/* Airport Statistics */}
              {sections.isVisible("airports") && (
                <StatsAirportsSection airportStats={airportStats} />
              )}

              {/* Seat Statistics */}
              {sections.isVisible("seats") && <StatsSeatSection seatStats={seatStats} />}

              {/* Airline Loyalty Ranking */}
              {sections.isVisible("airlines") && (
                <div className="mt-8 bg-(--bg-elevated) rounded-xl shadow-sm p-6">
                  <AirlineRankingCard />
                </div>
              )}

              {/* Aircraft (Hulls) Ranking — only shows when at least one
                  flight has a tail number on file (AeroDataBox-enriched). */}
              {sections.isVisible("aircraft") && (
                <div className="mt-6 bg-(--bg-elevated) rounded-xl shadow-sm p-6">
                  <AircraftRankingCard />
                </div>
              )}

              {/* Country Distribution */}
              {sections.isVisible("countries") && (
                <div className="mt-6 bg-(--bg-elevated) rounded-xl shadow-sm p-6">
                  <CountryDistributionCard />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
