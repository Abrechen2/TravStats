import { useEffect, useState } from 'react';
import { statsApi } from '../lib/api';
import type { Stats as StatsType, Route } from '../types';

export default function Stats() {
  const [stats, setStats] = useState<StatsType | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [summaryData, routesData] = await Promise.all([
        statsApi.getSummary(),
        statsApi.getTopRoutes(5),
      ]);
      setStats(summaryData);
      setRoutes(routesData.routes);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
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
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Distance</p>
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
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Flight Time</p>
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
