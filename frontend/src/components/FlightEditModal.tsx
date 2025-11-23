import { useState, useEffect } from 'react';
import type { Flight } from '../types';
import ReceiptUpload from './ReceiptUpload';

interface FlightEditModalProps {
  flight: Flight;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<Flight>) => Promise<void>;
}

export default function FlightEditModal({
  flight,
  isOpen,
  onClose,
  onSave,
}: FlightEditModalProps) {
  const [formData, setFormData] = useState({
    airline: flight.airline || '',
    flightNumber: flight.flightNumber || '',
    aircraft: flight.aircraft || '',
    status: flight.status || 'scheduled',
    category: flight.category || '',
    seatClass: flight.seatClass || '',
    seatNumber: flight.seatNumber || '',
    price: flight.price || 0,
    currency: flight.currency || 'EUR',
    taxes: flight.taxes || 0,
    fees: flight.fees || 0,
    notes: flight.notes || '',
    tags: flight.tags?.join(', ') || '',
    receiptUrl: flight.receiptUrl || '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Reset form when flight changes
    setFormData({
      airline: flight.airline || '',
      flightNumber: flight.flightNumber || '',
      aircraft: flight.aircraft || '',
      status: flight.status || 'scheduled',
      category: flight.category || '',
      seatClass: flight.seatClass || '',
      seatNumber: flight.seatNumber || '',
      price: flight.price || 0,
      currency: flight.currency || 'EUR',
      taxes: flight.taxes || 0,
      fees: flight.fees || 0,
      notes: flight.notes || '',
      tags: flight.tags?.join(', ') || '',
      receiptUrl: flight.receiptUrl || '',
    });
    setError('');
  }, [flight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const updates: any = {
        airline: formData.airline || undefined,
        flightNumber: formData.flightNumber || undefined,
        aircraft: formData.aircraft || undefined,
        status: formData.status,
        category: formData.category || undefined,
        seatClass: formData.seatClass || undefined,
        seatNumber: formData.seatNumber || undefined,
        price: formData.price > 0 ? formData.price : undefined,
        currency: formData.currency,
        taxes: formData.taxes > 0 ? formData.taxes : undefined,
        fees: formData.fees > 0 ? formData.fees : undefined,
        notes: formData.notes || undefined,
        tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        receiptUrl: formData.receiptUrl || undefined,
      };

      await onSave(flight.id, updates);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update flight');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold dark:text-gray-100">Edit Flight</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {flight.depIata || flight.depIcao} → {flight.arrIata || flight.arrIcao}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Airline</label>
              <input
                type="text"
                value={formData.airline}
                onChange={(e) => setFormData({ ...formData, airline: e.target.value })}
                className="input"
              />
            </div>

            <div>
              <label className="label">Flight Number</label>
              <input
                type="text"
                value={formData.flightNumber}
                onChange={(e) => setFormData({ ...formData, flightNumber: e.target.value })}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="label">Aircraft</label>
            <input
              type="text"
              value={formData.aircraft}
              onChange={(e) => setFormData({ ...formData, aircraft: e.target.value })}
              className="input"
              placeholder="e.g., A320, B737"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="input"
              >
                <option value="scheduled">Scheduled</option>
                <option value="flown">Flown</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="label">Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="input"
              >
                <option value="">None</option>
                <option value="business">Business</option>
                <option value="private">Private</option>
                <option value="vacation">Vacation</option>
              </select>
            </div>

            <div>
              <label className="label">Seat Class</label>
              <select
                value={formData.seatClass}
                onChange={(e) => setFormData({ ...formData, seatClass: e.target.value })}
                className="input"
              >
                <option value="">None</option>
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="business">Business</option>
                <option value="first">First</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Seat Number</label>
            <input
              type="text"
              value={formData.seatNumber}
              onChange={(e) => setFormData({ ...formData, seatNumber: e.target.value })}
              className="input"
              placeholder="e.g., 12A"
            />
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="label">Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                className="input"
              />
            </div>

            <div>
              <label className="label">Currency</label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className="input"
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Taxes</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.taxes}
                onChange={(e) => setFormData({ ...formData, taxes: parseFloat(e.target.value) || 0 })}
                className="input"
              />
            </div>

            <div>
              <label className="label">Fees</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.fees}
                onChange={(e) => setFormData({ ...formData, fees: parseFloat(e.target.value) || 0 })}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="label">Tags (comma separated)</label>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              className="input"
              placeholder="e.g., work, vacation, business trip"
            />
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="input"
              rows={3}
              placeholder="Any additional notes..."
            />
          </div>

          <ReceiptUpload
            currentReceiptUrl={formData.receiptUrl}
            onUploadSuccess={(receiptUrl) => setFormData({ ...formData, receiptUrl })}
            onDelete={() => setFormData({ ...formData, receiptUrl: '' })}
          />

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
