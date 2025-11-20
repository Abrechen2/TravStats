import { useState, useEffect } from 'react';
import { Airport, airportsApi } from '../lib/api';
import AirportAutocomplete from './AirportAutocomplete';
import BoardingPassScanner from './BoardingPassScanner';
import { BoardingPassData, getAirlineName } from '../lib/bcbpParser';
import type { FlightInput } from '../types';

interface SimplifiedFlightFormProps {
  onSubmit: (flight: FlightInput) => Promise<void>;
  onCancel: () => void;
}

export default function SimplifiedFlightForm({ onSubmit, onCancel }: SimplifiedFlightFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

  const handleBoardingPassScan = async (bcbpData: BoardingPassData) => {
    setShowScanner(false);
    setError('');

    try {
      // Lookup airports by IATA code
      let depAirport, arrAirport;

      try {
        [depAirport, arrAirport] = await Promise.all([
          airportsApi.getByCode(bcbpData.departureAirport),
          airportsApi.getByCode(bcbpData.arrivalAirport),
        ]);
      } catch (airportError) {
        // If airports not found in database, create placeholder objects
        console.warn('Airports not in database, using IATA codes directly');
        depAirport = {
          id: 0,
          iata: bcbpData.departureAirport,
          icao: null,
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
          icao: null,
          name: bcbpData.arrivalAirport,
          city: null,
          country: null,
          lat: 0,
          lon: 0,
          altitude: null,
          timezone: null
        };

        // Show warning to user
        setError(`Could not find airport data for ${bcbpData.departureAirport} or ${bcbpData.arrivalAirport}. Please enter manually.`);
      }

      // Set airports
      setDeparture(depAirport);
      setArrival(arrAirport);

      // Set date
      setDepartureDate(bcbpData.dateOfFlight);
      setArrivalDate(bcbpData.dateOfFlight);

      // Set airline and flight number
      const airlineName = getAirlineName(bcbpData.operatingCarrierDesignator);
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
      const departureDateTime = `${departureDate}T${departureTime}:00Z`;
      const arrivalDateTime = `${arrivalDate || departureDate}T${arrivalTime}:00Z`;

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
      });
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
        <BoardingPassScanner
          onScanSuccess={handleBoardingPassScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
