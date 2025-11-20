import { useState } from 'react';
import type { FlightFilters } from '../types';

interface FiltersProps {
  onFilterChange: (filters: FlightFilters) => void;
  onExport: (format: 'csv' | 'geojson') => void;
}

export default function Filters({ onFilterChange, onExport }: FiltersProps) {
  const [filters, setFilters] = useState<FlightFilters>({});
  const [showFilters, setShowFilters] = useState(false);

  const handleFilterChange = (key: keyof FlightFilters, value: string) => {
    const newFilters = { ...filters, [key]: value || undefined };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleClear = () => {
    setFilters({});
    onFilterChange({});
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn-secondary flex-1"
        >
          Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
        </button>
        <div className="relative">
          <button
            className="btn-secondary"
            onClick={() => {
              const menu = document.getElementById('export-menu');
              menu?.classList.toggle('hidden');
            }}
          >
            Export
          </button>
          <div
            id="export-menu"
            className="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg z-10 border"
          >
            <button
              onClick={() => {
                onExport('csv');
                document.getElementById('export-menu')?.classList.add('hidden');
              }}
              className="block w-full text-left px-4 py-2 hover:bg-gray-100 rounded-t-lg"
            >
              Export as CSV
            </button>
            <button
              onClick={() => {
                onExport('geojson');
                document.getElementById('export-menu')?.classList.add('hidden');
              }}
              className="block w-full text-left px-4 py-2 hover:bg-gray-100 rounded-b-lg"
            >
              Export as GeoJSON
            </button>
          </div>
        </div>
      </div>

      {showFilters && (
        <div className="card space-y-3">
          <div>
            <label className="label">Airline</label>
            <input
              type="text"
              value={filters.airline || ''}
              onChange={(e) => handleFilterChange('airline', e.target.value)}
              className="input"
              placeholder="Filter by airline"
            />
          </div>

          <div>
            <label className="label">Flight Number</label>
            <input
              type="text"
              value={filters.flightNumber || ''}
              onChange={(e) => handleFilterChange('flightNumber', e.target.value)}
              className="input"
              placeholder="Filter by flight number"
            />
          </div>

          <div>
            <label className="label">Status</label>
            <select
              value={filters.status || ''}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="input"
            >
              <option value="">All</option>
              <option value="scheduled">Scheduled</option>
              <option value="flown">Flown</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">From Date</label>
              <input
                type="date"
                value={filters.fromDate?.split('T')[0] || ''}
                onChange={(e) =>
                  handleFilterChange('fromDate', e.target.value ? `${e.target.value}T00:00:00Z` : '')
                }
                className="input"
              />
            </div>
            <div>
              <label className="label">To Date</label>
              <input
                type="date"
                value={filters.toDate?.split('T')[0] || ''}
                onChange={(e) =>
                  handleFilterChange('toDate', e.target.value ? `${e.target.value}T23:59:59Z` : '')
                }
                className="input"
              />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <button onClick={handleClear} className="btn-secondary w-full">
              Clear Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
