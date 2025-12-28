/**
 * Pending Update Card Component
 * 
 * Displays a single pending update with options to apply, reject, or edit
 */

import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useThemeStore } from '../store/themeStore';
import ChangeDiffView from './ChangeDiffView';
import PendingUpdateEditor from './PendingUpdateEditor';

interface PendingUpdate {
  id: string;
  flightId: string;
  status: 'pending' | 'applied' | 'rejected' | 'expired' | 'edited';
  originalData: any;
  proposedData: any;
  editedData?: any;
  changes: any[];
  editedChanges?: any[];
  apiSource: string;
  fetchedAt: string;
  expiresAt: string;
  statisticsImpact?: any;
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

interface PendingUpdateCardProps {
  update: PendingUpdate;
  onApply: () => void;
  onReject: () => void;
  onEdit: (editedData: any) => void;
  onSelect: () => void;
  isSelected: boolean;
}

export default function PendingUpdateCard({
  update,
  onApply,
  onReject,
  onEdit,
  onSelect,
  isSelected,
}: PendingUpdateCardProps) {
  const { t } = useTranslation(['common', 'pendingUpdates']);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [showEditor, setShowEditor] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'applied':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'rejected':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'expired':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      case 'edited':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  const getStatusLabel = (status: string) => {
    return t(`pendingUpdates:status.${status}`);
  };

  const getApiSourceLabel = (source: string) => {
    return source.charAt(0).toUpperCase() + source.slice(1);
  };

  const timeUntilExpiry = () => {
    const now = new Date().getTime();
    const expiry = new Date(update.expiresAt).getTime();
    const diff = expiry - now;

    if (diff <= 0) return t('pendingUpdates:expired');
    if (diff < 60 * 60 * 1000) {
      return `${Math.floor(diff / (60 * 1000))} ${t('pendingUpdates:minutes')}`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      return `${Math.floor(diff / (60 * 60 * 1000))} ${t('pendingUpdates:hours')}`;
    }
    return `${Math.floor(diff / (24 * 60 * 60 * 1000))} ${t('pendingUpdates:days')}`;
  };

  const changesToShow = update.editedChanges || update.changes;
  const dataToShow = update.editedData || update.proposedData;

  return (
    <>
      <div
        className={`${
          isDarkMode ? 'bg-gray-800' : 'bg-white'
        } rounded-lg shadow-sm border-2 ${
          isSelected ? 'border-blue-500' : 'border-transparent'
        } transition-all hover:shadow-md`}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(update.status)}`}>
                {getStatusLabel(update.status)}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {getApiSourceLabel(update.apiSource)}
              </span>
            </div>
            {update.status === 'pending' && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('pendingUpdates:expiresIn')} {timeUntilExpiry()}
              </span>
            )}
          </div>
          {update.flight && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {update.flight.airline || 'Unknown'} {update.flight.flightNumber || ''}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {update.flight.depIata} → {update.flight.arrIata}
              </p>
            </div>
          )}
        </div>

        {/* Changes Preview */}
        <div className="p-4">
          <div className="mb-3">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('pendingUpdates:changes.title')}
            </h4>
            <div className="space-y-1">
              {changesToShow.slice(0, 3).map((change: any, index: number) => (
                <div key={index} className="text-sm">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {change.field}:
                  </span>{' '}
                  <span className="text-red-600 dark:text-red-400 line-through">
                    {change.oldValue || '-'}
                  </span>{' '}
                  →{' '}
                  <span className="text-green-600 dark:text-green-400">
                    {change.newValue || '-'}
                  </span>
                </div>
              ))}
              {changesToShow.length > 3 && (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  +{changesToShow.length - 3} {t('pendingUpdates:changes.more')}
                </div>
              )}
            </div>
          </div>

          {update.statisticsImpact && (
            <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                {t('pendingUpdates:statisticsImpact')}
              </div>
              <div className="text-sm">
                {update.statisticsImpact.distance && (
                  <div>
                    {t('pendingUpdates:distance')}:{' '}
                    <span className={update.statisticsImpact.distance.change > 0 ? 'text-green-600' : 'text-red-600'}>
                      {update.statisticsImpact.distance.change > 0 ? '+' : ''}
                      {update.statisticsImpact.distance.change} km
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {update.status === 'pending' || update.status === 'edited' ? (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
            <button
              onClick={() => setShowEditor(true)}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('pendingUpdates:actions.edit')}
            </button>
            <button
              onClick={onApply}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              {t('pendingUpdates:actions.apply')}
            </button>
            <button
              onClick={onReject}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              {t('pendingUpdates:actions.reject')}
            </button>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              {showDetails ? '−' : '+'}
            </button>
          </div>
        ) : (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
            {update.status === 'applied' && update.appliedAt && (
              <div>
                {t('pendingUpdates:appliedAt')} {new Date(update.appliedAt).toLocaleString()}
              </div>
            )}
            {update.status === 'rejected' && update.rejectedAt && (
              <div>
                {t('pendingUpdates:rejectedAt')} {new Date(update.rejectedAt).toLocaleString()}
              </div>
            )}
          </div>
        )}

        {/* Details */}
        {showDetails && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <ChangeDiffView
              original={update.originalData}
              proposed={dataToShow}
              changes={changesToShow}
            />
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {showEditor && (
        <PendingUpdateEditor
          update={update}
          onSave={(editedData) => {
            onEdit(editedData);
            setShowEditor(false);
          }}
          onCancel={() => setShowEditor(false)}
        />
      )}
    </>
  );
}


