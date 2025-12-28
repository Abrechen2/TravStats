import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { flightsApi, statsApi } from '../lib/api';
import NavigationBar from '../components/NavigationBar';
import FlightCalendar from '../components/FlightCalendar';
import YearHeatmap from '../components/YearHeatmap';
import ContextualHint from '../components/Onboarding/ContextualHint';
import type { Flight, FunStats, BusinessStats, UniqueStats } from '../types';
import { STORAGE_KEYS } from '../lib/constants';
import { useTranslation } from '../hooks/useTranslation';
import { useSettingsStore } from '../store/settingsStore';
import { convertDistance, formatDistance, formatCurrency, getDistanceLabel, getCurrencySymbol } from '../lib/units';
import { logger } from '../lib/logger';
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
} from 'recharts';

export default function AdvancedStatsPage() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const { t } = useTranslation(['stats', 'common']);
  const { units } = useSettingsStore();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [funStats, setFunStats] = useState<FunStats | null>(null);
  const [businessStats, setBusinessStats] = useState<BusinessStats | null>(null);
  const [uniqueStats, setUniqueStats] = useState<UniqueStats | null>(null);

  useEffect(() => {
    loadFlights();
    // Mark stats as viewed in onboarding
    const onboarding = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.ONBOARDING_CHECKLIST) || '{}'
    );
    if (!onboarding.statsViewed) {
      onboarding.statsViewed = true;
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_CHECKLIST, JSON.stringify(onboarding));
    }
  }, []);

  const loadFlights = async () => {
    try {
      setLoading(true);
      // Load all flights by pagination (max 100 per request)
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = 100;

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
      const [fun, business, unique] = await Promise.all([
        statsApi.getFunStats().catch((err) => {
          logger.error('Failed to load fun stats:', err);
          return null;
        }),
        statsApi.getBusinessStats().catch((err) => {
          logger.error('Failed to load business stats:', err);
          return null;
        }),
        statsApi.getUniqueStats().catch((err) => {
          logger.error('Failed to load unique stats:', err);
          return null;
        }),
      ]);
      
      if (fun) setFunStats(fun);
      if (business) setBusinessStats(business);
      if (unique) {
        logger.debug('Loaded unique stats:', unique);
        setUniqueStats(unique);
      } else {
        logger.warn('Unique stats are null or failed to load');
      }
    } catch (error) {
      logger.error('Failed to load flights:', error);
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
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  };

  // Airline statistics
  const airlineStats = flights.reduce((acc, flight) => {
    if (!acc[flight.airline]) {
      acc[flight.airline] = {
        count: 0,
        totalDuration: 0,
        flights: [],
      };
    }
    acc[flight.airline].count++;
    acc[flight.airline].totalDuration += calculateDuration(flight.departureTime, flight.arrivalTime);
    acc[flight.airline].flights.push(flight);
    return acc;
  }, {} as Record<string, { count: number; totalDuration: number; flights: Flight[] }>);

  // Sort airlines by count
  const sortedAirlines = Object.entries(airlineStats)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10);

  // Seat class statistics
  const seatClassStats = flights.reduce((acc, flight) => {
    const seatClass = flight.seatClass || 'unknown';
    acc[seatClass] = (acc[seatClass] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Aircraft statistics
  const aircraftStats = flights.reduce((acc, flight) => {
    if (flight.aircraft) {
      acc[flight.aircraft] = (acc[flight.aircraft] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const sortedAircraft = Object.entries(aircraftStats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  // Status statistics
  const statusStats = flights.reduce((acc, flight) => {
    acc[flight.status] = (acc[flight.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Total flight time
  const totalFlightTime = flights.reduce((sum, flight) => {
    return sum + calculateDuration(flight.departureTime, flight.arrivalTime);
  }, 0);

  // Average flight duration
  const avgFlightDuration = flights.length > 0 ? totalFlightTime / flights.length : 0;

  // Longest and shortest flights
  const flightDurations = flights
    .map(f => ({
      flight: f,
      duration: calculateDuration(f.departureTime, f.arrivalTime)
    }))
    .filter(fd => !isNaN(fd.duration) && fd.duration > 0); // Filter out invalid durations
  
  const longestFlight = flightDurations.length > 0 
    ? flightDurations.sort((a, b) => b.duration - a.duration)[0] 
    : undefined;
  const shortestFlight = flightDurations.length > 0 
    ? flightDurations.sort((a, b) => a.duration - b.duration)[0] 
    : undefined;

  // Distance calculations
  const flightDistances = flights.map(f => {
    // Skip flights with missing coordinates
    const hasCoords = f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null;
    if (!hasCoords) {
      return { flight: f, distance: 0 };
    }
    try {
      const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      return { flight: f, distance: dist };
    } catch (err) {
      return { flight: f, distance: 0 };
    }
  });

  const totalDistance = flightDistances.reduce((sum, f) => sum + f.distance, 0);
  const avgDistance = flights.length > 0 ? totalDistance / flights.length : 0;
  const longestDistance = flightDistances.length > 0 ? flightDistances.sort((a, b) => b.distance - a.distance)[0] : undefined;
  const shortestDistance = flightDistances.length > 0 ? flightDistances.sort((a, b) => a.distance - b.distance)[0] : undefined;

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
  const airportVisits = flights.reduce((acc, flight) => {
    const depCode = flight.depIata || flight.depIcao || 'Unknown';
    const arrCode = flight.arrIata || flight.arrIcao || 'Unknown';
    acc[depCode] = (acc[depCode] || 0) + 1;
    acc[arrCode] = (acc[arrCode] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedAirports = Object.entries(airportVisits)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  // Boarding group statistics
  const boardingGroupStats = flights.reduce((acc, flight) => {
    if (flight.boardingGroup) {
      acc[flight.boardingGroup] = (acc[flight.boardingGroup] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // Seat class translation
  const seatClassLabel = (key: string): string => {
    const labels: Record<string, string> = {
      economy: t('stats:seatClasses.economy'),
      premium_economy: t('stats:seatClasses.premiumEconomy'),
      business: t('stats:seatClasses.business'),
      first: t('stats:seatClasses.first'),
      unknown: t('stats:seatClasses.unknown'),
    };
    return labels[key] || key;
  };

  // Time-based analytics
  // Flights per month
  const flightsPerMonth = flights.reduce((acc, flight) => {
    const date = new Date(flight.departureTime);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const monthlyData = Object.entries(flightsPerMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({
      month,
      flights: count,
    }));

  // Flights per year
  const flightsPerYear = flights.reduce((acc, flight) => {
    const year = new Date(flight.departureTime).getFullYear();
    acc[year] = (acc[year] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const yearlyData = Object.entries(flightsPerYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, count]) => ({
      year,
      flights: count,
    }));

  // Weekday analysis
  const weekdayNames = [
    t('stats:weekdays.sunday'),
    t('stats:weekdays.monday'),
    t('stats:weekdays.tuesday'),
    t('stats:weekdays.wednesday'),
    t('stats:weekdays.thursday'),
    t('stats:weekdays.friday'),
    t('stats:weekdays.saturday'),
  ];
  const flightsPerWeekday = flights.reduce((acc, flight) => {
    const weekday = new Date(flight.departureTime).getDay();
    acc[weekday] = (acc[weekday] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const weekdayData = weekdayNames.map((name, index) => ({
    day: name,
    flights: flightsPerWeekday[index] || 0,
  }));

  // Seasonal patterns (by month name)
  const monthNames = [
    t('stats:months.jan'),
    t('stats:months.feb'),
    t('stats:months.mar'),
    t('stats:months.apr'),
    t('stats:months.may'),
    t('stats:months.jun'),
    t('stats:months.jul'),
    t('stats:months.aug'),
    t('stats:months.sep'),
    t('stats:months.oct'),
    t('stats:months.nov'),
    t('stats:months.dec'),
  ];
  const flightsPerMonthOfYear = flights.reduce((acc, flight) => {
    const month = new Date(flight.departureTime).getMonth();
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const seasonalData = monthNames.map((name, index) => ({
    month: name,
    flights: flightsPerMonthOfYear[index] || 0,
  }));

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="text-gray-600 dark:text-gray-300">{t('stats:loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <NavigationBar />

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <ContextualHint
          id="stats-page-hint"
          title={t('stats:hint.title')}
          message={t('stats:hint.message')}
          linkTo="/"
          linkText={t('stats:hint.linkText')}
        />
        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('stats:overview.totalFlights')}
            </h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{flights.length}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('stats:overview.totalFlightTime')}
            </h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
              {totalFlightTime.toFixed(1)}h
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('stats:overview.avgFlightDuration')}
            </h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
              {avgFlightDuration.toFixed(1)}h
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('stats:overview.airlines')}
            </h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
              {Object.keys(airlineStats).length}
            </p>
          </div>
        </div>

        {/* Time-based Charts Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
            {t('stats:timeBasedAnalytics.title')}
          </h2>

          {/* Yearly Trend */}
          {yearlyData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                {t('stats:timeBasedAnalytics.yearlyTrend')}
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={yearlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="year" stroke="#9ca3af" />
                  <YAxis stroke="#9ca3af" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '0.5rem',
                      color: '#fff',
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="flights"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    name={t('stats:timeBasedAnalytics.flightsLabel')}
                    dot={{ fill: '#3b82f6', r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly Bar Chart */}
          {monthlyData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                {t('stats:timeBasedAnalytics.monthlyFlights')}
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="month" stroke="#9ca3af" angle={-45} textAnchor="end" height={80} />
                  <YAxis stroke="#9ca3af" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '0.5rem',
                      color: '#fff',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="flights" fill="#10b981" name={t('stats:timeBasedAnalytics.flightsLabel')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Seasonal Patterns and Weekday Analysis */}
          {flights.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Seasonal Pattern */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                  {t('stats:timeBasedAnalytics.seasonalPatterns')}
                </h3>
                {seasonalData.some(d => d.flights > 0) ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={seasonalData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="month" stroke="#9ca3af" />
                      <YAxis stroke="#9ca3af" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: '1px solid #374151',
                          borderRadius: '0.5rem',
                          color: '#fff',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="flights" fill="#f59e0b" name={t('stats:timeBasedAnalytics.flightsLabel')} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-gray-500 dark:text-gray-400">
                    <p>{t('stats:timeBasedAnalytics.noData')}</p>
                  </div>
                )}
              </div>

              {/* Weekday Analysis */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                  {t('stats:timeBasedAnalytics.weekdayAnalysis')}
                </h3>
                {weekdayData.some(d => d.flights > 0) ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={weekdayData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="day" stroke="#9ca3af" />
                      <YAxis stroke="#9ca3af" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: '1px solid #374151',
                          borderRadius: '0.5rem',
                          color: '#fff',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="flights" fill="#8b5cf6" name={t('stats:timeBasedAnalytics.flightsLabel')} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-gray-500 dark:text-gray-400">
                    <p>{t('stats:timeBasedAnalytics.noData')}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Calendar Views Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
            {t('stats:calendar.title')}
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
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 mb-8 border border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            {t('stats:distance.title')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-700 dark:to-blue-800 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t('stats:distance.totalDistance')}
              </h3>
              <p className="text-4xl font-bold">{convertDistance(totalDistance, units.distanceUnit).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}</p>
              <p className="text-sm opacity-75 mt-1">{getDistanceLabel(units.distanceUnit, t)}</p>
            </div>

            <div className="bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-700 dark:to-purple-800 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t('stats:distance.avgPerFlight')}
              </h3>
              <p className="text-4xl font-bold">{convertDistance(avgDistance, units.distanceUnit).toFixed(0)}</p>
              <p className="text-sm opacity-75 mt-1">{getDistanceLabel(units.distanceUnit, t)}</p>
            </div>

            <div className="bg-gradient-to-br from-green-500 to-green-600 dark:from-green-700 dark:to-green-800 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">
                {t('stats:distance.earthCircumnavigations')}
              </h3>
              <p className="text-4xl font-bold">{earthCircumnavigations.toFixed(2)}</p>
              <p className="text-sm opacity-75 mt-1">{t('stats:distance.timesAroundEarth')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-900 dark:text-white font-medium">
                  {t('stats:distance.earthCircumnavigation')}
                </span>
                <span className="text-gray-900 dark:text-white font-bold">{earthCircumnavigations.toFixed(2)}×</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                <div
                  className="bg-green-500 dark:bg-green-600 rounded-full h-3 transition-all"
                  style={{ width: `${Math.min((earthCircumnavigations / 1) * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                {formatDistance(earthCircumference, units.distanceUnit, t)} {t('stats:distance.circumference')}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-900 dark:text-white font-medium">
                  {t('stats:distance.pathToMoon')}
                </span>
                <span className="text-gray-900 dark:text-white font-bold">{moonPercentage.toFixed(2)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                <div
                  className="bg-yellow-500 dark:bg-yellow-600 rounded-full h-3 transition-all"
                  style={{ width: `${Math.min(moonPercentage, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                {formatDistance(moonDistance, units.distanceUnit, t)} {t('stats:distance.distance')}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-900 dark:text-white font-medium">
                  {t('stats:distance.pathToMars')}
                </span>
                <span className="text-gray-900 dark:text-white font-bold">{marsPercentage.toFixed(4)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                <div
                  className="bg-red-500 dark:bg-red-600 rounded-full h-3 transition-all"
                  style={{ width: `${Math.min(marsPercentage, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                {formatDistance(marsDistance, units.distanceUnit, t)} {t('stats:distance.distance')} ({t('stats:distance.average')})
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-900 dark:text-white font-medium">
                  {t('stats:distance.pathToVoyager')}
                </span>
                <span className="text-gray-900 dark:text-white font-bold">{voyagerPercentage.toFixed(6)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                <div
                  className="bg-cyan-500 dark:bg-cyan-600 rounded-full h-3 transition-all"
                  style={{ width: `${Math.min(voyagerPercentage, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                {formatDistance(voyagerDistance, units.distanceUnit, t)} {t('stats:distance.fromEarth')}
              </p>
            </div>
          </div>

          {/* Longest/Shortest Distance */}
          {longestDistance && shortestDistance && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 dark:from-orange-700 dark:to-orange-800 rounded-lg p-4 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">
                  {t('stats:distance.longestDistance')}
                </h3>
                <p className="text-2xl font-bold mb-1">{formatDistance(longestDistance.distance, units.distanceUnit, t)}</p>
                <p className="text-sm opacity-75">
                  {longestDistance.flight.depIata || longestDistance.flight.depIcao} → {longestDistance.flight.arrIata || longestDistance.flight.arrIcao}
                </p>
              </div>

              <div className="bg-gradient-to-br from-teal-500 to-teal-600 dark:from-teal-700 dark:to-teal-800 rounded-lg p-4 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">
                  {t('stats:distance.shortestDistance')}
                </h3>
                <p className="text-2xl font-bold mb-1">{formatDistance(shortestDistance.distance, units.distanceUnit, t)}</p>
                <p className="text-sm opacity-75">
                  {shortestDistance.flight.depIata || shortestDistance.flight.depIcao} → {shortestDistance.flight.arrIata || shortestDistance.flight.arrIcao}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Airlines */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {t('stats:airlines.title')}
            </h2>
            <div className="space-y-3">
              {sortedAirlines.map(([airline, data]) => (
                <div key={airline} className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="text-gray-900 dark:text-white font-medium">{airline}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {t('stats:airlines.flightsTotal', {
                        count: data.count,
                        hours: data.totalDuration.toFixed(1),
                      })}
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {data.count}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Airports */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {t('stats:airports.title')}
            </h2>
            <div className="space-y-3">
              {sortedAirports.map(([airport, count]) => (
                <div key={airport} className="flex items-center justify-between">
                  <div className="text-gray-900 dark:text-white font-medium">{airport}</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {count}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Seat Classes */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {t('stats:seatClasses.title')}
            </h2>
            <div className="space-y-3">
              {Object.entries(seatClassStats).map(([seatClass, count]) => (
                <div key={seatClass} className="flex items-center justify-between">
                  <div className="text-gray-900 dark:text-white font-medium">
                    {seatClassLabel(seatClass)}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {((count / flights.length) * 100).toFixed(1)}%
                    </div>
                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {count}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Aircraft Types */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {t('stats:aircraft.title')}
            </h2>
            <div className="space-y-3">
              {sortedAircraft.map(([aircraft, count]) => (
                <div key={aircraft} className="flex items-center justify-between">
                  <div className="text-gray-900 dark:text-white font-medium">{aircraft}</div>
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {count}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Status Distribution */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {t('stats:flightStatus.title')}
            </h2>
            <div className="space-y-3">
              {Object.entries(statusStats).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        status === 'flown'
                          ? 'bg-green-500'
                          : status === 'scheduled'
                          ? 'bg-blue-500'
                          : 'bg-red-500'
                      }`}
                    />
                    <span className="text-gray-900 dark:text-white font-medium capitalize">
                      {status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {((count / flights.length) * 100).toFixed(1)}%
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      {count}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Boarding Groups */}
          {Object.keys(boardingGroupStats).length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                {t('stats:boardingGroups.title')}
              </h2>
              <div className="space-y-3">
                {Object.entries(boardingGroupStats)
                  .sort(([, a], [, b]) => b - a)
                  .map(([group, count]) => (
                    <div key={group} className="flex items-center justify-between">
                      <div className="text-gray-900 dark:text-white font-medium">
                        {t('stats:boardingGroups.group', { group })}
                      </div>
                      <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
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
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                {t('stats:flights.longest')}
              </h2>
              <div className="space-y-2">
                <p className="text-gray-900 dark:text-white">
                  <span className="font-medium">
                    {longestFlight.flight.airline || t('stats:flights.unknown')}
                  </span>{' '}
                  {longestFlight.flight.flightNumber || ''}
                </p>
                <p className="text-gray-600 dark:text-gray-300">
                  {longestFlight.flight.depIata || longestFlight.flight.depIcao || 'N/A'} →{' '}
                  {longestFlight.flight.arrIata || longestFlight.flight.arrIcao || 'N/A'}
                </p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {longestFlight.duration?.toFixed(1) || '0.0'}h
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                {t('stats:flights.shortest')}
              </h2>
              <div className="space-y-2">
                <p className="text-gray-900 dark:text-white">
                  <span className="font-medium">
                    {shortestFlight.flight.airline || t('stats:flights.unknown')}
                  </span>{' '}
                  {shortestFlight.flight.flightNumber || ''}
                </p>
                <p className="text-gray-600 dark:text-gray-300">
                  {shortestFlight.flight.depIata || shortestFlight.flight.depIcao || 'N/A'} →{' '}
                  {shortestFlight.flight.arrIata || shortestFlight.flight.arrIcao || 'N/A'}
                </p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {shortestFlight.duration?.toFixed(1) || '0.0'}h
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Fun Statistics */}
        {funStats && (
          <div className="mt-8">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
              {t('stats:fun.title')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-700 dark:to-purple-800 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.timezoneHopper')}</h3>
                <p className="text-4xl font-bold mb-1">{funStats.timezoneHopper}</p>
                <p className="text-sm opacity-75">{t('stats:fun.timezoneHopperDesc', { count: funStats.timezoneHopper })}</p>
              </div>

              <div className="bg-gradient-to-br from-yellow-500 to-orange-500 dark:from-yellow-700 dark:to-orange-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.earlyBird')}</h3>
                <p className="text-4xl font-bold mb-1">{funStats.earlyBird}</p>
                <p className="text-sm opacity-75">{t('stats:fun.earlyBirdDesc', { count: funStats.earlyBird })}</p>
              </div>

              <div className="bg-gradient-to-br from-indigo-500 to-blue-500 dark:from-indigo-700 dark:to-blue-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.nightOwl')}</h3>
                <p className="text-4xl font-bold mb-1">{funStats.nightOwl}</p>
                <p className="text-sm opacity-75">{t('stats:fun.nightOwlDesc', { count: funStats.nightOwl })}</p>
              </div>

              <div className="bg-gradient-to-br from-pink-500 to-rose-500 dark:from-pink-700 dark:to-rose-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.weekendWarrior')}</h3>
                <p className="text-4xl font-bold mb-1">{funStats.weekendWarrior}</p>
                <p className="text-sm opacity-75">{t('stats:fun.weekendWarriorDesc', { count: funStats.weekendWarrior, percentage: funStats.weekendPercentage })}</p>
              </div>

              <div className="bg-gradient-to-br from-emerald-500 to-teal-500 dark:from-emerald-700 dark:to-teal-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.loyaltyScore')}</h3>
                <p className="text-4xl font-bold mb-1">{funStats.loyaltyScore}%</p>
                <p className="text-sm opacity-75">{t('stats:fun.loyaltyScoreDesc', { score: funStats.loyaltyScore, airline: funStats.mostUsedAirline || 'N/A' })}</p>
              </div>

              <div className="bg-gradient-to-br from-cyan-500 to-blue-500 dark:from-cyan-700 dark:to-blue-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.shortHaulKing')}</h3>
                <p className="text-4xl font-bold mb-1">{funStats.shortHaulKing}</p>
                <p className="text-sm opacity-75">{t('stats:fun.shortHaulKingDesc', { count: funStats.shortHaulKing })}</p>
              </div>

              <div className="bg-gradient-to-br from-red-500 to-orange-500 dark:from-red-700 dark:to-orange-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.longHaulPilot')}</h3>
                <p className="text-4xl font-bold mb-1">{funStats.longHaulPilot}</p>
                <p className="text-sm opacity-75">{t('stats:fun.longHaulPilotDesc', { count: funStats.longHaulPilot })}</p>
              </div>

              {funStats.fastestDay && (
                <div className="bg-gradient-to-br from-violet-500 to-purple-500 dark:from-violet-700 dark:to-purple-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.fastestDay')}</h3>
                  <p className="text-2xl font-bold mb-1">{funStats.fastestDayFlights}</p>
                  <p className="text-sm opacity-75">{t('stats:fun.fastestDayDesc', { date: new Date(funStats.fastestDay).toLocaleDateString(), count: funStats.fastestDayFlights })}</p>
                </div>
              )}

              <div className="bg-gradient-to-br from-green-500 to-emerald-500 dark:from-green-700 dark:to-emerald-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.co2Footprint')}</h3>
                <p className="text-3xl font-bold mb-1">{funStats.co2FootprintKg.toLocaleString()} kg</p>
                <p className="text-sm opacity-75">{t('stats:fun.co2FootprintDesc', { kg: funStats.co2FootprintKg.toLocaleString(), elephants: funStats.co2InElephants.toFixed(1) })}</p>
              </div>

              {funStats.milestoneYear && (
                <div className="bg-gradient-to-br from-amber-500 to-yellow-500 dark:from-amber-700 dark:to-yellow-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.milestoneYear')}</h3>
                  <p className="text-4xl font-bold mb-1">{funStats.milestoneYear}</p>
                  <p className="text-sm opacity-75">{t('stats:fun.milestoneYearDesc', { year: funStats.milestoneYear, count: funStats.milestoneYearFlights })}</p>
                </div>
              )}

              {funStats.routeMaster && (
                <div className="bg-gradient-to-br from-sky-500 to-cyan-500 dark:from-sky-700 dark:to-cyan-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:fun.routeMaster')}</h3>
                  <p className="text-2xl font-bold mb-1">{funStats.routeMaster}</p>
                  <p className="text-sm opacity-75">{t('stats:fun.routeMasterDesc', { route: funStats.routeMaster, count: funStats.routeMasterCount })}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Business Statistics */}
        {businessStats && (
          <div className="mt-8">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
              {t('stats:business.title')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('stats:business.costPerKm')}</h3>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(businessStats.costPerKm, units.currency)}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('stats:business.costPerKmDesc', { cost: businessStats.costPerKm.toFixed(2) })}</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('stats:business.costPerHour')}</h3>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(businessStats.costPerHour, units.currency)}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('stats:business.costPerHourDesc', { cost: businessStats.costPerHour.toFixed(2) })}</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('stats:business.totalCost')}</h3>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(businessStats.totalCost, units.currency)}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('stats:business.totalCostDesc', { cost: businessStats.totalCost.toLocaleString(), distance: formatDistance(businessStats.totalDistance, units.distanceUnit, t) })}</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('stats:business.airportDiversity')}</h3>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{businessStats.airportDiversity}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('stats:business.airportDiversityDesc', { count: businessStats.airportDiversity })}</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('stats:business.avgFlightDuration')}</h3>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{businessStats.avgFlightDuration.toFixed(1)}h</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('stats:business.avgFlightDurationDesc', { hours: businessStats.avgFlightDuration.toFixed(1) })}</p>
              </div>

              {businessStats.busiestMonth && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('stats:business.busiestMonth')}</h3>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{businessStats.busiestMonth}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('stats:business.busiestMonthDesc', { month: businessStats.busiestMonth, count: businessStats.busiestMonthFlights })}</p>
                </div>
              )}

              {businessStats.mostCommonCategory && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{t('stats:business.mostCommonCategory')}</h3>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white capitalize">{businessStats.mostCommonCategory}</p>
                </div>
              )}

              {Object.keys(businessStats.seatClassDistribution).length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 col-span-1 md:col-span-2 lg:col-span-3">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('stats:business.seatClassDistribution')}</h3>
                  <div className="space-y-2">
                    {Object.entries(businessStats.seatClassDistribution).map(([seatClass, percentage]) => (
                      <div key={seatClass} className="flex items-center justify-between">
                        <span className="text-gray-700 dark:text-gray-300 capitalize">{seatClass.replace('_', ' ')}</span>
                        <div className="flex items-center gap-4">
                          <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-blue-500 dark:bg-blue-600 h-2 rounded-full"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold text-gray-900 dark:text-white w-12 text-right">{percentage}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Unique Statistics */}
        {uniqueStats ? (
          <div className="mt-8">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
              {t('stats:unique.title')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Always show some stats even if values are 0 */}
              <div className="bg-gradient-to-br from-indigo-600 to-purple-600 dark:from-indigo-800 dark:to-purple-800 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.timeTravelIndex')}</h3>
                <p className="text-4xl font-bold mb-1">{uniqueStats.timeTravelIndex}</p>
                <p className="text-sm opacity-75">{t('stats:unique.timeTravelIndexDesc', { count: uniqueStats.timeTravelIndex })}</p>
              </div>

              <div className="bg-gradient-to-br from-orange-500 to-red-500 dark:from-orange-700 dark:to-red-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.equatorCrossings')}</h3>
                <p className="text-4xl font-bold mb-1">{uniqueStats.equatorCrossings}</p>
                <p className="text-sm opacity-75">{t('stats:unique.equatorCrossingsDesc', { count: uniqueStats.equatorCrossings })}</p>
              </div>

              <div className="bg-gradient-to-br from-cyan-500 to-blue-500 dark:from-cyan-700 dark:to-blue-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.arcticFlights')}</h3>
                <p className="text-4xl font-bold mb-1">{uniqueStats.arcticFlights}</p>
                <p className="text-sm opacity-75">{t('stats:unique.arcticFlightsDesc', { count: uniqueStats.arcticFlights })}</p>
              </div>

              <div className="bg-gradient-to-br from-blue-500 to-teal-500 dark:from-blue-700 dark:to-teal-700 rounded-lg p-6 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.oceanCrossings')}</h3>
                <p className="text-4xl font-bold mb-1">{uniqueStats.oceanCrossings}</p>
                <p className="text-sm opacity-75">{t('stats:unique.oceanCrossingsDesc', { count: uniqueStats.oceanCrossings })}</p>
              </div>

              {uniqueStats.hemisphereHops !== undefined && (
                <div className="bg-gradient-to-br from-emerald-500 to-green-500 dark:from-emerald-700 dark:to-green-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.hemisphereHops')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.hemisphereHops}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.hemisphereHopsDesc', { count: uniqueStats.hemisphereHops })}</p>
                </div>
              )}

              {uniqueStats.dateLineCrossings !== undefined && (
                <div className="bg-gradient-to-br from-violet-500 to-fuchsia-500 dark:from-violet-700 dark:to-fuchsia-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.dateLineCrossings')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.dateLineCrossings}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.dateLineCrossingsDesc', { count: uniqueStats.dateLineCrossings })}</p>
                </div>
              )}

              {uniqueStats.continentalExplorer !== undefined && (
                <div className="bg-gradient-to-br from-amber-500 to-yellow-500 dark:from-amber-700 dark:to-yellow-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.continentalExplorer')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.continentalExplorer}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.continentalExplorerDesc', { count: uniqueStats.continentalExplorer })}</p>
                  {uniqueStats.continents && uniqueStats.continents.length > 0 && (
                    <p className="text-xs opacity-60 mt-2">{uniqueStats.continents.join(', ')}</p>
                  )}
                </div>
              )}

              {uniqueStats.tropicsTraveler !== undefined && (
                <div className="bg-gradient-to-br from-orange-400 to-yellow-400 dark:from-orange-600 dark:to-yellow-600 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.tropicsTraveler')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.tropicsTraveler}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.tropicsTravelerDesc', { count: uniqueStats.tropicsTraveler })}</p>
                </div>
              )}

              {uniqueStats.eastWestBalance && (
                <div className="bg-gradient-to-br from-slate-500 to-gray-500 dark:from-slate-700 dark:to-gray-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.eastWestBalance')}</h3>
                  <p className="text-2xl font-bold mb-1">{uniqueStats.eastWestBalance.eastward}E / {uniqueStats.eastWestBalance.westward}W</p>
                  <p className="text-sm opacity-75">{t('stats:unique.eastWestBalanceDesc', { 
                    eastward: uniqueStats.eastWestBalance.eastward, 
                    westward: uniqueStats.eastWestBalance.westward,
                    ratio: uniqueStats.eastWestBalance.ratio.toFixed(2)
                  })}</p>
                </div>
              )}

              {uniqueStats.sameDayReturns !== undefined && (
                <div className="bg-gradient-to-br from-teal-500 to-cyan-500 dark:from-teal-700 dark:to-cyan-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.sameDayReturns')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.sameDayReturns}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.sameDayReturnsDesc', { count: uniqueStats.sameDayReturns })}</p>
                </div>
              )}

              {uniqueStats.midnightFlights !== undefined && (
                <div className="bg-gradient-to-br from-indigo-600 to-blue-600 dark:from-indigo-800 dark:to-blue-800 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.midnightFlights')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.midnightFlights}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.midnightFlightsDesc', { count: uniqueStats.midnightFlights })}</p>
                </div>
              )}

              {uniqueStats.seasonalExplorer !== undefined && (
                <div className="bg-gradient-to-br from-green-500 to-emerald-500 dark:from-green-700 dark:to-emerald-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.seasonalExplorer')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.seasonalExplorer ? '✓' : '✗'}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.seasonalExplorerDesc', { count: uniqueStats.seasonsCount || 0 })}</p>
                </div>
              )}

              {uniqueStats.internationalVsDomestic && (
                <div className="bg-gradient-to-br from-purple-500 to-pink-500 dark:from-purple-700 dark:to-pink-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.internationalVsDomestic')}</h3>
                  <p className="text-2xl font-bold mb-1">{uniqueStats.internationalVsDomestic.international}I / {uniqueStats.internationalVsDomestic.domestic}D</p>
                  <p className="text-sm opacity-75">{t('stats:unique.internationalVsDomesticDesc', { 
                    international: uniqueStats.internationalVsDomestic.international,
                    domestic: uniqueStats.internationalVsDomestic.domestic,
                    ratio: uniqueStats.internationalVsDomestic.ratio.toFixed(2)
                  })}</p>
                </div>
              )}

              {uniqueStats.roundTripMaster !== undefined && (
                <div className="bg-gradient-to-br from-cyan-500 to-blue-500 dark:from-cyan-700 dark:to-blue-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.roundTripMaster')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.roundTripMaster}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.roundTripMasterDesc', { count: uniqueStats.roundTripMaster })}</p>
                </div>
              )}

              {uniqueStats.highestAirport && (
                <div className="bg-gradient-to-br from-gray-600 to-gray-700 dark:from-gray-800 dark:to-gray-900 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.highestAirport')}</h3>
                  <p className="text-2xl font-bold mb-1">{uniqueStats.highestAirport.name}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.highestAirportDesc', { name: uniqueStats.highestAirport.name, code: uniqueStats.highestAirport.code, altitude: uniqueStats.highestAirport.altitude })}</p>
                </div>
              )}

              {uniqueStats.northernmost && (
                <div className="bg-gradient-to-br from-sky-500 to-cyan-500 dark:from-sky-700 dark:to-cyan-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.northernmost')}</h3>
                  <p className="text-2xl font-bold mb-1">{uniqueStats.northernmost.code}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.northernmostDesc', { code: uniqueStats.northernmost.code, lat: uniqueStats.northernmost.lat.toFixed(2) })}</p>
                </div>
              )}

              {uniqueStats.southernmost && (
                <div className="bg-gradient-to-br from-teal-500 to-green-500 dark:from-teal-700 dark:to-green-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.southernmost')}</h3>
                  <p className="text-2xl font-bold mb-1">{uniqueStats.southernmost.code}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.southernmostDesc', { code: uniqueStats.southernmost.code, lat: Math.abs(uniqueStats.southernmost.lat).toFixed(2) })}</p>
                </div>
              )}

              {uniqueStats.longestTravelChain > 1 && (
                <div className="bg-gradient-to-br from-violet-500 to-purple-500 dark:from-violet-700 dark:to-purple-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.longestTravelChain')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.longestTravelChain}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.longestTravelChainDesc', { count: uniqueStats.longestTravelChain })}</p>
                </div>
              )}

              {uniqueStats.fastestRoute && (
                <div className="bg-gradient-to-br from-yellow-500 to-orange-500 dark:from-yellow-700 dark:to-orange-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.fastestRoute')}</h3>
                  <p className="text-2xl font-bold mb-1">{uniqueStats.fastestRoute.route}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.fastestRouteDesc', { route: uniqueStats.fastestRoute.route, speed: uniqueStats.fastestRoute.speed })}</p>
                </div>
              )}

              {uniqueStats.mostCountriesInDay > 0 && uniqueStats.mostCountriesDate && (
                <div className="bg-gradient-to-br from-rose-500 to-pink-500 dark:from-rose-700 dark:to-pink-700 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.mostCountriesInDay')}</h3>
                  <p className="text-4xl font-bold mb-1">{uniqueStats.mostCountriesInDay}</p>
                  <p className="text-sm opacity-75">{t('stats:unique.mostCountriesInDayDesc', { count: uniqueStats.mostCountriesInDay, date: new Date(uniqueStats.mostCountriesDate).toLocaleDateString() })}</p>
                </div>
              )}

              {uniqueStats.longestLayover && (
                <div className="bg-gradient-to-br from-amber-600 to-orange-600 dark:from-amber-800 dark:to-orange-800 rounded-lg p-6 text-white shadow-md">
                  <h3 className="text-sm font-medium opacity-90 mb-2">{t('stats:unique.longestLayover')}</h3>
                  <p className="text-3xl font-bold mb-1">{uniqueStats.longestLayover.hours}h</p>
                  <p className="text-sm opacity-75">{t('stats:unique.longestLayoverDesc', { 
                    hours: uniqueStats.longestLayover.hours,
                    from: uniqueStats.longestLayover.from
                  })}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
              {t('stats:unique.title')}
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center">
              <p className="text-gray-500 dark:text-gray-400">{t('stats:loading')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
