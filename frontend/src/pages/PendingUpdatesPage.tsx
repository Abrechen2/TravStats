/**
 * Pending Updates Page
 * 
 * Page for reviewing and managing pending flight updates
 */

import { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { pendingUpdatesApi, type StatisticsImpact } from '../lib/api';
import { useToastStore } from '../store/toastStore';
import { logger } from '../lib/logger';
import NavigationBar from '../components/NavigationBar';
import { useThemeStore } from '../store/themeStore';
import PendingUpdateCard from '../components/PendingUpdateCard';
import StatisticsImpactPreview from '../components/StatisticsImpactPreview';

interface FlightUpdateData {
  airline?: string;
  aircraft?: string;
  gate?: string;
  terminal?: string;
  depIata?: string;
  arrIata?: string;
  departureTime?: string;
  arrivalTime?: string;
  [key: string]: string | number | boolean | null | undefined;
}

interface ChangeEntry {
  field: string;
  type: 'added' | 'removed' | 'changed';
  oldValue: string | number | boolean | null | undefined;
  newValue: string | number | boolean | null | undefined;
}

interface PendingUpdate {
  id: string;
  flightId: string;
  userId: string;
  status: 'pending' | 'applied' | 'rejected' | 'expired' | 'edited';
  originalData: FlightUpdateData;
  proposedData: FlightUpdateData;
  editedData?: FlightUpdateData;
  changes: ChangeEntry[];
  editedChanges?: ChangeEntry[];
  apiSource: string;
  fetchedAt: string;
  expiresAt: string;
  appliedAt?: string;
  rejectedAt?: string;
  editedAt?: string;
  statisticsImpact?: StatisticsImpact;
  flight?: {
    id: string;
    flightNumber: string | null;
    airline: string | null;
    departureTime: string;
    arrivalTime: string;
    depIata: string | null;
    arrIata: string | null;
  };
}

interface Statistics {
  totalUpdates: number;
  appliedUpdates: number;
  rejectedUpdates: number;
  editedUpdates: number;
  expiredUpdates: number;
  mostChangedFields: Record<string, number>;
  averageUpdateTime: number | null;
}

export default function PendingUpdatesPage(): JSX.Element {
  const { t } = useTranslation(['common', 'pendingUpdates']);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const addToast = useToastStore((state) => state.addToast);
  
  const [updates, setUpdates] = useState<PendingUpdate[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [sortBy, setSortBy] = useState<'createdAt' | 'expiresAt'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedUpdate, setSelectedUpdate] = useState<string | null>(null);

  useEffect(() => {
    loadUpdates();
    loadStatistics();
  }, [statusFilter]);

  const loadUpdates = async () => {
    try {
      setLoading(true);
      const filters: { status?: string; flightId?: string } = {};
      if (statusFilter && statusFilter !== 'all') {
        filters.status = statusFilter;
      }
      const data = await pendingUpdatesApi.getAll(filters);
      setUpdates(data.updates || []);
    } catch (error) {
      logger.error('Failed to load pending updates:', error);
      addToast('error', t('pendingUpdates:errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadStatistics = async () => {
    try {
      const stats = await pendingUpdatesApi.getStatistics();
      setStatistics(stats);
    } catch (error) {
      logger.error('Failed to load statistics:', error);
    }
  };

  const handleApply = async (id: string) => {
    try {
      await pendingUpdatesApi.apply(id);
      addToast('success', t('pendingUpdates:messages.applied'));
      loadUpdates();
      loadStatistics();
    } catch (error) {
      logger.error('Failed to apply update:', error);
      addToast('error', t('pendingUpdates:errors.applyFailed'));
    }
  };

  const handleReject = async (id: string) => {
    try {
      await pendingUpdatesApi.reject(id);
      addToast('success', t('pendingUpdates:messages.rejected'));
      loadUpdates();
      loadStatistics();
    } catch (error) {
      logger.error('Failed to reject update:', error);
      addToast('error', t('pendingUpdates:errors.rejectFailed'));
    }
  };

  const handleEdit = async (id: string, editedData: FlightUpdateData) => {
    try {
      await pendingUpdatesApi.update(id, editedData);
      addToast('success', t('pendingUpdates:messages.updated'));
      loadUpdates();
      loadStatistics();
    } catch (error) {
      logger.error('Failed to update:', error);
      addToast('error', t('pendingUpdates:errors.updateFailed'));
    }
  };

  const sortedUpdates = [...updates].sort((a, b) => {
    let aValue: number;
    let bValue: number;

    if (sortBy === 'createdAt') {
      aValue = new Date(a.fetchedAt).getTime();
      bValue = new Date(b.fetchedAt).getTime();
    } else {
      aValue = new Date(a.expiresAt).getTime();
      bValue = new Date(b.expiresAt).getTime();
    }

    if (sortOrder === 'asc') {
      return aValue - bValue;
    } else {
      return bValue - aValue;
    }
  });

  const pendingCount = updates.filter(u => u.status === 'pending').length;
  const editedCount = updates.filter(u => u.status === 'edited').length;

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <NavigationBar />

      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t('pendingUpdates:title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t('pendingUpdates:description')}
          </p>
        </div>

        {/* Statistics Dashboard */}
        {statistics && (
          <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-sm p-6 mb-6`}>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              {t('pendingUpdates:statistics.title')}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t('pendingUpdates:statistics.total')}
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {statistics.totalUpdates}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t('pendingUpdates:statistics.applied')}
                </div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {statistics.appliedUpdates}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t('pendingUpdates:statistics.rejected')}
                </div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {statistics.rejectedUpdates}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t('pendingUpdates:statistics.edited')}
                </div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {statistics.editedUpdates}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t('pendingUpdates:statistics.expired')}
                </div>
                <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                  {statistics.expiredUpdates}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters and Sort */}
        <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-sm p-4 mb-6`}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('pendingUpdates:filters.status')}
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input w-full"
              >
                <option value="all">{t('pendingUpdates:filters.all')}</option>
                <option value="pending">{t('pendingUpdates:filters.pending')} ({pendingCount})</option>
                <option value="edited">{t('pendingUpdates:filters.edited')} ({editedCount})</option>
                <option value="applied">{t('pendingUpdates:filters.applied')}</option>
                <option value="rejected">{t('pendingUpdates:filters.rejected')}</option>
                <option value="expired">{t('pendingUpdates:filters.expired')}</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('pendingUpdates:filters.sortBy')}
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'createdAt' | 'expiresAt')}
                className="input w-full"
              >
                <option value="createdAt">{t('pendingUpdates:filters.createdAt')}</option>
                <option value="expiresAt">{t('pendingUpdates:filters.expiresAt')}</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        </div>

        {/* Updates List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              {t('common:loading')}
            </p>
          </div>
        ) : sortedUpdates.length === 0 ? (
          <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-sm p-12 text-center`}>
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
              {t('pendingUpdates:empty.title')}
            </h3>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t('pendingUpdates:empty.description')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sortedUpdates.map((update) => (
              <PendingUpdateCard
                key={update.id}
                update={update}
                onApply={() => handleApply(update.id)}
                onReject={() => handleReject(update.id)}
                onEdit={(editedData) => handleEdit(update.id, editedData)}
                onSelect={() => setSelectedUpdate(update.id)}
                isSelected={selectedUpdate === update.id}
              />
            ))}
          </div>
        )}

        {/* Statistics Impact Preview Modal */}
        {selectedUpdate && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto`}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {t('pendingUpdates:preview.title')}
                  </h2>
                  <button
                    onClick={() => setSelectedUpdate(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {(() => {
                  const update = updates.find(u => u.id === selectedUpdate);
                  return update ? (
                    <StatisticsImpactPreview impact={update.statisticsImpact} />
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


