import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { flightsApi } from '../lib/api';
import DarkModeToggle from '../components/DarkModeToggle';
import FlightCalendar from '../components/FlightCalendar';
import YearHeatmap from '../components/YearHeatmap';
import ContextualHint from '../components/Onboarding/ContextualHint';
import type { Flight } from '../types';
import { STORAGE_KEYS } from '../lib/constants';
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
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);

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
    } catch (error) {
      console.error('Failed to load flights:', error);
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
  const flightDurations = flights.map(f => ({
    flight: f,
    duration: calculateDuration(f.departureTime, f.arrivalTime)
  }));
  const longestFlight = flightDurations.length > 0 ? flightDurations.sort((a, b) => b.duration - a.duration)[0] : undefined;
  const shortestFlight = flightDurations.length > 0 ? flightDurations.sort((a, b) => a.duration - b.duration)[0] : undefined;

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
  const seatClassLabel = (key: string) => {
    const labels: Record<string, string> = {
      economy: 'Economy',
      premium_economy: 'Premium Economy',
      business: 'Business',
      first: 'First Class',
      unknown: 'Nicht angegeben',
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
  const weekdayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
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
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
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
          <div className="text-gray-600 dark:text-gray-300">Lade Statistiken...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              ← Zurück
            </button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Erweiterte Statistiken
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-600 dark:text-gray-300">Welcome, {user?.username}!</span>
            <DarkModeToggle />
            <button onClick={logout} className="btn-secondary">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <ContextualHint
          id="stats-page-hint"
          title="Willkommen bei den Statistiken!"
          message="Hier finden Sie detaillierte Analysen Ihrer Flüge: Charts, Trends, Top-Routen und mehr. Scrollen Sie nach unten, um alle Statistiken zu sehen."
          linkTo="/"
          linkText="Zurück zum Dashboard"
        />
        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Gesamt Flüge</h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{flights.length}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Gesamt Flugzeit</h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
              {totalFlightTime.toFixed(1)}h
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Durchschn. Flugdauer</h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
              {avgFlightDuration.toFixed(1)}h
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Fluggesellschaften</h3>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
              {Object.keys(airlineStats).length}
            </p>
          </div>
        </div>

        {/* Time-based Charts Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
            📊 Zeitbasierte Analysen
          </h2>

          {/* Yearly Trend */}
          {yearlyData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Flüge pro Jahr - Trend-Analyse
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
                    name="Flüge"
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
                Flüge pro Monat
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
                  <Bar dataKey="flights" fill="#10b981" name="Flüge" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Seasonal Patterns and Weekday Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Seasonal Pattern */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Saisonale Muster
              </h3>
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
                  <Bar dataKey="flights" fill="#f59e0b" name="Flüge" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Weekday Analysis */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Wochentags-Analyse
              </h3>
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
                  <Bar dataKey="flights" fill="#8b5cf6" name="Flüge" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Calendar Views Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
            📅 Kalender-Ansichten
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
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Geflogene Distanz</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-700 dark:to-blue-800 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">Gesamt-Distanz</h3>
              <p className="text-4xl font-bold">{totalDistance.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}</p>
              <p className="text-sm opacity-75 mt-1">Kilometer</p>
            </div>

            <div className="bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-700 dark:to-purple-800 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">Durchschnitt pro Flug</h3>
              <p className="text-4xl font-bold">{avgDistance.toFixed(0)}</p>
              <p className="text-sm opacity-75 mt-1">Kilometer</p>
            </div>

            <div className="bg-gradient-to-br from-green-500 to-green-600 dark:from-green-700 dark:to-green-800 rounded-lg p-6 text-white shadow-md">
              <h3 className="text-sm font-medium opacity-90 mb-2">Erdumrundungen</h3>
              <p className="text-4xl font-bold">{earthCircumnavigations.toFixed(2)}</p>
              <p className="text-sm opacity-75 mt-1">× um die Erde</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-900 dark:text-white font-medium">🌍 Erde-Umrundung</span>
                <span className="text-gray-900 dark:text-white font-bold">{earthCircumnavigations.toFixed(2)}×</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                <div
                  className="bg-green-500 dark:bg-green-600 rounded-full h-3 transition-all"
                  style={{ width: `${Math.min(earthCircumnavigations * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                40.075 km Erdumfang
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-900 dark:text-white font-medium">🌙 Weg zum Mond</span>
                <span className="text-gray-900 dark:text-white font-bold">{moonPercentage.toFixed(2)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                <div
                  className="bg-yellow-500 dark:bg-yellow-600 rounded-full h-3 transition-all"
                  style={{ width: `${Math.min(moonPercentage, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                384.400 km Entfernung
              </p>
            </div>

            {marsPercentage > 0.01 && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-900 dark:text-white font-medium">🔴 Weg zum Mars</span>
                  <span className="text-gray-900 dark:text-white font-bold">{marsPercentage.toFixed(4)}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                  <div
                    className="bg-red-500 dark:bg-red-600 rounded-full h-3 transition-all"
                    style={{ width: `${Math.min(marsPercentage * 1000, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  ~225 Millionen km Entfernung (Durchschnitt)
                </p>
              </div>
            )}

            {voyagerPercentage > 0.00001 && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-900 dark:text-white font-medium">🚀 Weg zu Voyager 1</span>
                  <span className="text-gray-900 dark:text-white font-bold">{voyagerPercentage.toFixed(6)}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                  <div
                    className="bg-cyan-500 dark:bg-cyan-600 rounded-full h-3 transition-all"
                    style={{ width: `${Math.min(voyagerPercentage * 10000, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  ~24 Milliarden km von der Erde entfernt
                </p>
              </div>
            )}
          </div>

          {/* Longest/Shortest Distance */}
          {longestDistance && shortestDistance && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 dark:from-orange-700 dark:to-orange-800 rounded-lg p-4 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">Längste Strecke</h3>
                <p className="text-2xl font-bold mb-1">{longestDistance.distance.toFixed(0)} km</p>
                <p className="text-sm opacity-75">
                  {longestDistance.flight.depIata || longestDistance.flight.depIcao} → {longestDistance.flight.arrIata || longestDistance.flight.arrIcao}
                </p>
              </div>

              <div className="bg-gradient-to-br from-teal-500 to-teal-600 dark:from-teal-700 dark:to-teal-800 rounded-lg p-4 text-white shadow-md">
                <h3 className="text-sm font-medium opacity-90 mb-2">Kürzeste Strecke</h3>
                <p className="text-2xl font-bold mb-1">{shortestDistance.distance.toFixed(0)} km</p>
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
              Top Fluggesellschaften
            </h2>
            <div className="space-y-3">
              {sortedAirlines.map(([airline, data]) => (
                <div key={airline} className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="text-gray-900 dark:text-white font-medium">{airline}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {data.count} Flüge • {data.totalDuration.toFixed(1)}h gesamt
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
              Meistbesuchte Flughäfen
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
              Sitzklassen
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
              Top Flugzeugtypen
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
              Flugstatus
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
                Boarding-Gruppen
              </h2>
              <div className="space-y-3">
                {Object.entries(boardingGroupStats)
                  .sort(([, a], [, b]) => b - a)
                  .map(([group, count]) => (
                    <div key={group} className="flex items-center justify-between">
                      <div className="text-gray-900 dark:text-white font-medium">Gruppe {group}</div>
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
        {longestFlight && shortestFlight && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Längster Flug
              </h2>
              <div className="space-y-2">
                <p className="text-gray-900 dark:text-white">
                  <span className="font-medium">{longestFlight.flight.airline}</span>{' '}
                  {longestFlight.flight.flightNumber}
                </p>
                <p className="text-gray-600 dark:text-gray-300">
                  {longestFlight.flight.depIata || longestFlight.flight.depIcao} →{' '}
                  {longestFlight.flight.arrIata || longestFlight.flight.arrIcao}
                </p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {longestFlight.duration.toFixed(1)}h
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Kürzester Flug
              </h2>
              <div className="space-y-2">
                <p className="text-gray-900 dark:text-white">
                  <span className="font-medium">{shortestFlight.flight.airline}</span>{' '}
                  {shortestFlight.flight.flightNumber}
                </p>
                <p className="text-gray-600 dark:text-gray-300">
                  {shortestFlight.flight.depIata || shortestFlight.flight.depIcao} →{' '}
                  {shortestFlight.flight.arrIata || shortestFlight.flight.arrIcao}
                </p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {shortestFlight.duration.toFixed(1)}h
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
