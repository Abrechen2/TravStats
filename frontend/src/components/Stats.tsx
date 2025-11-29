import { useEffect, useState } from 'react';
import { statsApi, flightsApi } from '../lib/api';
import type { Stats as StatsType, Route, FlightFilters } from '../types';

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
      // If filters are applied, calculate stats from filtered flights
      if (Object.keys(filters).length > 0) {
        const { flights } = await flightsApi.getAll(filters);
        const calculatedStats = calculateStats(flights);
        setStats(calculatedStats);
        setRoutes([]);
      } else {
        const [summaryData, routesData] = await Promise.all([
          statsApi.getSummary(),
          statsApi.getTopRoutes(5),
        ]);
        setStats(summaryData);
        setRoutes(routesData.routes);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (flights: any[]): StatsType => {
    const flownFlights = flights.filter(f => f.status === 'flown');
    const totalDistance = flownFlights.reduce((sum, f) => {
      const dist = Math.sqrt(
        Math.pow(f.arrLat - f.depLat, 2) + Math.pow(f.arrLon - f.depLon, 2)
      ) * 111; // Rough km conversion
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
