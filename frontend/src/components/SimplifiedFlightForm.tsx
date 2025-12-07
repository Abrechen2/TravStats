import { useState, useEffect, lazy, Suspense } from 'react';
import { Airport, airportsApi, flightsApi } from '../lib/api';
import AirportAutocomplete from './AirportAutocomplete';

// Lazy load BoardingPassScanner as it's heavy (Tesseract.js)
const BoardingPassScanner = lazy(() => import('./BoardingPassScanner'));
import { BoardingPassData, getAirlineName } from '../lib/bcbpParser';
import type { FlightInput, FlightLookupResult } from '../types';
import { useSettingsStore } from '../store/settingsStore';

interface SimplifiedFlightFormProps {
  onSubmit: (flight: FlightInput) => Promise<void>;
  onCancel: () => void;
}

export default function SimplifiedFlightForm({ onSubmit, onCancel }: SimplifiedFlightFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoFillMessage, setAutoFillMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Required fields
  const [departure, setDeparture] = useState<Airport | null>(null);
  const [arrival, setArrival] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('12:00');

  // Optional fields (advanced)
  const [airline, setAirline] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [aircraft, setAircraft] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [arrivalTime, setArrivalTime] = useState('14:00');
  const [status, setStatus] = useState<'scheduled' | 'flown' | 'cancelled'>('flown');
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState<string>('');
  const [taxes, setTaxes] = useState<string>('');
  const [fees, setFees] = useState<string>('');
  const [currency, setCurrency] = useState<'EUR' | 'USD' | 'GBP' | 'CHF'>('EUR');
  const [category, setCategory] = useState<'business' | 'private' | 'vacation'>('business');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const settings = useSettingsStore();

  useEffect(() => {
    if (settings?.units?.currency) {
      setCurrency(settings.units.currency);
    }
    if (settings?.defaults?.flightCategory) {
      setCategory(settings.defaults.flightCategory);
    }
  }, [settings]);

  // Smart defaults
  useEffect(() => {
    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    setDepartureDate(today);
    setArrivalDate(today);
  }, []);

  // Auto-calculate arrival time (2 hours after departure)
  useEffect(() => {
    if (departureDate && departureTime && !arrivalDate) {
      const depDateTime = new Date(`${departureDate}T${departureTime}`);
      depDateTime.setHours(depDateTime.getHours() + 2);

      setArrivalDate(depDateTime.toISOString().split('T')[0]);
      setArrivalTime(depDateTime.toTimeString().slice(0, 5));
    }
  }, [departureDate, departureTime, arrivalDate]);

  // Auto-set status based on date
  useEffect(() => {
    if (departureDate) {
      const depDate = new Date(departureDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (depDate < today) {
        setStatus('flown');
      } else {
        setStatus('scheduled');
      }
    }
  }, [departureDate]);

  const applyLookupData = (lookup: FlightLookupResult) => {
    if (!lookup) return;

    if (lookup.airline) setAirline(lookup.airline);
    if (lookup.flightNumber) setFlightNumber(lookup.flightNumber);
    if (lookup.aircraft) setAircraft(prev => prev || lookup.aircraft || '');

    if (lookup.departure) setDeparture(lookup.departure as any);
    if (lookup.arrival) setArrival(lookup.arrival as any);

    const updateDateTime = (
      value: string | undefined,
      setDate: (val: string) => void,
      setTime: (val: string) => void
    ) => {
      if (!value) return;
      // Avoid timezone shifts: use raw parts if present
      const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}:\d{2})?/);
      if (match) {
        if (match[1]) setDate(match[1]);
        if (match[2]) setTime(match[2]);
        return;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return;
      setDate(parsed.toISOString().split('T')[0]);
      setTime(parsed.toTimeString().slice(0, 5));
    };

    updateDateTime(lookup.departureTime, setDepartureDate, setDepartureTime);
    updateDateTime(lookup.arrivalTime, setArrivalDate, setArrivalTime);
  };

  useEffect(() => {
    const normalizedFlightNumber = flightNumber.trim();
    if (!normalizedFlightNumber) {
      setAutoFillMessage('');
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setAutoFillMessage('🔄 Suche Fluginfos (Aviationstack)...');
      try {
        const lookup = await flightsApi.lookup({
          flightNumber: normalizedFlightNumber,
          date: departureDate || undefined,
        });

        if (cancelled || !lookup) return;

        applyLookupData(lookup);
        setShowAdvanced(true);
        setAutoFillMessage('✈️ Daten automatisch ergänzt');
      } catch (lookupError) {
        if (!cancelled) {
          console.warn('Flight lookup failed', lookupError);
          setAutoFillMessage('');
        }
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flightNumber, departureDate]);

  const handleBoardingPassScan = async (bcbpData: BoardingPassData) => {
    setShowScanner(false);
    setError('');

    try {
      // Lookup airports by IATA code using getByCode API
      // This will automatically fetch from external sources if not in DB
      let depAirport, arrAirport;

      try {
        const [dep, arr] = await Promise.all([
          airportsApi.getByCode(bcbpData.departureAirport),
          airportsApi.getByCode(bcbpData.arrivalAirport),
        ]);

        depAirport = dep;
        arrAirport = arr;
      } catch (airportError) {
        // If airports not found even with external lookup, create placeholder objects
        console.warn('Airports not found anywhere, using IATA codes directly');
        depAirport = {
          id: 0,
          iata: bcbpData.departureAirport,
          icao: undefined,
          name: bcbpData.departureAirport,
          city: null,
          country: null,
          lat: 0,
          lon: 0,
          altitude: null,
          timezone: null
        };
        arrAirport = {
          id: 0,
          iata: bcbpData.arrivalAirport,
          icao: undefined,
          name: bcbpData.arrivalAirport,
          city: null,
          country: null,
          lat: 0,
          lon: 0,
          altitude: null,
          timezone: null
        };

        // Show warning to user
        setError(`⚠️ Airports "${bcbpData.departureAirport}" and "${bcbpData.arrivalAirport}" not found. Please verify manually.`);
      }

      // Set airports
      setDeparture(depAirport as any);
      setArrival(arrAirport as any);

      // Set date
      setDepartureDate(bcbpData.dateOfFlight);
      setArrivalDate(bcbpData.dateOfFlight);

      // Set airline and flight number
      const airlineName = bcbpData.airlineName || getAirlineName(bcbpData.operatingCarrierDesignator);
      setAirline(airlineName);
      setFlightNumber(`${bcbpData.operatingCarrierDesignator}${bcbpData.flightNumber}`);

      // Set status to flown (since user has boarding pass)
      setStatus('flown');


      // Show advanced options since we have flight details
      setShowAdvanced(true);

      // Show success message
      setError('');
    } catch (err) {
      setError(`Could not find airport data for ${bcbpData.departureAirport} or ${bcbpData.arrivalAirport}. Please enter manually.`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!departure || !arrival) {
      setError('Please select departure and arrival airports');
      return;
    }

    if (!departureDate) {
      setError('Please select departure date');
      return;
    }

    setLoading(true);

    try {
      // Convert local times to ISO strings (properly handles timezone conversion)
      // Note: This treats input times as local browser time and converts to UTC
      const departureDateTime = new Date(`${departureDate}T${departureTime}:00`).toISOString();
      const arrivalDateTime = new Date(`${arrivalDate || departureDate}T${arrivalTime}:00`).toISOString();

      await onSubmit({
        airline: airline || undefined,
        flightNumber: flightNumber || undefined,
        aircraft: aircraft || undefined,
        departure: {
          icao: departure.icao,
          iata: departure.iata,
          name: departure.name,
          lat: departure.lat,
          lon: departure.lon,
        },
        arrival: {
          icao: arrival.icao,
          iata: arrival.iata,
          name: arrival.name,
          lat: arrival.lat,
          lon: arrival.lon,
        },
        departureTime: departureDateTime,
        arrivalTime: arrivalDateTime,
        status,
        notes: notes || undefined,
        price: price ? Number(price) : undefined,
        taxes: taxes ? Number(taxes) : undefined,
        fees: fees ? Number(fees) : undefined,
        currency,
        category,
        tags: tags.length ? tags : undefined,
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save flight');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = () => {
    const clean = tagInput.trim();
    if (!clean || tags.includes(clean)) return;
    setTags([...tags, clean]);
    setTagInput('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4">
          <h2 className="text-2xl font-bold">✈️ Add Flight</h2>
          <p className="text-sm text-gray-600 mt-1">
            Just enter departure & arrival airports - we'll handle the rest!
          </p>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Boarding Pass Scanner Button */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">🎫 Have a Boarding Pass?</h3>
                <p className="text-sm text-gray-600">Scan it to auto-fill all details!</p>
              </div>
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="btn-primary"
              >
                📸 Scan Now
              </button>
            </div>
          </div>

          {/* Quick Add Section */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Or Enter Manually</h3>

            {/* Airports */}
            <div className="grid grid-cols-2 gap-4">
              <AirportAutocomplete
                value={departure}
                onChange={setDeparture}
                label="From"
                placeholder="FRA, Frankfurt, etc."
                required
              />
              <AirportAutocomplete
                value={arrival}
                onChange={setArrival}
                label="To"
                placeholder="LHR, London, etc."
                required
              />
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Departure Date *</label>
                <input
                  type="date"
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Departure Time</label>
                <input
                  type="time"
                  value={departureTime}
                  onChange={(e) => setDepartureTime(e.target.value)}
                  className="input"
                />
              </div>
            </div>

            {/* Status */}
            <div>
              <label className="label">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'scheduled' | 'flown' | 'cancelled')}
                className="input"
              >
                <option value="flown">Flown ✓</option>
                <option value="scheduled">Scheduled</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Advanced Section (Collapsible) */}
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium"
            >
              <span>{showAdvanced ? '▼' : '▶'}</span>
              Advanced Options (Optional)
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-6">
                {/* Flight Details */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Airline</label>
                    <input
                      type="text"
                      value={airline}
                      onChange={(e) => setAirline(e.target.value)}
                      className="input"
                      placeholder="e.g., Lufthansa"
                    />
                  </div>
                  <div>
                    <label className="label">Flight Number</label>
                    <input
                      type="text"
                      value={flightNumber}
                      onChange={(e) => setFlightNumber(e.target.value)}
                      className="input"
                      placeholder="e.g., LH123"
                    />
                    {autoFillMessage && (
                      <p className="text-xs text-blue-600 mt-1">{autoFillMessage}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="label">Aircraft Type</label>
                  <input
                    type="text"
                    value={aircraft}
                    onChange={(e) => setAircraft(e.target.value)}
                    className="input"
                    placeholder="e.g., A320, B737"
                  />
                </div>

                {/* Arrival Date/Time Override */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Arrival Date</label>
                    <input
                      type="date"
                      value={arrivalDate}
                      onChange={(e) => setArrivalDate(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Arrival Time</label>
                    <input
                      type="time"
                      value={arrivalTime}
                      onChange={(e) => setArrivalTime(e.target.value)}
                      className="input"
                    />
                  </div>
                </div>

                {/* Costs & Category */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Preis</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="input"
                        placeholder="z.B. 199.99"
                      />
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as typeof currency)}
                        className="input w-28"
                      >
                        <option value="EUR">EUR</option>
                        <option value="USD">USD</option>
                        <option value="GBP">GBP</option>
                        <option value="CHF">CHF</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">Kategorie</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as typeof category)}
                      className="input"
                    >
                      <option value="business">Geschäftlich</option>
                      <option value="private">Privat</option>
                      <option value="vacation">Urlaub</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Steuern</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={taxes}
                      onChange={(e) => setTaxes(e.target.value)}
                      className="input"
                      placeholder="optional"
                    />
                  </div>
                  <div>
                    <label className="label">Gebühren</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={fees}
                      onChange={(e) => setFees(e.target.value)}
                      className="input"
                      placeholder="optional"
                    />
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <label className="label">Tags</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      className="input"
                      placeholder="z.B. Konferenz, Familienbesuch"
                    />
                    <button type="button" onClick={handleAddTag} className="btn-secondary whitespace-nowrap">
                      Tag hinzufügen
                    </button>
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-800 text-xs"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => setTags(tags.filter((t) => t !== tag))}
                            className="text-blue-600 hover:text-blue-900"
                            aria-label={`Tag ${tag} entfernen`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="label">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="input"
                    rows={2}
                    placeholder="Optional notes about this flight..."
                  />
                </div>
              </div>
            )}
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
              disabled={loading || !departure || !arrival || !departureDate}
            >
              {loading ? 'Saving...' : '✓ Save Flight'}
            </button>
          </div>
        </form>

        {/* Helper Text */}
        <div className="px-6 pb-4 text-sm text-gray-500 border-t pt-4">
          💡 <strong>Pro tip:</strong> Scan your boarding pass or just select airports and date!
        </div>
      </div>

      {/* Boarding Pass Scanner Modal */}
      {showScanner && (
        <Suspense fallback={
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-8">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                <p className="text-gray-600 dark:text-gray-300">Loading scanner...</p>
              </div>
            </div>
          </div>
        }>
          <BoardingPassScanner
            onScanSuccess={handleBoardingPassScan}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
