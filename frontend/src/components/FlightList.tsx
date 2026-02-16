import { format } from 'date-fns';
import type { Flight } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { useSettingsStore } from '../store/settingsStore';
import { formatCurrency as formatCurrencyUtil } from '../lib/units';
import DataSourceBadges from './DataSourceBadges';

interface FlightListProps {
  flights: Flight[];
  selectedFlightId?: string;
  onFlightClick: (flightId: string) => void;
  onEditFlight: (flight: Flight) => void;
  onDeleteFlight: (flightId: string) => void;
}

export default function FlightList({
  flights,
  selectedFlightId,
  onFlightClick,
  onEditFlight,
  onDeleteFlight,
}: FlightListProps): JSX.Element {
  const { t } = useTranslation(['flights', 'common']);

  const getStatusBadge = (status: string): JSX.Element => {
    const colors = {
      scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      flown: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    const statusLabel = t(`flights:status.${status}`, { defaultValue: status });

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status as keyof typeof colors]}`}>
        {statusLabel}
      </span>
    );
  };

  const getCategoryBadge = (category?: string): JSX.Element | null => {
    if (!category) return null;
    const colors = {
      business: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      private: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      vacation: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    };
    const categoryKey = category as 'business' | 'private' | 'vacation';
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[categoryKey]}`}>
        {t(`flights:category.${categoryKey}`)}
      </span>
    );
  };

  const { units } = useSettingsStore();
  
  const formatCurrency = (value?: number, currency?: string): string => {
    if (value === undefined || value === null) return '';
    // Use currency from settings if not specified
    const currencyToUse = (currency || units.currency) as 'EUR' | 'USD' | 'GBP' | 'CHF';
    return formatCurrencyUtil(value, currencyToUse);
  };

  if (flights.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        {t('flights:list.noFlights')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {flights.map((flight) => {
        const costParts: string[] = [];
        if (flight.price != null) {
          costParts.push(`${t('common:labels.price')}: ${formatCurrency(flight.price, flight.currency)}`);
        }
        if (flight.taxes != null) {
          costParts.push(`${t('common:labels.taxes')}: ${formatCurrency(flight.taxes, flight.currency)}`);
        }
        if (flight.fees != null) {
          costParts.push(`${t('common:labels.fees')}: ${formatCurrency(flight.fees, flight.currency)}`);
        }

        return (
          <div
            key={flight.id}
            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
              selectedFlightId === flight.id
                ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
                : 'border-gray-200 hover:border-gray-300 bg-white dark:border-gray-600 dark:hover:border-gray-500 dark:bg-gray-700'
            }`}
            onClick={() => onFlightClick(flight.id)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-lg dark:text-gray-100">
                    {flight.airline} {flight.flightNumber}
                  </h3>
                  {getStatusBadge(flight.status)}
                  {getCategoryBadge(flight.category)}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t('flights:list.from')}</p>
                    <p className="font-medium dark:text-gray-100">
                      {flight.depIata || flight.depIcao}
                      {flight.depName && (
                        <span className="text-gray-600 dark:text-gray-400 ml-1">- {flight.depName}</span>
                      )}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">
                      {format(new Date(flight.departureTime), 'MMM dd, yyyy HH:mm')}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t('flights:list.to')}</p>
                    <p className="font-medium dark:text-gray-100">
                      {flight.arrIata || flight.arrIcao}
                      {flight.arrName && (
                        <span className="text-gray-600 dark:text-gray-400 ml-1">- {flight.arrName}</span>
                      )}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">
                      {format(new Date(flight.arrivalTime), 'MMM dd, yyyy HH:mm')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
                  {flight.category && (
                    <span className="px-2 py-1 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">
                      {t(`flights:category.${flight.category}`)}
                    </span>
                  )}
                  {flight.price != null && (
                    <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                      {formatCurrency(flight.price, flight.currency || units.currency)}
                    </span>
                  )}
                  <DataSourceBadges flight={flight} />
                  {flight.tags && flight.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {flight.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {flight.aircraft && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                    {t('flights:list.aircraft')}: {flight.aircraft}
                  </p>
                )}

                {costParts.length > 0 && (
                  <p className="text-sm text-gray-700 dark:text-gray-200 mt-2">
                    {costParts.join(' | ')}
                  </p>
                )}

                {flight.notes && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 italic">
                    {flight.notes}
                  </p>
                )}

                {flight.tags && flight.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {flight.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-100"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 ml-4">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditFlight(flight);
                  }}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  title={t('flights:list.edit')}
                >
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
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(t('flights:list.deleteConfirm'))) {
                      onDeleteFlight(flight.id);
                    }
                  }}
                  className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  title={t('flights:list.delete')}
                >
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
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
