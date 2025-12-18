import { useEffect, useState } from 'react';
import { statsApi, flightsApi } from '../lib/api';
import HelpIcon from './Help/HelpIcon';
import type { Stats as StatsType, Route, FlightFilters, Flight } from '../types';
import { calculateDistance } from '../lib/geo';
import { API_LIMITS } from '../lib/constants';
import { logger } from '../lib/logger';

interface StatsProps {
  filters?: FlightFilters;
}

export default function Stats({ filters = {} }: StatsProps) {
  const [stats, setStats] = useState<StatsType | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [filters]);

  const loadStats = async () => {
    try {
      const { minRouteCount, ...apiFilters } = filters;
      const hasBackendFilters = Object.keys(apiFilters).length > 0;
      // If filters are applied, calculate stats from filtered flights
      if (hasBackendFilters) {
        const limit = API_LIMITS.MAX_PAGE_SIZE;
        let allFlights: Flight[] = [];
        let offset = 0;

        while (true) {
          const { flights } = await flightsApi.getAll({ ...apiFilters, limit, offset });
          allFlights = [...allFlights, ...flights];
          if (flights.length < limit) break;
          offset += limit;
        }

        const calculatedStats = calculateStats(allFlights);
        setStats(calculatedStats);
        setRoutes([]);
      } else {
        const [summaryData, routesData] = await Promise.all([
          statsApi.getSummary(),
          statsApi.getTopRoutes(API_LIMITS.TOP_ROUTES),
        ]);
        setStats(summaryData);
        setRoutes(routesData.routes);
      }
    } catch (error) {
      logger.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (flights: Flight[]): StatsType => {
    const flownFlights = flights.filter(f => f.status === 'flown');
    const totalDistance = flownFlights.reduce((sum, f) => {
      // Use accurate Haversine formula for distance calculation
      // Skip flights with missing coordinates
      if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) {
        return sum;
      }
      const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      return sum + dist;
    }, 0);

    const totalFlightTime = flownFlights.reduce((sum, f) => {
      const duration = (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / 60000;
      return sum + duration;
    }, 0);

    const byStatus: Record<string, number> = {};
    const byAirline: Record<string, number> = {};
    flights.forEach(f => {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      if (f.airline) byAirline[f.airline] = (byAirline[f.airline] || 0) + 1;
    });

    const totalCost = flights.reduce((sum, f) => sum + (f.price || 0), 0);

    return {
      totalFlights: flights.length,
      totalDistance: Math.round(totalDistance),
      avgDistance: flights.length > 0 ? Math.round(totalDistance / flights.length) : 0,
      totalFlightTime: Math.round(totalFlightTime),
      byStatus,
      byAirline,
      totalCost: totalCost > 0 ? totalCost : undefined,
    };
  };

  if (loading) {
    return <div className="text-center py-4 dark:text-gray-300">Loading statistics...</div>;
  }

  if (!stats) {
    return <div className="text-center py-4 text-gray-500 dark:text-gray-400">No statistics available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Flights</p>
          <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.totalFlights}</p>
        </div>
        <div className="card">
          <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
            Total Distance
            <HelpIcon
              content="Die Gesamtdistanz aller geflogenen Flüge in Kilometern."
              expandedContent="Berechnet mit der Haversine-Formel basierend auf den Koordinaten der Abflug- und Zielflughäfen. Nur Flüge mit Status 'flown' werden berücksichtigt."
              position="top"
            />
          </div>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">
            {stats.totalDistance.toLocaleString()} km
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-600 dark:text-gray-400">Avg Distance</p>
          <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {stats.avgDistance.toLocaleString()} km
          </p>
        </div>
        <div className="card">
          <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
            Total Flight Time
            <HelpIcon
              content="Die Gesamtflugzeit aller geflogenen Flüge in Stunden."
              expandedContent="Berechnet als Differenz zwischen Ankunfts- und Abflugzeit. Nur Flüge mit Status 'flown' werden berücksichtigt. Die Zeit wird in Minuten gespeichert und hier in Stunden angezeigt."
              position="top"
            />
          </div>
          <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
            {Math.round(stats.totalFlightTime / 60)} hrs
          </p>
        </div>
        {typeof stats.totalCost === 'number' && (
          <div className="card">
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Cost</p>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              {stats.totalCost.toLocaleString(undefined, { style: 'currency', currency: 'EUR' })}
            </p>
          </div>
        )}
      </div>

      {/* By Status */}
      <div className="card">
        <h3 className="font-semibold mb-3 dark:text-gray-100">By Status</h3>
        <div className="space-y-2">
          {Object.entries(stats.byStatus).map(([status, count]) => (
            <div key={status} className="flex justify-between items-center dark:text-gray-200">
              <span className="capitalize">{status}</span>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* By Airline */}
      <div className="card">
        <h3 className="font-semibold mb-3 dark:text-gray-100">By Airline</h3>
        <div className="space-y-2">
          {Object.entries(stats.byAirline)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([airline, count]) => (
              <div key={airline} className="flex justify-between items-center dark:text-gray-200">
                <span>{airline}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* By Category */}
      {stats.byCategory && (
        <div className="card">
          <h3 className="font-semibold mb-3 dark:text-gray-100">By Category</h3>
          <div className="space-y-2">
            {Object.entries(stats.byCategory).map(([category, count]) => (
              <div key={category} className="flex justify-between items-center dark:text-gray-200">
                <span className="capitalize">{category}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Routes */}
      {routes.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3 dark:text-gray-100">Top Routes</h3>
          <div className="space-y-3">
            {routes.map((route, index) => (
              <div key={route.route} className="border-b dark:border-gray-700 pb-2 last:border-0">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium dark:text-gray-100">
                      {index + 1}. {route.route}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {Math.round(route.distance)} km
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {route.count}x
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
