// Adapter: CruiseStatsResponse + Cruise[] -> DomainStats. Pure, sync.
import type { CruiseStatsResponse } from "../../api/stats";
import type { Cruise } from "../../../types/cruise";
import type { DomainStats } from "./types";
import { toYearKeyed } from "./yearKeyed";

export interface CruiseAdapterInput {
  stats: CruiseStatsResponse;
  cruises: Cruise[];
}

const NUMBER_FMT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

const FLAG_BADGES: Array<{
  key: keyof Pick<
    CruiseStatsResponse,
    | "hasBalconyCabin"
    | "hasSuiteCabin"
    | "hasPolar"
    | "hasColdWater"
    | "hasCanalTransit"
    | "hasDatelineCrossing"
    | "hasBirthdayAtSea"
    | "hasNewYearsAtSea"
  >;
  label: string;
  emoji: string;
}> = [
  { key: "hasBalconyCabin", label: "Balkon-Kabine", emoji: "🏝️" },
  { key: "hasSuiteCabin", label: "Suite", emoji: "👑" },
  { key: "hasPolar", label: "Polar-Region", emoji: "🧊" },
  { key: "hasColdWater", label: "Kaltwasser-Fahrt", emoji: "❄️" },
  { key: "hasCanalTransit", label: "Kanal-Durchquerung", emoji: "⛴️" },
  { key: "hasDatelineCrossing", label: "Datumsgrenze überquert", emoji: "🌐" },
  { key: "hasBirthdayAtSea", label: "Geburtstag auf See", emoji: "🎂" },
  { key: "hasNewYearsAtSea", label: "Silvester auf See", emoji: "🎇" },
];

export function adaptCruise(input: CruiseAdapterInput): DomainStats {
  const { stats, cruises } = input;
  const flownOrHistorical = cruises.filter(
    (c) => c.status === "flown" || c.status === "historical"
  );

  if (stats.cruisesCount === 0 || flownOrHistorical.length === 0) {
    return { domain: "cruise", hasData: false };
  }

  const yearlyEvents: Record<number, number> = {};
  const yearlyActiveDays: Record<number, number> = {};
  const monthlyActiveDays: Record<string, number> = {};
  const dailyActiveDays: Record<string, number> = {};
  const weekdayEvents: Record<number, number> = {};

  for (const c of flownOrHistorical) {
    if (!c.startDate) continue;
    const start = new Date(c.startDate);
    if (Number.isNaN(start.getTime())) continue;

    const startYear = start.getFullYear();
    yearlyEvents[startYear] = (yearlyEvents[startYear] ?? 0) + 1;
    weekdayEvents[start.getDay()] = (weekdayEvents[start.getDay()] ?? 0) + 1;

    // Active-day expansion: inclusive day-span between start and end. When
    // endDate is missing, treat the cruise as a single-day event (still
    // useful for charting). When the span crosses a month or year
    // boundary, each day lands in the bucket of its actual calendar date.
    const end = c.endDate ? new Date(c.endDate) : start;
    const endValid = !Number.isNaN(end.getTime()) ? end : start;
    const dayCursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const lastDay = new Date(endValid.getFullYear(), endValid.getMonth(), endValid.getDate());
    while (dayCursor.getTime() <= lastDay.getTime()) {
      const y = dayCursor.getFullYear();
      const m = String(dayCursor.getMonth() + 1).padStart(2, "0");
      const d = String(dayCursor.getDate()).padStart(2, "0");
      const ymdKey = `${y}-${m}-${d}`;
      if (!dailyActiveDays[ymdKey]) {
        dailyActiveDays[ymdKey] = 1;
        yearlyActiveDays[y] = (yearlyActiveDays[y] ?? 0) + 1;
        monthlyActiveDays[`${y}-${m}`] = (monthlyActiveDays[`${y}-${m}`] ?? 0) + 1;
      }
      dayCursor.setDate(dayCursor.getDate() + 1);
    }
  }

  // Top-Reedereien — the response only carries the line names list, not
  // counts. Render each with value: 1 so the UI shows them as chips.
  const topItems = stats.cruiseLines.slice(0, 5).map((label) => ({ label, value: 1 }));

  const badges = FLAG_BADGES.filter((b) => stats[b.key]).map(({ label, emoji }) => ({
    label,
    emoji,
  }));

  return {
    domain: "cruise",
    hasData: true,
    totalEvents: stats.cruisesCount,
    totalDistanceKm: stats.totalDistanceKm,
    // Approximation: every reported cruise day counts as 24h. Good enough
    // for cross-domain "duration" KPIs; the cruise tab itself uses the
    // richer day-by-day breakdown.
    totalDurationHours: stats.totalCruiseDays * 24,
    // DomainStats.countries is a COUNTING field — only aggregate() reads it,
    // and it unions across domains. Hand it the ISO codes so a country
    // reached both by air and by sea counts once. The cruise tab's own tag
    // cloud keeps reading CruiseStatsResponse.countries (the names) directly.
    countries: stats.countriesIso ?? stats.countries,
    countriesByYear: toYearKeyed(stats.countriesByYear),
    yearlyEvents,
    yearlyActiveDays,
    monthlyActiveDays,
    dailyActiveDays,
    weekdayEvents,
    summary: {
      headlineKpis: [
        { label: "Distanz", value: `${NUMBER_FMT.format(stats.totalDistanceKm)} km` },
        { label: "Seetage", value: stats.seaDays },
        { label: "Häfen", value: stats.cruisePortsUnique },
      ],
      topItems: { title: "Top-Reedereien", items: topItems },
      badges,
      detailRoute: "/stats?tab=cruise",
    },
  };
}
