import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { flightsApi } from '../lib/api';
import Map from '../components/Map';
import FlightForm from '../components/FlightForm';
import FlightList from '../components/FlightList';
import Stats from '../components/Stats';
import Filters from '../components/Filters';
import type { Flight, FlightInput, FlightFilters, GeoJSONFeature } from '../types';

export default function DashboardPage() {
  const { user, logout } = useAuthStore();
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
      const [flightsData, geoData] = await Promise.all([
        flightsApi.getAll(filters),
        flightsApi.getGeoJSON(filters),
      ]);
      setFlights(flightsData.flights);
      setGeoFlights(geoData.features);
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
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">TravStats</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">Welcome, {user?.username}!</span>
            <button onClick={logout} className="btn-secondary">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Flights List */}
        <div className="w-96 bg-white border-r flex flex-col">
          <div className="p-4 border-b">
            <button onClick={() => setShowFlightForm(true)} className="btn-primary w-full">
              + Add Flight
            </button>
          </div>

          <div className="p-4 border-b">
            <Filters onFilterChange={setFilters} onExport={handleExport} />
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading flights...</div>
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
          <Map
            flights={geoFlights}
            selectedFlightId={selectedFlightId}
            onFlightClick={setSelectedFlightId}
          />
        </div>

        {/* Right Sidebar - Stats */}
        <div className="w-80 bg-white border-l overflow-y-auto p-4">
          <h2 className="text-xl font-bold mb-4">Statistics</h2>
          <Stats />
        </div>
      </div>

      {/* Flight Form Modal */}
      {showFlightForm && (
        <FlightForm
          onSubmit={handleAddFlight}
          onCancel={() => setShowFlightForm(false)}
        />
      )}
    </div>
  );
}
