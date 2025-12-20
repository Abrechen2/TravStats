import { useEffect, useState } from 'react';
import { setupApi } from '../lib/api';

interface SeedingStatus {
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  estimatedSecondsRemaining?: number;
  totalAirports?: number;
  processedAirports?: number;
  error?: string;
}

interface AirportSeedingBannerProps {
  onStatusChange?: (status: SeedingStatus | null) => void;
}

export default function AirportSeedingBanner({ onStatusChange }: AirportSeedingBannerProps) {
  const [status, setStatus] = useState<SeedingStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await setupApi.getAirportSeedingStatus();
      setStatus(data);
      onStatusChange?.(data);

      // Stop polling if completed or failed
      if (data.status === 'completed' || data.status === 'failed') {
        setIsPolling(false);
      } else if (data.status === 'running' || data.status === 'pending') {
        setIsPolling(true);
      }
    } catch (error) {
      console.error('Failed to fetch seeding status:', error);
      setIsPolling(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchStatus();
  }, []);

  useEffect(() => {
    // Poll every 2-3 seconds if seeding is in progress
    let intervalId: number | null = null;
    if (isPolling) {
      intervalId = setInterval(fetchStatus, 2500);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isPolling]);

  // Don't show banner if not seeding or already completed
  if (!status || status.status === 'completed') {
    return null;
  }

  // Format estimated time
  const formatEstimatedTime = (seconds?: number): string => {
    if (!seconds || seconds < 10) {
      return 'Berechne...';
    }

    if (seconds < 60) {
      return `ca. ${seconds} Sekunden`;
    }

    const minutes = Math.ceil(seconds / 60);
    if (minutes === 1) {
      return 'ca. 1 Minute';
    }
    return `ca. ${minutes} Minuten`;
  };

  const progress = status.progress ?? 0;
  const progressPercent = Math.round(progress * 100);

  return (
    <div className="w-full bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0 mt-0.5">
            {status.status === 'running' ? (
              <div className="animate-spin text-blue-600 dark:text-blue-400">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
            ) : status.status === 'failed' ? (
              <svg
                className="w-5 h-5 text-red-600 dark:text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5 text-blue-600 dark:text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-4 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  {status.status === 'running'
                    ? 'Airport-Datenbank wird geladen...'
                    : status.status === 'failed'
                    ? 'Fehler beim Laden der Airport-Datenbank'
                    : 'Airport-Datenbank wird vorbereitet...'}
                </h3>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                  {status.status === 'running'
                    ? 'Einige Funktionen sind während des ersten Starts eingeschränkt'
                    : status.status === 'failed'
                    ? status.error || 'Ein Fehler ist aufgetreten'
                    : 'Bitte warten Sie einen Moment...'}
                </p>
              </div>

              {/* Status info */}
              {status.status === 'running' && (
                <div className="flex-shrink-0 text-right">
                  {status.processedAirports !== undefined && status.totalAirports !== undefined && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                      {status.processedAirports} / {status.totalAirports}
                    </p>
                  )}
                  {status.estimatedSecondsRemaining !== undefined && (
                    <p className="text-xs text-blue-500 dark:text-blue-500 mt-0.5">
                      {formatEstimatedTime(status.estimatedSecondsRemaining)}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Progress bar */}
            {status.status === 'running' && (
              <div className="space-y-1">
                <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                  <div
                    className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    {progressPercent}% abgeschlossen
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}




