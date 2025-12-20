import { useState } from 'react';
import type { Flight } from '../types';
import { useTranslation } from '../hooks/useTranslation';

interface FlightCalendarProps {
  flights: Flight[];
}

interface DayData {
  date: Date;
  flights: Flight[];
  isCurrentMonth: boolean;
}

export default function FlightCalendar({ flights }: FlightCalendarProps) {
  const { t } = useTranslation(['stats', 'common']);
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
      const flightDate = new Date(flight.departureTime);
      return (
        flightDate.getDate() === date.getDate() &&
        flightDate.getMonth() === date.getMonth() &&
        flightDate.getFullYear() === date.getFullYear()
      );
    });
  };

  const getIntensityColor = (flightCount: number): string => {
    if (flightCount === 0) return 'bg-gray-100 dark:bg-gray-700';
    if (flightCount === 1) return 'bg-blue-200 dark:bg-blue-900';
    if (flightCount === 2) return 'bg-blue-400 dark:bg-blue-700';
    return 'bg-blue-600 dark:bg-blue-500';
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
    t('stats:calendar.months.january'),
    t('stats:calendar.months.february'),
    t('stats:calendar.months.march'),
    t('stats:calendar.months.april'),
    t('stats:calendar.months.may'),
    t('stats:calendar.months.june'),
    t('stats:calendar.months.july'),
    t('stats:calendar.months.august'),
    t('stats:calendar.months.september'),
    t('stats:calendar.months.october'),
    t('stats:calendar.months.november'),
    t('stats:calendar.months.december'),
  ];

  const weekDays = [
    t('stats:weekdays.sunday'),
    t('stats:weekdays.monday'),
    t('stats:weekdays.tuesday'),
    t('stats:weekdays.wednesday'),
    t('stats:weekdays.thursday'),
    t('stats:weekdays.friday'),
    t('stats:weekdays.saturday'),
  ];

  const calendarDays = getCalendarDays();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white">
          {monthNames[month]} {year}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={goToPreviousMonth}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition"
          >
            ←
          </button>
          <button
            onClick={goToNextMonth}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition"
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
            className="text-center text-sm font-semibold text-gray-600 dark:text-gray-400 py-2"
          >
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map((dayData, index) => {
          const isToday =
            dayData.date.toDateString() === new Date().toDateString();
          const hasFlights = dayData.flights.length > 0;

          return (
            <button
              key={index}
              onClick={() => hasFlights && setSelectedDay(dayData)}
              className={`
                relative aspect-square p-2 rounded-lg text-center transition-all
                ${!dayData.isCurrentMonth ? 'opacity-30' : ''}
                ${isToday ? 'ring-2 ring-blue-500' : ''}
                ${hasFlights ? 'cursor-pointer hover:scale-105' : 'cursor-default'}
                ${getIntensityColor(dayData.flights.length)}
              `}
            >
              <span
                className={`text-sm font-medium ${
                  dayData.flights.length > 0
                    ? 'text-white dark:text-white'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {dayData.date.getDate()}
              </span>
              {hasFlights && (
                <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2">
                  <div className="flex gap-0.5">
                    {dayData.flights.slice(0, 3).map((_, i) => (
                      <div
                        key={i}
                        className="w-1 h-1 rounded-full bg-white"
                      />
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
        <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              {selectedDay.date.toLocaleDateString('de-DE', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </h4>
            <button
              onClick={() => setSelectedDay(null)}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              ✕
            </button>
          </div>
          <div className="space-y-2">
            {selectedDay.flights.map((flight) => (
              <div
                key={flight.id}
                className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {flight.airline} {flight.flightNumber}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {flight.depIata || flight.depIcao} →{' '}
                      {flight.arrIata || flight.arrIcao}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {new Date(flight.departureTime).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {flight.seatClass && (
                      <p className="text-xs text-gray-500 dark:text-gray-500">
                        {flight.seatClass}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          {t('stats:calendar.intensity')}:
        </p>
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600" />
            <span className="text-xs text-gray-600 dark:text-gray-400">0</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded bg-blue-200 dark:bg-blue-900" />
            <span className="text-xs text-gray-600 dark:text-gray-400">1</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded bg-blue-400 dark:bg-blue-700" />
            <span className="text-xs text-gray-600 dark:text-gray-400">2</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded bg-blue-600 dark:bg-blue-500" />
            <span className="text-xs text-gray-600 dark:text-gray-400">3+</span>
          </div>
        </div>
      </div>
    </div>
  );
}
