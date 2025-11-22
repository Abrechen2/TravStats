import { useState, useEffect } from 'react';

import { Link } from 'react-router-dom';

import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '../store/authStore';
import { flightsApi } from '../lib/api';
import MapContainer3D from '../components/MapContainer3D';
import SimplifiedFlightForm from '../components/SimplifiedFlightForm';
import FlightList from '../components/FlightList';
import Stats from '../components/Stats';
import Filters from '../components/Filters';
import ErrorBoundary from '../components/ErrorBoundary';
import DarkModeToggle from '../components/DarkModeToggle';
import YearHeatmap from '../components/YearHeatmap';
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
  const [is3DView, setIs3DView] = useState(true);

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
            'Category',
            'Tags',
            'Price',
            'Currency',
            'Taxes',
            'Fees',
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
              f.category || '',
              f.tags?.join('|') || '',
              f.price ?? '',
              f.currency || '',
              f.taxes ?? '',
              f.fees ?? '',
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

            <Link
              to="/settings"
              className="px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              ⚙️ Einstellungen
            </Link>

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

        {/* Center - Map & Roadmap MVP highlights */}
        <div className="flex-1 p-4 flex flex-col gap-4 min-w-0 overflow-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Flugkarte</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Wechsle zwischen 3D-Globus und 2D-Karte; MVP-Visualisierungen findest du direkt darunter.
              </p>
            </div>
            <button
              onClick={() => setIs3DView((prev) => !prev)}
              className="
                inline-flex items-center gap-2 px-4 py-2
                bg-white dark:bg-gray-800
                text-gray-800 dark:text-gray-100
                border border-gray-300 dark:border-gray-600
                rounded-lg shadow-sm
                hover:bg-gray-50 dark:hover:bg-gray-700
                transition-colors font-semibold text-sm
              "
              title={is3DView ? 'Zur 2D-Karte wechseln' : 'Zum 3D-Globus wechseln'}
            >
              {is3DView ? (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                    />
                  </svg>
                  <span>2D-Karte anzeigen</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>3D-Globus anzeigen</span>
                </>
              )}
            </button>
          </div>

          <div className="flex-1 min-h-[420px]">
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
              <MapContainer3D
                flights={geoFlights}
                selectedFlightId={selectedFlightId}
                onFlightClick={setSelectedFlightId}
                is3D={is3DView}
              />
            </ErrorBoundary>
          </div>

          {!loading && flights.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    Roadmap MVP
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Kalender-Heatmap direkt im Dashboard. Weitere Zeit- und Distanz-Diagramme findest du unter &quot;Erweiterte Statistiken&quot;.
                  </p>
                </div>
                <button
                  onClick={() => navigate('/stats')}
                  className="px-3 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition-colors"
                >
                  Zu den Analysen
                </button>
              </div>
              <YearHeatmap flights={flights} />
            </div>
          )}
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
