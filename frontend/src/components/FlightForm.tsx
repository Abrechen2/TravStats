import { useState } from 'react';
import type { FlightInput } from '../types';

interface FlightFormProps {
  onSubmit: (flight: FlightInput) => Promise<void>;
  onCancel: () => void;
}

export default function FlightForm({ onSubmit, onCancel }: FlightFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState<FlightInput>({
    airline: '',
    flightNumber: '',
    callsign: '',
    aircraft: '',
    departure: {
      icao: '',
      iata: '',
      name: '',
      lat: 0,
      lon: 0,
    },
    arrival: {
      icao: '',
      iata: '',
      name: '',
      lat: 0,
      lon: 0,
    },
    departureTime: '',
    arrivalTime: '',
    status: 'scheduled',
    notes: '',
    price: undefined,
    currency: 'EUR',
    category: 'private',
    tags: [],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await onSubmit(formData);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save flight');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4">
          <h2 className="text-2xl font-bold">Add Flight</h2>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Flight Info */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Flight Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Airline *</label>
                <input
                  type="text"
                  value={formData.airline}
                  onChange={(e) => setFormData({ ...formData, airline: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Flight Number *</label>
                <input
                  type="text"
                  value={formData.flightNumber}
                  onChange={(e) => setFormData({ ...formData, flightNumber: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Callsign</label>
                <input
                  type="text"
                  value={formData.callsign}
                  onChange={(e) => setFormData({ ...formData, callsign: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Aircraft Type</label>
                <input
                  type="text"
                  value={formData.aircraft}
                  onChange={(e) => setFormData({ ...formData, aircraft: e.target.value })}
                  className="input"
                  placeholder="e.g., A320, B737"
                />
              </div>
            </div>
          </div>

          {/* Departure */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Departure Airport</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">ICAO</label>
                <input
                  type="text"
                  value={formData.departure.icao}
                  onChange={(e) => setFormData({
                    ...formData,
                    departure: { ...formData.departure, icao: e.target.value }
                  })}
                  className="input"
                  placeholder="e.g., EDDF"
                />
              </div>
              <div>
                <label className="label">IATA</label>
                <input
                  type="text"
                  value={formData.departure.iata}
                  onChange={(e) => setFormData({
                    ...formData,
                    departure: { ...formData.departure, iata: e.target.value }
                  })}
                  className="input"
                  placeholder="e.g., FRA"
                />
              </div>
              <div className="col-span-2">
                <label className="label">Airport Name</label>
                <input
                  type="text"
                  value={formData.departure.name}
                  onChange={(e) => setFormData({
                    ...formData,
                    departure: { ...formData.departure, name: e.target.value }
                  })}
                  className="input"
                  placeholder="e.g., Frankfurt Airport"
                />
              </div>
              <div>
                <label className="label">Latitude *</label>
                <input
                  type="number"
                  step="any"
                  value={formData.departure.lat}
                  onChange={(e) => setFormData({
                    ...formData,
                    departure: { ...formData.departure, lat: parseFloat(e.target.value) || 0 }
                  })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Longitude *</label>
                <input
                  type="number"
                  step="any"
                  value={formData.departure.lon}
                  onChange={(e) => setFormData({
                    ...formData,
                    departure: { ...formData.departure, lon: parseFloat(e.target.value) || 0 }
                  })}
                  className="input"
                  required
                />
              </div>
            </div>
          </div>

          {/* Arrival */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Arrival Airport</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">ICAO</label>
                <input
                  type="text"
                  value={formData.arrival.icao}
                  onChange={(e) => setFormData({
                    ...formData,
                    arrival: { ...formData.arrival, icao: e.target.value }
                  })}
                  className="input"
                  placeholder="e.g., EGLL"
                />
              </div>
              <div>
                <label className="label">IATA</label>
                <input
                  type="text"
                  value={formData.arrival.iata}
                  onChange={(e) => setFormData({
                    ...formData,
                    arrival: { ...formData.arrival, iata: e.target.value }
                  })}
                  className="input"
                  placeholder="e.g., LHR"
                />
              </div>
              <div className="col-span-2">
                <label className="label">Airport Name</label>
                <input
                  type="text"
                  value={formData.arrival.name}
                  onChange={(e) => setFormData({
                    ...formData,
                    arrival: { ...formData.arrival, name: e.target.value }
                  })}
                  className="input"
                  placeholder="e.g., London Heathrow"
                />
              </div>
              <div>
                <label className="label">Latitude *</label>
                <input
                  type="number"
                  step="any"
                  value={formData.arrival.lat}
                  onChange={(e) => setFormData({
                    ...formData,
                    arrival: { ...formData.arrival, lat: parseFloat(e.target.value) || 0 }
                  })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Longitude *</label>
                <input
                  type="number"
                  step="any"
                  value={formData.arrival.lon}
                  onChange={(e) => setFormData({
                    ...formData,
                    arrival: { ...formData.arrival, lon: parseFloat(e.target.value) || 0 }
                  })}
                  className="input"
                  required
                />
              </div>
            </div>
          </div>

          {/* Times and Status */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Schedule</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Departure Time *</label>
                <input
                  type="datetime-local"
                  value={formData.departureTime}
                  onChange={(e) => setFormData({ ...formData, departureTime: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Arrival Time *</label>
                <input
                  type="datetime-local"
                  value={formData.arrivalTime}
                  onChange={(e) => setFormData({ ...formData, arrivalTime: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({
                    ...formData,
                    status: e.target.value as 'scheduled' | 'flown' | 'cancelled'
                  })}
                  className="input"
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="flown">Flown</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
        </div>
      </div>

      {/* Costs & Categorization */}
      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Kosten & Kategorien</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Ticketpreis</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.price ?? ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    price: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                className="input flex-1"
                placeholder="z.B. 249.99"
              />
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value as 'EUR' | 'USD' | 'GBP' | 'CHF' })}
                className="input w-24"
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Kategorie</label>
            <select
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value as 'business' | 'private' | 'vacation' })
              }
              className="input"
            >
              <option value="business">Geschäftlich</option>
              <option value="private">Privat</option>
              <option value="vacation">Urlaub</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Tags</label>
          <input
            type="text"
            value={formData.tags?.join(', ') ?? ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                tags: e.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
            className="input"
            placeholder="Kommagetrennt, z.B. Konferenz, Nachtflug"
          />
          <p className="text-xs text-gray-500 mt-1">Tags können später gefiltert und farblich markiert werden.</p>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="label">Notes</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="input"
          rows={3}
        />
      </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={onCancel}
              className="btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Flight'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
