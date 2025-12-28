/**
 * Flights Table Page
 *
 * Dedicated page for viewing all flights in a comprehensive table format
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { flightsApi } from '../lib/api';
import ContextualHint from '../components/Onboarding/ContextualHint';
import NavigationBar from '../components/NavigationBar';
import type { Flight, FlightFilters } from '../types';
import Filters from '../components/Filters';
import FlightEditModal from '../components/FlightEditModal';
import ConfirmModal from '../components/Training/ConfirmModal';
import { useThemeStore } from '../store/themeStore';
import { useToastStore } from '../store/toastStore';
import { API_LIMITS, DATE_FORMATS, getDateLocale } from '../lib/constants';
import { useTranslation } from '../hooks/useTranslation';
import DataSourceBadges from '../components/DataSourceBadges';
import { logger } from '../lib/logger';

export default function FlightsTablePage() {
  const { t } = useTranslation(['flights', 'common']);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [filters, setFilters] = useState<FlightFilters>({});
  const [loading, setLoading] = useState(true);
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flightToDelete, setFlightToDelete] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'departureTime' | 'airline' | 'status' | 'duration'>('departureTime');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const addToast = useToastStore((state) => state.addToast);

  useEffect(() => {
    loadFlights();
  }, [filters]);

  const loadFlights = async () => {
    try {
      setLoading(true);
      const { minRouteCount, ...apiFilters } = filters as any;
      let allFlights: Flight[] = [];
      let offset = 0;
      const limit = API_LIMITS.MAX_PAGE_SIZE;

      while (true) {
        const data = await flightsApi.getAll({ ...apiFilters, limit, offset });
        allFlights = [...allFlights, ...data.flights];

        if (data.flights.length < limit) {
          break;
        }
        offset += limit;
      }

      setFlights(allFlights);
    } catch (error) {
      logger.error('Failed to load flights:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setFlightToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!flightToDelete) return;

    try {
      await flightsApi.delete(flightToDelete);
      addToast('success', t('flights:table.toast.deleted'));
      setDeleteConfirmOpen(false);
      setFlightToDelete(null);
      loadFlights();
    } catch (error) {
      logger.error('Failed to delete flight:', error);
      addToast('error', t('dashboard:errors.deleteFlight'));
      setDeleteConfirmOpen(false);
      setFlightToDelete(null);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<Flight>) => {
    try {
      await flightsApi.update(id, updates);
      addToast('success', t('flights:table.toast.updated'));
      setEditingFlight(null);
      loadFlights();
    } catch (error) {
      logger.error('Failed to update flight:', error);
      addToast('error', t('dashboard:errors.updateFlight'));
      throw error;
    }
  };

  const getDurationMinutes = (flight: Flight) =>
    (new Date(flight.arrivalTime).getTime() - new Date(flight.departureTime).getTime()) / 60000;

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
      case 'duration':
        comparison = getDurationMinutes(a) - getDurationMinutes(b);
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
    return new Date(date).toLocaleDateString(getDateLocale(), DATE_FORMATS.DEFAULT);
  };

  const formatDurationHours = (departure: string, arrival: string) => {
    const minutes = getDurationMinutes({ departureTime: departure, arrivalTime: arrival } as Flight);
    const hours = minutes / 60;
    return `${hours.toFixed(1)} h`;
  };

  const sortLabels: Record<typeof sortBy, string> = {
    departureTime: t('flights:table.sort.departure'),
    airline: t('flights:table.sort.airline'),
    status: t('flights:table.sort.status'),
    duration: t('flights:table.sort.duration'),
  };

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <NavigationBar />

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <ContextualHint
          id="flights-table-page-hint"
          title={t('flights:table.welcome')}
          message={t('flights:table.description')}
          linkTo="/"
          linkText={t('flights:table.backToDashboard')}
        />
        {/* Filters */}
        <div className="mb-6">
          <Filters onFilterChange={setFilters} />
        </div>

        {/* Table */}
        <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-sm overflow-hidden`}>
          <div className="overflow-x-auto">
            {loading ? (
              <div className={`text-center py-12 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {t('flights:table.loading')}
              </div>
            ) : sortedFlights.length === 0 ? (
              <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <p className="text-lg mb-2">{t('flights:table.noFlights')}</p>
                <p className="text-sm">{t('flights:table.noFlightsHint')}</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className={`${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'} border-b ${isDarkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                  <tr>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <button onClick={() => handleSort('airline')} className="flex items-center gap-1 hover:text-blue-500">
                        {t('flights:table.airline')}
                        {sortBy === 'airline' && (sortOrder === 'asc' ? '▼' : '▲')}
                      </button>
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('flights:table.flightNumber')}
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('flights:table.route')}
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <button onClick={() => handleSort('departureTime')} className="flex items-center gap-1 hover:text-blue-500">
                        {t('flights:table.departure')}
                        {sortBy === 'departureTime' && (sortOrder === 'asc' ? '▼' : '▲')}
                      </button>
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('flights:table.arrival')}
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <button onClick={() => handleSort('status')} className="flex items-center gap-1 hover:text-blue-500">
                        {t('flights:table.status')}
                        {sortBy === 'status' && (sortOrder === 'asc' ? '▼' : '▲')}
                      </button>
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      <button onClick={() => handleSort('duration')} className="flex items-center gap-1 hover:text-blue-500">
                        {t('flights:table.flightTime')}
                        {sortBy === 'duration' && (sortOrder === 'asc' ? '▼' : '▲')}
                      </button>
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('flights:table.aircraft')}
                    </th>
                    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('flights:table.price')}
                    </th>
                    <th className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('flights:table.actions')}
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
                        <div className="font-medium">{flight.airline || t('common:labels.notAvailable')}</div>
                      </td>
                      <td className={`px-4 py-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {flight.flightNumber || t('common:labels.notAvailable')}
                      </td>
                      <td className={`px-4 py-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{flight.depIata || flight.depIcao}</span>
                          <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>
                            {t('common:labels.routeSeparator')}
                          </span>
                          <span className="font-semibold">{flight.arrIata || flight.arrIcao}</span>
                        </div>
                        <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                          {flight.depName?.substring(0, 20)} {t('common:labels.routeSeparator')} {flight.arrName?.substring(0, 20)}
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {formatDate(flight.departureTime)}
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {formatDate(flight.arrivalTime)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            flight.status === 'flown'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : flight.status === 'scheduled'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          }`}>
                            {t(`flights:status.${flight.status}`, { defaultValue: flight.status })}
                          </span>
                          <DataSourceBadges flight={flight} />
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {formatDurationHours(flight.departureTime, flight.arrivalTime)}
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {flight.aircraft || t('common:labels.notAvailable')}
                      </td>
                      <td className={`px-4 py-3 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {flight.price ? `${flight.price.toFixed(2)} ${flight.currency || 'EUR'}` : t('common:labels.notAvailable')}
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
                            {t('common:buttons.edit')}
                          </button>
                          <button
                            onClick={() => handleDeleteClick(flight.id)}
                            className={`px-3 py-1 text-xs font-medium rounded ${
                              isDarkMode
                                ? 'bg-red-900 text-red-200 hover:bg-red-800'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                          >
                            {t('common:buttons.delete')}
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
                  {t('flights:table.footer.showing', { count: sortedFlights.length })}
                </div>
                <div className="text-sm">
                  {t('flights:table.footer.sortedBy', {
                    label: sortLabels[sortBy],
                    direction: sortOrder === 'asc'
                      ? t('common:sort.ascending')
                      : t('common:sort.descending'),
                  })}
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

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setFlightToDelete(null);
        }}
        onConfirm={handleDelete}
        title={t('flights:table.deleteConfirm.title')}
        message={t('flights:table.deleteConfirm.message')}
        confirmText={t('flights:table.deleteConfirm.confirm')}
        cancelText={t('flights:table.deleteConfirm.cancel')}
        confirmButtonClass="bg-red-600 hover:bg-red-700 focus:ring-red-500"
      />
    </div>
  );
}
