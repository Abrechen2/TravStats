import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { flightsApi } from '../lib/api';
import DarkModeToggle from '../components/DarkModeToggle';
import type { Flight } from '../types';

export default function AdvancedStatsPage() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFlights();
  }, []);

  const loadFlights = async () => {
    try {
      setLoading(true);
      const data = await flightsApi.getAll({});
      setFlights(data.flights);
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
  const longestFlight = flightDurations.sort((a, b) => b.duration - a.duration)[0];
  const shortestFlight = flightDurations.sort((a, b) => a.duration - b.duration)[0];

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
