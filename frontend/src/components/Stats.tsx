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
    return <div className="text-center py-4">Loading statistics...</div>;
  }

  if (!stats) {
    return <div className="text-center py-4 text-gray-500">No statistics available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm text-gray-600">Total Flights</p>
          <p className="text-3xl font-bold text-blue-600">{stats.totalFlights}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-600">Total Distance</p>
          <p className="text-3xl font-bold text-green-600">
            {stats.totalDistance.toLocaleString()} km
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-600">Avg Distance</p>
          <p className="text-3xl font-bold text-purple-600">
            {stats.avgDistance.toLocaleString()} km
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-600">Total Flight Time</p>
          <p className="text-3xl font-bold text-orange-600">
            {Math.round(stats.totalFlightTime / 60)} hrs
          </p>
        </div>
      </div>

      {/* By Status */}
      <div className="card">
        <h3 className="font-semibold mb-3">By Status</h3>
        <div className="space-y-2">
          {Object.entries(stats.byStatus).map(([status, count]) => (
            <div key={status} className="flex justify-between items-center">
              <span className="capitalize">{status}</span>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* By Airline */}
      <div className="card">
        <h3 className="font-semibold mb-3">By Airline</h3>
        <div className="space-y-2">
          {Object.entries(stats.byAirline)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([airline, count]) => (
              <div key={airline} className="flex justify-between items-center">
                <span>{airline}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Top Routes */}
      {routes.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Top Routes</h3>
          <div className="space-y-3">
            {routes.map((route, index) => (
              <div key={route.route} className="border-b pb-2 last:border-0">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">
                      {index + 1}. {route.route}
                    </p>
                    <p className="text-sm text-gray-600">
                      {Math.round(route.distance)} km
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-blue-600">
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
