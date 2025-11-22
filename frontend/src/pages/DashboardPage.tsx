import { useState, useEffect } from 'react';

import { Link } from 'react-router-dom';

import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '../store/authStore';
import { flightsApi } from '../lib/api';
import Map from '../components/Map';
import SimplifiedFlightForm from '../components/SimplifiedFlightForm';
import FlightList from '../components/FlightList';
import Stats from '../components/Stats';
import Filters from '../components/Filters';
import ErrorBoundary from '../components/ErrorBoundary';
import DarkModeToggle from '../components/DarkModeToggle';
import type { Flight, FlightInput, FlightFilters, GeoJSONFeature } from '../types';

export default function DashboardPage() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [geoFlights, setGeoFlights] = useState<GeoJSONFeature[]>([]);
  const [selectedFlightId, setSelectedFlightId] = useState<string>();
  const [showFlightForm, setShowFlightForm] = useState(false);
  const [filters, setFilters] = useState<FlightFilters>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFlights();
  }, [filters]);

  const loadFlights = async () => {
    try {
      setLoading(true);

      // Load all flights by pagination (max 100 per request)
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = 100;

      while (true) {
        const data = await flightsApi.getAll({ ...filters, limit, offset });
        allFlights = [...allFlights, ...data.flights];

        // If we received fewer flights than the limit, we've reached the end
        if (data.flights.length < limit) {
          break;
        }

        offset += limit;
      }

      // Load all GeoJSON features by pagination
      let allGeoFeatures: GeoJSONFeature[] = [];
      offset = 0;

      while (true) {
        const geoData = await flightsApi.getGeoJSON({ ...filters, limit, offset });
        allGeoFeatures = [...allGeoFeatures, ...geoData.features];

        // If we received fewer features than the limit, we've reached the end
        if (geoData.features.length < limit) {
          break;
        }

        offset += limit;
      }

      setFlights(allFlights);
      setGeoFlights(allGeoFeatures);
    } catch (error) {
      console.error('Failed to load flights:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddFlight = async (flight: FlightInput) => {
    await flightsApi.create(flight);
    setShowFlightForm(false);
    loadFlights();
  };

  const handleDeleteFlight = async (id: string) => {
    try {
      await flightsApi.delete(id);
      loadFlights();
      if (selectedFlightId === id) {
        setSelectedFlightId(undefined);
      }
    } catch (error) {
      console.error('Failed to delete flight:', error);
    }
  };

  const handleExport = async (format: 'csv' | 'geojson') => {
    try {
      if (format === 'geojson') {
        const geoData = await flightsApi.getGeoJSON(filters);
        const blob = new Blob([JSON.stringify(geoData, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flights-${new Date().toISOString()}.geojson`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // CSV export
        const data = await flightsApi.getAll(filters);
        const csv = [
          [
            'Airline',
            'Flight Number',
            'Departure Airport',
            'Arrival Airport',
            'Departure Time',
            'Arrival Time',
            'Status',
            'Aircraft',
          ].join(','),
          ...data.flights.map((f) =>
            [
              f.airline,
              f.flightNumber,
              f.depIata || f.depIcao || '',
              f.arrIata || f.arrIcao || '',
              f.departureTime,
              f.arrivalTime,
              f.status,
              f.aircraft || '',
            ].join(',')
          ),
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flights-${new Date().toISOString()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Failed to export:', error);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">TravStats</h1>
          <div className="flex items-center gap-4">

            <Link
              to="/achievements"
              className="px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white rounded-lg font-semibold transition-all shadow-sm hover:shadow-md"
            >
              🏆 Achievements
            </Link>

            <button
              onClick={() => navigate('/stats')}
              className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              Erweiterte Statistiken
            </button>

            <span className="text-gray-600 dark:text-gray-300">Welcome, {user?.username}!</span>
            <DarkModeToggle />
            <button onClick={logout} className="btn-secondary">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Flights List */}
        <div className="w-96 bg-white dark:bg-gray-800 border-r dark:border-gray-700 flex flex-col">
          <div className="p-4 border-b dark:border-gray-700">
            <button onClick={() => setShowFlightForm(true)} className="btn-primary w-full">
              + Add Flight
            </button>
          </div>

          <div className="p-4 border-b dark:border-gray-700">
            <Filters onFilterChange={setFilters} onExport={handleExport} />
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading flights...</div>
            ) : (
              <FlightList
                flights={flights}
                selectedFlightId={selectedFlightId}
                onFlightClick={setSelectedFlightId}
                onDeleteFlight={handleDeleteFlight}
              />
            )}
          </div>
        </div>

        {/* Center - Map */}
        <div className="flex-1 p-4">
          <ErrorBoundary
            fallback={
              <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
                <div className="text-center">
                  <p className="text-gray-600 dark:text-gray-300 mb-2">Unable to display map</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Please check your flight data</p>
                </div>
              </div>
            }
          >
            <Map
              flights={geoFlights}
              selectedFlightId={selectedFlightId}
              onFlightClick={setSelectedFlightId}
            />
          </ErrorBoundary>
        </div>

        {/* Right Sidebar - Stats */}
        <div className="w-80 bg-white dark:bg-gray-800 border-l dark:border-gray-700 overflow-y-auto p-4">
          <h2 className="text-xl font-bold mb-4 dark:text-white">Statistics</h2>
          <ErrorBoundary>
            <Stats />
          </ErrorBoundary>
        </div>
      </div>

      {/* Flight Form Modal */}
      {showFlightForm && (
        <SimplifiedFlightForm
          onSubmit={handleAddFlight}
          onCancel={() => setShowFlightForm(false)}
        />
      )}
    </div>
  );
}
