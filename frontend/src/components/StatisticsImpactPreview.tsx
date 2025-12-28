/**
 * Statistics Impact Preview Component
 * 
 * Shows how pending update will affect user statistics
 */

import { useTranslation } from '../hooks/useTranslation';
import { useThemeStore } from '../store/themeStore';

interface StatisticsImpact {
  distance: {
    before: number;
    after: number;
    change: number;
  };
  flightTime: {
    before: number;
    after: number;
    change: number;
  };
  airlines: {
    before: Set<string>;
    after: Set<string>;
    added: string[];
    removed: string[];
  };
  airports: {
    before: Set<string>;
    after: Set<string>;
    added: string[];
    removed: string[];
  };
}

interface StatisticsImpactPreviewProps {
  impact: StatisticsImpact | any;
}

export default function StatisticsImpactPreview({ impact }: StatisticsImpactPreviewProps) {
  const { t } = useTranslation(['pendingUpdates']);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  if (!impact) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 py-8">
        {t('pendingUpdates:preview.noData')}
      </div>
    );
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('de-DE').format(num);
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const getChangeColor = (change: number) => {
    if (change > 0) return 'text-green-600 dark:text-green-400';
    if (change < 0) return 'text-red-600 dark:text-red-400';
    return 'text-gray-600 dark:text-gray-400';
  };

  const getChangeIcon = (change: number) => {
    if (change > 0) return '↑';
    if (change < 0) return '↓';
    return '→';
  };

  return (
    <div className="space-y-6">
      {/* Distance */}
      {impact.distance && (
        <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {t('pendingUpdates:preview.distance')}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.before')}
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {formatNumber(impact.distance.before)} km
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.after')}
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {formatNumber(impact.distance.after)} km
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.change')}
              </div>
              <div className={`text-xl font-bold ${getChangeColor(impact.distance.change)}`}>
                {getChangeIcon(impact.distance.change)} {formatNumber(Math.abs(impact.distance.change))} km
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flight Time */}
      {impact.flightTime && (
        <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {t('pendingUpdates:preview.flightTime')}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.before')}
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {formatTime(impact.flightTime.before)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.after')}
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {formatTime(impact.flightTime.after)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.change')}
              </div>
              <div className={`text-xl font-bold ${getChangeColor(impact.flightTime.change)}`}>
                {getChangeIcon(impact.flightTime.change)} {formatTime(Math.abs(impact.flightTime.change))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Airlines */}
      {impact.airlines && (
        <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {t('pendingUpdates:preview.airlines')}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.before')}
              </div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {Array.isArray(impact.airlines.before) 
                  ? impact.airlines.before.length 
                  : impact.airlines.before?.size || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.after')}
              </div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {Array.isArray(impact.airlines.after) 
                  ? impact.airlines.after.length 
                  : impact.airlines.after?.size || 0}
              </div>
            </div>
          </div>
          {impact.airlines.added && impact.airlines.added.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-green-600 dark:text-green-400 mb-1">
                {t('pendingUpdates:preview.added')}
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {impact.airlines.added.join(', ')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Airports */}
      {impact.airports && (
        <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {t('pendingUpdates:preview.airports')}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.before')}
              </div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {Array.isArray(impact.airports.before) 
                  ? impact.airports.before.length 
                  : impact.airports.before?.size || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('pendingUpdates:preview.after')}
              </div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {Array.isArray(impact.airports.after) 
                  ? impact.airports.after.length 
                  : impact.airports.after?.size || 0}
              </div>
            </div>
          </div>
          {impact.airports.added && impact.airports.added.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-green-600 dark:text-green-400 mb-1">
                {t('pendingUpdates:preview.added')}
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {impact.airports.added.join(', ')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


