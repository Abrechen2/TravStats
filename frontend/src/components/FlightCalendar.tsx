import { useState } from "react";
import type { Flight } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { resolveAirlineDisplay } from "../lib/airlineUtils";
import AirlineLogo from "./AirlineLogo";

interface FlightCalendarProps {
  flights: Flight[];
}

interface DayData {
  date: Date;
  flights: Flight[];
  isCurrentMonth: boolean;
}

export default function FlightCalendar({ flights }: FlightCalendarProps) {
  const { t } = useTranslation(["stats", "common"]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Get calendar days for the month
  const getCalendarDays = (): DayData[] => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const prevLastDay = new Date(year, month, 0);

    const firstDayOfWeek = firstDay.getDay();
    const lastDate = lastDay.getDate();
    const prevLastDate = prevLastDay.getDate();

    const days: DayData[] = [];

    // Previous month days
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevLastDate - i);
      days.push({
        date,
        flights: getFlightsForDate(date),
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let i = 1; i <= lastDate; i++) {
      const date = new Date(year, month, i);
      days.push({
        date,
        flights: getFlightsForDate(date),
        isCurrentMonth: true,
      });
    }

    // Next month days
    const remainingDays = 42 - days.length; // 6 rows * 7 days
    for (let i = 1; i <= remainingDays; i++) {
      const date = new Date(year, month + 1, i);
      days.push({
        date,
        flights: getFlightsForDate(date),
        isCurrentMonth: false,
      });
    }

    return days;
  };

  const getFlightsForDate = (date: Date): Flight[] => {
    return flights.filter((flight) => {
      if (!flight.departureTime) return false;
      const flightDate = new Date(flight.departureTime);
      return (
        flightDate.getDate() === date.getDate() &&
        flightDate.getMonth() === date.getMonth() &&
        flightDate.getFullYear() === date.getFullYear()
      );
    });
  };

  const getIntensityColor = (flightCount: number): string => {
    if (flightCount === 0) return "bg-[var(--bg-elevated)]";
    if (flightCount === 1) return "bg-blue-200";
    if (flightCount === 2) return "bg-blue-400";
    return "bg-blue-600";
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDay(null);
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDay(null);
  };

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
    <div className="bg-[var(--bg-surface)] rounded-lg shadow-lg p-6 border border-[var(--color-border)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-[var(--text-primary)]">
          {monthNames[month]} {year}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={goToPreviousMonth}
            className="px-3 py-1 bg-[var(--bg-muted)] text-[var(--text-primary)] rounded hover:bg-[var(--bg-elevated)] transition"
          >
            ←
          </button>
          <button
            onClick={goToNextMonth}
            className="px-3 py-1 bg-[var(--bg-muted)] text-[var(--text-primary)] rounded hover:bg-[var(--bg-elevated)] transition"
          >
            →
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {/* Week day headers */}
        {weekDays.map((day) => (
          <div
            key={day}
            className="text-center text-sm font-semibold text-[var(--text-muted)] py-2"
          >
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map((dayData, index) => {
          const isToday = dayData.date.toDateString() === new Date().toDateString();
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
                  dayData.flights.length > 0 ? "text-white" : "text-[var(--text-primary)]"
                }`}
              >
                {dayData.date.getDate()}
              </span>
              {hasFlights && (
                <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2">
                  <div className="flex gap-0.5">
                    {dayData.flights.slice(0, 3).map((_, i) => (
                      <div key={i} className="w-1 h-1 rounded-full bg-[var(--bg-surface)]" />
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
        <div className="mt-6 p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-lg font-semibold text-[var(--text-primary)]">
              {selectedDay.date.toLocaleDateString("de-DE", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </h4>
            <button
              onClick={() => setSelectedDay(null)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              ✕
            </button>
          </div>
          <div className="space-y-2">
            {selectedDay.flights.map((flight) => (
              <div
                key={flight.id}
                className="p-3 bg-[var(--bg-surface)] rounded border border-[var(--color-border)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AirlineLogo
                      iata={flight.airline?.length === 2 ? flight.airline : undefined}
                      flightNumber={flight.flightNumber}
                      size={24}
                    />
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">
                        {resolveAirlineDisplay(flight.airline, flight.flightNumber) || flight.airline}{" "}
                        {flight.flightNumber}
                      </p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {flight.depIata || flight.depIcao} → {flight.arrIata || flight.arrIcao}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-[var(--text-muted)]">
                      {flight.departureTime && flight.depTimeSemantics !== "DATE_ONLY"
                        ? new Date(flight.departureTime).toLocaleTimeString("de-DE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </p>
                    {flight.seatClass && (
                      <p className="text-xs text-[var(--text-muted)]">{flight.seatClass}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
        <p className="text-sm text-[var(--text-muted)] mb-2">{t("stats:calendar.intensity")}:</p>
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded bg-[var(--bg-elevated)] border border-[var(--color-border)]" />
            <span className="text-xs text-[var(--text-muted)]">0</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded bg-blue-200" />
            <span className="text-xs text-[var(--text-muted)]">1</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded bg-blue-400" />
            <span className="text-xs text-[var(--text-muted)]">2</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded bg-blue-600" />
            <span className="text-xs text-[var(--text-muted)]">3+</span>
          </div>
        </div>
      </div>
    </div>
  );
}
