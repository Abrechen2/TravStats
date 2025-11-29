/**
 * Flights Table Page
 *
 * Dedicated page for viewing all flights in a comprehensive table format
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { flightsApi } from '../lib/api';
import type { Flight, FlightFilters } from '../types';
import Filters from '../components/Filters';
import FlightEditModal from '../components/FlightEditModal';
import { useThemeStore } from '../store/themeStore';
import DarkModeToggle from '../components/DarkModeToggle';

export default function FlightsTablePage() {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [filters, setFilters] = useState<FlightFilters>({});
  const [loading, setLoading] = useState(true);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [sortBy, setSortBy] = useState<'departureTime' | 'airline' | 'status'>('departureTime');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadFlights();
  }, [filters]);

  const loadFlights = async () => {
    try {
      setLoading(true);
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = 100;

      while (true) {
        const data = await flightsApi.getAll({ ...filters, limit, offset });
        allFlights = [...allFlights, ...data.flights];

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

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this flight?')) return;

    try {
      await flightsApi.delete(id);
      loadFlights();
    } catch (error) {
      console.error('Failed to delete flight:', error);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<Flight>) => {
    try {
      await flightsApi.update(id, updates);
      setEditingFlight(null);
      loadFlights();
    } catch (error) {
      console.error('Failed to update flight:', error);
      throw error;
    }
  };

  const sortedFlights = [...flights].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'departureTime':
        comparison = new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime();
        break;
      case 'airline':
        comparison = (a.airline || '').localeCompare(b.airline || '');
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      {/* Header */}
      <header className={`${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'} shadow-sm border-b`}>
        <div className="px-4 lg:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-3">
              <img src="/logo.png" alt="TravStats" className="h-8 lg:h-10 w-auto" />
              <h1 className={`text-xl lg:text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                TravStats
              </h1>
            </Link>
            <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>/ Flugliste</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/" className="btn-secondary text-sm px-3 py-2">
              ← Zurück zur Karte
            </Link>
            <DarkModeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Filters */}
        <div className="mb-6">
          <Filters onFilterChange={setFilters} />
        </div>

        {/* Table */}
        <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-sm overflow-hidden`}>
          <div className="overflow-x-auto">
            {loading ? (
              <div className={`text-center py-12 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Loading flights...
              </div>
            ) : sortedFlights.length === 0 ? (
              <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <p className="text-lg mb-2">No flights found</p>
                <p className="text-sm">Try adjusting your filters or add your first flight.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className={`${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'} border-b ${isDarkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                  <tr>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <button onClick={() => handleSort('airline')} className="flex items-center gap-1 hover:text-blue-500">
                        Airline
                        {sortBy === 'airline' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </button>
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Flight #
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Route
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <button onClick={() => handleSort('departureTime')} className="flex items-center gap-1 hover:text-blue-500">
                        Departure
                        {sortBy === 'departureTime' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </button>
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Arrival
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <button onClick={() => handleSort('status')} className="flex items-center gap-1 hover:text-blue-500">
                        Status
                        {sortBy === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </button>
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Aircraft
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Price
                    </th>
                    <th className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? 'divide-gray-700' : 'divide-gray-200'}`}>
                  {sortedFlights.map((flight) => (
                    <tr
                      key={flight.id}
                      className={`${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'} transition-colors`}
                    >
                      <td className={`px-4 py-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                        <div className="font-medium">{flight.airline || '—'}</div>
                      </td>
                      <td className={`px-4 py-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {flight.flightNumber || '—'}
                      </td>
                      <td className={`px-4 py-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{flight.depIata || flight.depIcao}</span>
                          <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>→</span>
                          <span className="font-semibold">{flight.arrIata || flight.arrIcao}</span>
                        </div>
                        <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                          {flight.depName?.substring(0, 20)} → {flight.arrName?.substring(0, 20)}
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {formatDate(flight.departureTime)}
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {formatDate(flight.arrivalTime)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          flight.status === 'flown'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : flight.status === 'scheduled'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        }`}>
                          {flight.status}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {flight.aircraft || '—'}
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {flight.price ? `${flight.price.toFixed(2)} ${flight.currency || 'EUR'}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditingFlight(flight)}
                            className={`px-3 py-1 text-xs font-medium rounded ${
                              isDarkMode
                                ? 'bg-blue-900 text-blue-200 hover:bg-blue-800'
                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                            }`}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(flight.id)}
                            className={`px-3 py-1 text-xs font-medium rounded ${
                              isDarkMode
                                ? 'bg-red-900 text-red-200 hover:bg-red-800'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          {!loading && sortedFlights.length > 0 && (
            <div className={`px-4 py-3 border-t ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  Showing <span className="font-semibold">{sortedFlights.length}</span> flights
                </div>
                <div className="text-sm">
                  Sorted by: <span className="font-semibold capitalize">{sortBy}</span> ({sortOrder === 'asc' ? 'Ascending' : 'Descending'})
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingFlight && (
        <FlightEditModal
          flight={editingFlight}
          isOpen={!!editingFlight}
          onClose={() => setEditingFlight(null)}
          onSave={handleUpdate}
        />
      )}
    </div>
  );
}
