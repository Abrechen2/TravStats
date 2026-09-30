import { useState } from "react";
import type { Flight } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { resolveAirlineDisplay } from "../lib/airlineUtils";
import { formatLocalDate } from "../lib/displayFormat";
import { flightDeparture } from "../lib/entityTimes";
import { todayZoneNow } from "../hooks/useTodayZone";
import {
  addDays,
  dayOf,
  daysBetween,
  dayString,
  formatDayLong,
  todayIn,
  weekdayOf,
} from "../shared/time";

interface YearHeatmapProps {
  flights: Flight[];
}

/**
 * One square of the year grid. `day` is a `YYYY-MM-DD` calendar day (ADR
 * 0002): the grid steps with UTC arithmetic on day strings, and a flight
 * counts on the day it departed AT ITS AIRPORT (`times.departure.local`) —
 * never on the reader's own calendar.
 */
interface DayCell {
  day: string;
  flightCount: number;
  flights: Flight[];
}

/** The departure airport's day of a flight, or null when it has none. */
function departureDayOf(flight: Flight): string | null {
  const departure = flightDeparture(flight);
  return departure ? dayOf(departure) : null;
}

export default function YearHeatmap({ flights }: YearHeatmapProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "common"]);
  // The year "today" falls in, in the profile zone (Q1).
  const [selectedYear, setSelectedYear] = useState(() =>
    Number(todayIn(todayZoneNow()).slice(0, 4))
  );
  const [hoveredCell, setHoveredCell] = useState<DayCell | null>(null);

  const flightDays = flights
    .map((flight) => ({ flight, day: departureDayOf(flight) }))
    .filter((entry): entry is { flight: Flight; day: string } => entry.day !== null);
  const yearOf = (day: string): number => Number(day.slice(0, 4));

  // Get all years from flights
  const availableYears = Array.from(new Set(flightDays.map(({ day }) => yearOf(day)))).sort(
    (a, b) => b - a
  );

  // Whole weeks, Sunday first, from the Sunday on or before 1 January to the
  // Saturday on or after 31 December.
  const generateYearData = (): DayCell[][] => {
    const jan1 = dayString(selectedYear, 1, 1);
    const dec31 = dayString(selectedYear, 12, 31);
    const start = addDays(jan1, -weekdayOf(jan1));
    const end = addDays(dec31, 6 - weekdayOf(dec31));
    const weeks: DayCell[][] = [];
    for (let offset = 0; offset <= daysBetween(start, end); offset += 7) {
      weeks.push(
        Array.from({ length: 7 }, (_, i) => {
          const day = addDays(start, offset + i);
          const dayFlights = flightDays.filter((entry) => entry.day === day).map((e) => e.flight);
          return { day, flightCount: dayFlights.length, flights: dayFlights };
        })
      );
    }
    return weeks;
  };

  const getIntensityClass = (count: number): string => {
    if (count === 0) return "bg-(--bg-elevated) border-border";
    if (count === 1) return "bg-green-200 border-green-300";
    if (count === 2) return "bg-green-400 border-green-500";
    if (count === 3) return "bg-green-600 border-green-700";
    return "bg-green-800 border-green-900";
  };

  const yearData = generateYearData();
  const monthLabels = [
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
  const weekDayLabels = [
    t("stats:weekdays.sunday"),
    t("stats:weekdays.monday"),
    t("stats:weekdays.tuesday"),
    t("stats:weekdays.wednesday"),
    t("stats:weekdays.thursday"),
    t("stats:weekdays.friday"),
    t("stats:weekdays.saturday"),
  ];

  return (
    <div className="bg-(--bg-surface) rounded-lg shadow-lg p-6 border border-border">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-(--text-primary)">{t("stats:heatmap.title")}</h3>
        {availableYears.length > 1 && (
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-1 bg-(--bg-muted) text-(--text-primary) rounded-sm border border-border"
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Heatmap.
          overflow-y-hidden is load-bearing (#248): a bare overflow-x-auto is
          computed as overflow-y:auto, so the moment the horizontal scrollbar
          needs room the container grows a useless 1px VERTICAL scrollbar too.
          Nothing in here legitimately scrolls vertically. align-top kills the
          inline-block baseline gap that contributed the stray pixel. */}
      <div className="overflow-x-auto overflow-y-hidden">
        <div className="inline-block min-w-full align-top">
          {/* Month labels */}
          <div className="flex mb-2">
            <div className="w-8"></div>
            <div className="flex-1 flex justify-start gap-1">
              {monthLabels.map((month, i) => {
                // Approximate week position for each month
                const jan1 = dayString(selectedYear, 1, 1);
                const weekOfYear = Math.floor(
                  daysBetween(jan1, dayString(selectedYear, i + 1, 1)) / 7
                );
                const prevWeek = i > 0 ? daysBetween(jan1, dayString(selectedYear, i, 1)) / 7 : 0;

                return (
                  <div
                    key={month}
                    className="text-xs text-(--text-muted)"
                    style={{
                      width: "12px",
                      marginLeft: i === 0 ? "0" : `${(weekOfYear - prevWeek) * 13}px`,
                    }}
                  >
                    {month}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex">
            {/* Weekday labels */}
            <div className="flex flex-col gap-1 mr-2">
              {weekDayLabels.map((day, i) => (
                <div
                  key={day}
                  className="text-xs text-(--text-muted) h-3 flex items-center"
                  style={{ opacity: i % 2 === 0 ? 1 : 0 }}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div className="flex gap-1">
              {yearData.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col gap-1">
                  {week.map((day, dayIndex) => {
                    const isCurrentYear = yearOf(day.day) === selectedYear;
                    return (
                      <div
                        key={dayIndex}
                        className={`
                          w-3 h-3 rounded-xs border cursor-pointer transition-all hover:scale-125
                          ${!isCurrentYear ? "opacity-20" : ""}
                          ${getIntensityClass(day.flightCount)}
                        `}
                        onMouseEnter={() => setHoveredCell(day)}
                        onMouseLeave={() => setHoveredCell(null)}
                        title={t("stats:heatmap.dayTooltip", {
                          date: formatLocalDate(day.day),
                          count: day.flightCount,
                        })}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredCell && hoveredCell.flightCount > 0 && (
        <div className="mt-4 p-3 bg-(--bg-base) rounded-lg border border-border">
          <p className="text-sm font-semibold text-(--text-primary) mb-2">
            {formatDayLong(hoveredCell.day, i18n.language)}
          </p>
          <div className="space-y-1">
            {hoveredCell.flights.map((flight) => (
              <div key={flight.id} className="text-xs text-(--text-primary)">
                {resolveAirlineDisplay(flight) || flight.airline} {flight.flightNumber}:{" "}
                {flight.depIata || flight.depIcao} {t("common:labels.routeSeparator")}{" "}
                {flight.arrIata || flight.arrIcao}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <p className="text-sm text-(--text-muted)">{t("stats:heatmap.legend.less")}</p>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((level) => (
              <div
                key={level}
                className={`w-4 h-4 rounded-xs border ${getIntensityClass(level)}`}
              />
            ))}
          </div>
          <p className="text-sm text-(--text-muted)">{t("stats:heatmap.legend.more")}</p>
        </div>
      </div>

      {/* Statistics */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-(--text-primary)">
            {flightDays.filter(({ day }) => yearOf(day) === selectedYear).length}
          </p>
          <p className="text-xs text-(--text-muted)">
            {t("stats:heatmap.flightsInYear", { year: selectedYear })}
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-(--text-primary)">
            {
              new Set(
                flightDays.filter(({ day }) => yearOf(day) === selectedYear).map(({ day }) => day)
              ).size
            }
          </p>
          <p className="text-xs text-(--text-muted)">{t("stats:heatmap.daysWithFlights")}</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-(--text-primary)">
            {Math.max(...yearData.flat().map((d) => d.flightCount), 0)}
          </p>
          <p className="text-xs text-(--text-muted)">{t("stats:heatmap.maxFlightsPerDay")}</p>
        </div>
      </div>
    </div>
  );
}
