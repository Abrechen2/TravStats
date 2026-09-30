import { useState } from "react";
import type { Flight } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { resolveAirlineDisplay, resolveAirlineIata } from "../lib/airlineUtils";
import AirlineLogo from "./AirlineLogo";
import SpecialTypeBadge from "./specialFlights/SpecialTypeBadge";
import type { SpecialType } from "./specialFlights/specialTypeMeta";
import { formatLocalClock } from "../lib/displayFormat";
import { flightDeparture } from "../lib/entityTimes";
import { todayZoneNow } from "../hooks/useTodayZone";
import {
  addDays,
  clockOf,
  dayOf,
  dayParts,
  dayString,
  daysInMonth,
  formatDayLong,
  todayIn,
  weekdayOf,
} from "../shared/time";

interface FlightCalendarProps {
  flights: Flight[];
}

/**
 * One cell of the month view. `day` is a `YYYY-MM-DD` calendar day (ADR 0002):
 * the grid is stepped with UTC arithmetic on day strings, and a flight sits on
 * the day it departed AT ITS AIRPORT (`times.departure.local`) — never on the
 * day the reader's own clock showed at that instant.
 */
interface DayData {
  day: string;
  flights: Flight[];
  isCurrentMonth: boolean;
}

/** The departure airport's day of a flight, or null when it has none. */
function departureDayOf(flight: Flight): string | null {
  const departure = flightDeparture(flight);
  return departure ? dayOf(departure) : null;
}

/** The departure on its airport's clock, or a dash for a day-only flight. */
function departureClock(flight: Flight): string {
  const departure = flightDeparture(flight);
  const clock = departure ? clockOf(departure) : null;
  return clock ? formatLocalClock(clock) : "—";
}

export default function FlightCalendar({ flights }: FlightCalendarProps) {
  const { t, i18n } = useTranslation(["stats", "common"]);
  // "Today" in the profile zone (Q1); the month shown starts there.
  const [today] = useState(() => todayIn(todayZoneNow()));
  const [cursor, setCursor] = useState(() => {
    const { year, month } = dayParts(today);
    return { year, month };
  });
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);

  const { year } = cursor;
  /** 0-based, for the month-name list. */
  const month = cursor.month - 1;

  const getFlightsForDay = (day: string): Flight[] =>
    flights.filter((flight) => departureDayOf(flight) === day);

  // Six weeks from the Sunday on or before the 1st — 42 cells.
  const getCalendarDays = (): DayData[] => {
    const first = dayString(year, cursor.month, 1);
    const gridStart = addDays(first, -weekdayOf(first));
    const lastOfMonth = dayString(year, cursor.month, daysInMonth(year, cursor.month));
    return Array.from({ length: 42 }, (_, i) => {
      const day = addDays(gridStart, i);
      return {
        day,
        flights: getFlightsForDay(day),
        isCurrentMonth: day >= first && day <= lastOfMonth,
      };
    });
  };

  // Intensity ramp uses brand-amber gradient instead of cruise-domain blue.
  // Each cell is also labelled with the count in the tooltip / legend so the
  // colour isn't conveying state alone (BRAND.md "❌ Don't" #3).
  const getIntensityColor = (flightCount: number): string => {
    if (flightCount === 0) return "bg-(--bg-elevated)";
    if (flightCount === 1) return "bg-(--accent-soft)";
    if (flightCount === 2) return "bg-(--accent-dim)";
    return "bg-(--accent)";
  };

  const moveMonth = (by: number): void => {
    const { year: y, month: m } = dayParts(dayString(year, cursor.month + by, 1));
    setCursor({ year: y, month: m });
    setSelectedDay(null);
  };
  const goToPreviousMonth = () => moveMonth(-1);
  const goToNextMonth = () => moveMonth(1);

  const monthNames = [
    t("stats:calendar.months.january"),
    t("stats:calendar.months.february"),
    t("stats:calendar.months.march"),
    t("stats:calendar.months.april"),
    t("stats:calendar.months.may"),
    t("stats:calendar.months.june"),
    t("stats:calendar.months.july"),
    t("stats:calendar.months.august"),
    t("stats:calendar.months.september"),
    t("stats:calendar.months.october"),
    t("stats:calendar.months.november"),
    t("stats:calendar.months.december"),
  ];

  const weekDays = [
    t("stats:weekdays.sunday"),
    t("stats:weekdays.monday"),
    t("stats:weekdays.tuesday"),
    t("stats:weekdays.wednesday"),
    t("stats:weekdays.thursday"),
    t("stats:weekdays.friday"),
    t("stats:weekdays.saturday"),
  ];

  const calendarDays = getCalendarDays();

  return (
    <div className="bg-(--bg-surface) rounded-lg shadow-lg p-6 border border-border">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-(--text-primary)">
          {monthNames[month]} {year}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={goToPreviousMonth}
            className="px-3 py-1 bg-(--bg-muted) text-(--text-primary) rounded-sm hover:bg-(--bg-elevated) transition"
          >
            ←
          </button>
          <button
            onClick={goToNextMonth}
            className="px-3 py-1 bg-(--bg-muted) text-(--text-primary) rounded-sm hover:bg-(--bg-elevated) transition"
          >
            →
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {/* Week day headers */}
        {weekDays.map((day) => (
          <div key={day} className="text-center text-sm font-semibold text-(--text-muted) py-2">
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map((dayData, index) => {
          const isToday = dayData.day === today;
          const hasFlights = dayData.flights.length > 0;

          return (
            <button
              key={index}
              onClick={() => hasFlights && setSelectedDay(dayData)}
              className={`
                relative aspect-square p-2 rounded-lg text-center transition-all
                ${!dayData.isCurrentMonth ? "opacity-30" : ""}
                ${isToday ? "ring-2 ring-blue-500" : ""}
                ${hasFlights ? "cursor-pointer hover:scale-105" : "cursor-default"}
                ${getIntensityColor(dayData.flights.length)}
              `}
            >
              <span
                className={`text-sm font-medium ${
                  dayData.flights.length > 0 ? "text-white" : "text-(--text-primary)"
                }`}
              >
                {Number(dayData.day.slice(8, 10))}
              </span>
              {hasFlights && (
                <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2">
                  <div className="flex gap-0.5">
                    {dayData.flights.slice(0, 3).map((_, i) => (
                      <div key={i} className="w-1 h-1 rounded-full bg-(--bg-surface)" />
                    ))}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Day Details */}
      {selectedDay && (
        <div className="mt-6 p-4 bg-(--bg-base) rounded-lg border border-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-lg font-semibold text-(--text-primary)">
              {formatDayLong(selectedDay.day, i18n.language)}
            </h4>
            <button
              onClick={() => setSelectedDay(null)}
              className="text-(--text-muted) hover:text-(--text-primary)"
            >
              ✕
            </button>
          </div>
          <div className="space-y-2">
            {selectedDay.flights.map((flight) => (
              <div
                key={flight.id}
                className="p-3 bg-(--bg-surface) rounded-sm border border-border"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AirlineLogo
                      iata={resolveAirlineIata(flight)}
                      flightNumber={flight.flightNumber}
                      size={24}
                    />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-(--text-primary)">
                          {resolveAirlineDisplay(flight) || flight.airline} {flight.flightNumber}
                        </p>
                        {flight.specialType && (
                          <SpecialTypeBadge type={flight.specialType as SpecialType} />
                        )}
                      </div>
                      <p className="text-sm text-(--text-muted)">
                        {flight.depIata || flight.depIcao} → {flight.arrIata || flight.arrIcao}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-(--text-muted)">{departureClock(flight)}</p>
                    {flight.seatClass && (
                      <p className="text-xs text-(--text-muted)">{flight.seatClass}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-sm text-(--text-muted) mb-2">{t("stats:calendar.intensity")}:</p>
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded-sm bg-(--bg-elevated) border border-border" />
            <span className="text-xs text-(--text-muted)">0</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded-sm bg-(--accent-soft)" />
            <span className="text-xs text-(--text-muted)">1</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded-sm bg-(--accent-dim)" />
            <span className="text-xs text-(--text-muted)">2</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded-sm bg-(--accent)" />
            <span className="text-xs text-(--text-muted)">3+</span>
          </div>
        </div>
      </div>
    </div>
  );
}
