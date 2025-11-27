/**
 * Simplified Flight Form V2
 *
 * Features:
 * - Dark Mode Support
 * - Smart Flight Number Lookup (Flight-First UX)
 * - Boarding Pass Scanner with Online Validation
 * - Step-by-Step guided flow
 */

import { useState, useEffect } from 'react';
import { Airport, airportsApi } from '../lib/api';
import AirportAutocomplete from './AirportAutocomplete';
import BoardingPassScanner from './BoardingPassScanner';
import { BoardingPassData, getAirlineName } from '../lib/bcbpParser';
import type { FlightInput } from '../types';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';

interface FlightLookupResult {
  flightNumber: string;
  airline: string;
  departure: {
    iata?: string;
    name?: string;
    scheduledTime?: string;
    terminal?: string;
    gate?: string;
  };
  arrival: {
    iata?: string;
    name?: string;
    scheduledTime?: string;
    terminal?: string;
    gate?: string;
  };
  aircraft?: string;
  status?: string;
}

interface SimplifiedFlightFormProps {
  onSubmit: (flight: FlightInput) => Promise<void>;
  onCancel: () => void;
}

export default function SimplifiedFlightFormV2({ onSubmit, onCancel }: SimplifiedFlightFormProps) {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const settings = useSettingsStore();

  // UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [step, setStep] = useState<'input' | 'lookup' | 'select' | 'complete'>('input');

  // Flight Lookup State
  const [flightNumber, setFlightNumber] = useState('');
  const [searchDate, setSearchDate] = useState('');
  const [lookupResults, setLookupResults] = useState<FlightLookupResult[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<FlightLookupResult | null>(null);

  // Form Fields
  const [departure, setDeparture] = useState<Airport | null>(null);
  const [arrival, setArrival] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('12:00');
  const [arrivalDate, setArrivalDate] = useState('');
  const [arrivalTime, setArrivalTime] = useState('14:00');
  const [airline, setAirline] = useState('');
  const [aircraft, setAircraft] = useState('');
  const [terminal, setTerminal] = useState('');
  const [gate, setGate] = useState('');
  const [seatNumber, setSeatNumber] = useState('');
  const [seatClass, setSeatClass] = useState<'economy' | 'premium_economy' | 'business' | 'first'>('economy');
  const [status, setStatus] = useState<'scheduled' | 'flown' | 'cancelled'>('flown');
  const [notes, setNotes] = useState('');
  const [price, _setPrice] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState<'EUR' | 'USD' | 'GBP' | 'CHF'>('EUR');
  const [category, setCategory] = useState<'business' | 'private' | 'vacation'>('business');
  const [tags, _setTags] = useState<string[]>([]);

  // Initialize defaults from settings
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setSearchDate(today);
    setDepartureDate(today);
    setArrivalDate(today);

    if (settings?.units?.currency) {
      setCurrency(settings.units.currency);
    }
    if (settings?.defaults?.flightCategory) {
      setCategory(settings.defaults.flightCategory);
    }
    if (settings?.defaults?.seatClass) {
      setSeatClass(settings.defaults.seatClass);
    }
  }, [settings]);

  // Auto-set status based on date
  useEffect(() => {
    if (departureDate) {
      const depDate = new Date(departureDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setStatus(depDate < today ? 'flown' : 'scheduled');
    }
  }, [departureDate]);

  const mapCompartmentToSeatClass = (code?: string) => {
    if (!code) return undefined;
    const c = code.toUpperCase();
    if ('FAP'.includes(c)) return 'first';
    if ('CJDZ'.includes(c)) return 'business';
    if ('WPE'.includes(c)) return 'premium_economy';
    return 'economy';
  };

  // Flight Lookup Handler
  const handleFlightLookup = async () => {
    if (!flightNumber.trim()) {
      setError('Please enter a flight number');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/v1/flight-lookup/${flightNumber}?date=${searchDate}`
      );
      const data = await response.json();

      if (!data.success || !data.flights || data.flights.length === 0) {
        setError('No flights found. Try a different date or enter manually.');
        setStep('complete'); // Skip to manual entry
        return;
      }

      setLookupResults(data.flights);
      setStep('select');
    } catch (err) {
      console.error('Flight lookup error:', err);
      setError('Flight lookup unavailable (Backend/API-Key). Bitte manuell eingeben oder später erneut versuchen.');
      setStep('complete');
    } finally {
      setLoading(false);
    }
  };

  // Select Flight from Lookup Results
  const handleSelectFlight = async (flight: FlightLookupResult) => {
    setSelectedFlight(flight);
    setLoading(true);

    try {
      // Fetch full airport data
      const [depAirport, arrAirport] = await Promise.all([
        flight.departure.iata ? airportsApi.getByCode(flight.departure.iata) : null,
        flight.arrival.iata ? airportsApi.getByCode(flight.arrival.iata) : null,
      ]);

      if (depAirport) setDeparture(depAirport);
      if (arrAirport) setArrival(arrAirport);

      // Pre-fill all available data
      setAirline(flight.airline);
      setAircraft(flight.aircraft || '');
      setTerminal(flight.departure.terminal || '');
      setGate(flight.departure.gate || '');

      const applyDateTime = (value?: string, setters?: { setDate: (v: string) => void; setTime: (v: string) => void }) => {
        if (!value || !setters) return;
        const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}:\d{2})?/);
        if (match) {
          if (match[1]) setters.setDate(match[1]);
          if (match[2]) setters.setTime(match[2]);
          return;
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          setters.setDate(parsed.toISOString().split('T')[0]);
          setters.setTime(parsed.toTimeString().slice(0, 5));
        }
      };

      applyDateTime(flight.departure.scheduledTime, { setDate: setDepartureDate, setTime: setDepartureTime });
      applyDateTime(flight.arrival.scheduledTime, { setDate: setArrivalDate, setTime: setArrivalTime });

      setStep('complete');
    } catch (err) {
      setError('Failed to load airport data');
    } finally {
      setLoading(false);
    }
  };

  // Boarding Pass Scanner with Online Validation
  const handleBoardingPassScan = async (bcbpData: BoardingPassData) => {
    setShowScanner(false);
    setError('');
    setLoading(true);

    try {
      const isFallbackParsing = bcbpData.formatCode === 'FALLBACK';

      // Step 1: Try online validation if flight number available (only if not fallback)
      const carrierCode = bcbpData.operatingCarrierDesignator;
      const scannedFlightNumber = bcbpData.flightNumber ? `${carrierCode || ''}${bcbpData.flightNumber}` : '';

      if (!isFallbackParsing && carrierCode && bcbpData.flightNumber) {
        const flightDate = bcbpData.dateOfFlight || searchDate;

        try {
          const response = await fetch(
            `/api/v1/flight-lookup/${carrierCode}${bcbpData.flightNumber}?date=${flightDate}`
          );
          const data = await response.json();

          if (data.success && data.flights && data.flights.length > 0) {
            // Validate scanned data against API data
            const apiFlight = data.flights[0];

            if (apiFlight.departure.iata !== bcbpData.departureAirport ||
                apiFlight.arrival.iata !== bcbpData.arrivalAirport) {
              console.warn('⚠️ Boarding pass data mismatch with API - using API data as source of truth');
            }

            // Use API data as source of truth, but keep scanned seat info
            await handleSelectFlight(apiFlight);
            setFlightNumber(`${carrierCode}${bcbpData.flightNumber}`);

            // Override with scanned seat info (more reliable)
            if (bcbpData.seatNumber) {
              setSeatNumber(bcbpData.seatNumber.toUpperCase());
            }
            if (bcbpData.seatClass) {
              setSeatClass(bcbpData.seatClass);
            }
            if (bcbpData.passengerName) {
              setNotes(`Passenger: ${bcbpData.passengerName}`);
            }

            console.log('✅ Used online validation + scanned seat data');
            return;
          } else {
            console.warn('⚠️ No online match found, using scanned data');
          }
        } catch (err) {
          console.warn('⚠️ Online validation failed, using scanned data:', err);
        }
      }

      // Step 2: Fallback to scanned data + airport enrichment
      if (!bcbpData.departureAirport || !bcbpData.arrivalAirport) {
        setError('Could not extract airport codes from boarding pass. Please check the barcode quality or enter manually.');
        setLoading(false);
        return;
      }

      const [depAirport, arrAirport] = await Promise.all([
        airportsApi.getByCode(bcbpData.departureAirport).catch(() => null),
        airportsApi.getByCode(bcbpData.arrivalAirport).catch(() => null),
      ]);

      if (!depAirport || !arrAirport) {
        setError(`Airport lookup failed for ${!depAirport ? bcbpData.departureAirport : bcbpData.arrivalAirport}. Please verify the codes.`);
        setLoading(false);
        return;
      }

      setDeparture(depAirport);
      setArrival(arrAirport);

      // Set all available data
      if (bcbpData.passengerName) {
        setNotes(`Passenger: ${bcbpData.passengerName}`);
      }

      if (bcbpData.seatNumber) {
        setSeatNumber(bcbpData.seatNumber.toUpperCase());
      }

      const mappedSeatClass = mapCompartmentToSeatClass(bcbpData.compartmentCode);
      if (mappedSeatClass) {
        setSeatClass(mappedSeatClass);
      } else if (bcbpData.seatClass) {
        setSeatClass(bcbpData.seatClass);
      }

      if (carrierCode && bcbpData.flightNumber) {
        setFlightNumber(scannedFlightNumber);
        setAirline(bcbpData.airlineName || getAirlineName(carrierCode) || carrierCode);
      }

      if (bcbpData.dateOfFlight) {
        setDepartureDate(bcbpData.dateOfFlight);
        setArrivalDate(bcbpData.dateOfFlight);
      }

      // Show success message based on parsing method
      if (isFallbackParsing) {
        console.log('✅ Used intelligent fallback parsing - please verify all data!');
        setNotes((prev) => (prev ? `${prev}\n` : '') + '⚠️ Extracted via fallback parsing - please verify!');
      } else {
        console.log('✅ Successfully parsed IATA BCBP boarding pass');
      }

      setStep('complete');

    } catch (err) {
      console.error('❌ Boarding pass processing error:', err);
      setError('Failed to process boarding pass. Please try again or enter manually.');
    } finally {
      setLoading(false);
    }
  };

  // Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!departure || !arrival) {
      setError('Please select both departure and arrival airports');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const departureDateTime = `${departureDate}T${departureTime}`;
      const arrivalDateTime = `${arrivalDate}T${arrivalTime}`;

      await onSubmit({
        departure: {
          iata: departure.iata,
          icao: departure.icao,
          name: departure.name,
          lat: departure.lat,
          lon: departure.lon,
        },
        arrival: {
          iata: arrival.iata,
          icao: arrival.icao,
          name: arrival.name,
          lat: arrival.lat,
          lon: arrival.lon,
        },
        airline: airline || undefined,
        flightNumber: flightNumber || undefined,
        aircraft: aircraft || undefined,
        seatClass: seatClass || undefined,
        seatNumber: seatNumber || undefined,
        terminal: terminal || undefined,
        gate: gate || undefined,
        departureTime: departureDateTime,
        arrivalTime: arrivalDateTime,
        status,
        notes: notes || undefined,
        price: price,
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

  // Theme classes
  const bgClass = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const textClass = isDarkMode ? 'text-white' : 'text-gray-900';
  const mutedTextClass = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const borderClass = isDarkMode ? 'border-gray-700' : 'border-gray-200';
  const inputClass = isDarkMode
    ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
    : 'bg-white border-gray-300 text-gray-900';
  const sizedInputClass = `${inputClass} text-base py-3`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`${bgClass} rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto`}>
        {/* Header */}
        <div className={`sticky top-0 ${bgClass} border-b ${borderClass} px-6 py-4`}>
          <h2 className={`text-2xl font-bold ${textClass}`}>✈️ Add Flight</h2>
          <p className={`text-sm ${mutedTextClass} mt-1`}>
            {step === 'input' && 'Enter flight number for automatic lookup'}
            {step === 'select' && 'Select your flight from the results'}
            {step === 'complete' && 'Review and complete flight details'}
          </p>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded dark:bg-red-900 dark:border-red-700 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Step 1: Flight Number Lookup */}
          {step === 'input' && (
            <div className="space-y-4">
              {/* Boarding Pass Scanner */}
              <div className={`bg-gradient-to-r ${isDarkMode ? 'from-blue-900 to-purple-900' : 'from-blue-50 to-purple-50'} border ${isDarkMode ? 'border-blue-700' : 'border-blue-200'} rounded-lg p-4`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className={`font-semibold text-lg ${textClass}`}>🎫 Have a Boarding Pass?</h3>
                    <p className={`text-sm ${mutedTextClass}`}>Scan it for instant auto-fill!</p>
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

              {/* Flight Number Input */}
              <div>
                <label className={`label ${textClass}`}>Flight Number (e.g., LH400, BA1234)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                    className={`input flex-1 ${sizedInputClass}`}
                    placeholder="LH400"
                    maxLength={10}
                  />
                  <input
                    type="date"
                    value={searchDate}
                    onChange={(e) => setSearchDate(e.target.value)}
                    className={`input ${sizedInputClass} w-40`}
                  />
                  <button
                    type="button"
                    onClick={handleFlightLookup}
                    disabled={loading || !flightNumber.trim()}
                    className="btn-primary whitespace-nowrap px-6"
                  >
                    {loading ? '🔍 Searching...' : '🔍 Lookup'}
                  </button>
                </div>
                <p className={`text-xs ${mutedTextClass} mt-1`}>
                  We'll automatically fill in all flight details!
                </p>
              </div>

              {/* Manual Entry Option */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setStep('complete')}
                  className={`text-sm ${isDarkMode ? 'text-blue-400' : 'text-blue-600'} hover:underline`}
                >
                  Or skip and enter manually →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Select Flight from Results */}
          {step === 'select' && lookupResults.length > 0 && (
            <div className="space-y-4">
              <h3 className={`font-semibold text-lg ${textClass}`}>
                Found {lookupResults.length} flight{lookupResults.length > 1 ? 's' : ''}
              </h3>
              {lookupResults.map((flight, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectFlight(flight)}
                  className={`w-full text-left p-4 rounded-lg border-2 ${
                    isDarkMode
                      ? 'border-gray-700 hover:border-blue-500 bg-gray-700'
                      : 'border-gray-200 hover:border-blue-500 bg-gray-50'
                  } transition-colors`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className={`font-bold ${textClass}`}>
                        {flight.airline} {flight.flightNumber}
                      </div>
                      <div className={`text-sm ${mutedTextClass}`}>
                        {flight.departure.iata} → {flight.arrival.iata}
                      </div>
                      {flight.departure.scheduledTime && (
                        <div className={`text-xs ${mutedTextClass} mt-1`}>
                          Departs: {new Date(flight.departure.scheduledTime).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {flight.status && (
                      <span className={`px-2 py-1 rounded text-xs ${
                        flight.status === 'landed' ? 'bg-green-100 text-green-800' :
                        flight.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {flight.status}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStep('input')}
                className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
              >
                ← Back to search
              </button>
            </div>
          )}

          {/* Step 3: Complete Form */}
          {step === 'complete' && (
            <div className="space-y-6">
              {/* Flight Details (if from lookup) */}
              {selectedFlight && (
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-green-900' : 'bg-green-50'} border ${isDarkMode ? 'border-green-700' : 'border-green-200'}`}>
                  <div className={`text-sm font-medium ${isDarkMode ? 'text-green-200' : 'text-green-800'}`}>
                    ✓ Flight details loaded from {selectedFlight.airline} {selectedFlight.flightNumber}
                  </div>
                </div>
              )}

              {/* Airports */}
              <div className="grid grid-cols-2 gap-4">
                <AirportAutocomplete
                  value={departure}
                  onChange={setDeparture}
                  label="From *"
                  placeholder="FRA, Frankfurt"
                  required
                />
                <AirportAutocomplete
                  value={arrival}
                  onChange={setArrival}
                  label="To *"
                  placeholder="LHR, London"
                  required
                />
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`label ${textClass}`}>Departure Date *</label>
                  <input
                    type="date"
                    value={departureDate}
                    onChange={(e) => setDepartureDate(e.target.value)}
                    className={`input ${sizedInputClass}`}
                    required
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>Departure Time</label>
                  <input
                    type="time"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className={`input ${sizedInputClass}`}
                  />
                </div>
              </div>

              {/* Additional Fields */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={`label ${textClass}`}>Airline</label>
                  <input
                    type="text"
                    value={airline}
                    onChange={(e) => setAirline(e.target.value)}
                    className={`input ${sizedInputClass}`}
                    placeholder="Lufthansa"
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>Flight Number</label>
                  <input
                    type="text"
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                    className={`input ${sizedInputClass}`}
                    placeholder="LH400"
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className={`input ${sizedInputClass}`}
                  >
                    <option value="flown">Flown</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Equipment / Gate / Seat / Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`label ${textClass}`}>Aircraft</label>
                  <input
                    type="text"
                    value={aircraft}
                    onChange={(e) => setAircraft(e.target.value)}
                    className={`input ${sizedInputClass}`}
                    placeholder="A320, B737"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`label ${textClass}`}>Terminal</label>
                    <input
                      type="text"
                      value={terminal}
                      onChange={(e) => setTerminal(e.target.value)}
                      className={`input ${sizedInputClass}`}
                      placeholder="T1"
                    />
                  </div>
                  <div>
                    <label className={`label ${textClass}`}>Gate</label>
                    <input
                      type="text"
                      value={gate}
                      onChange={(e) => setGate(e.target.value)}
                      className={`input ${sizedInputClass}`}
                      placeholder="A12"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={`label ${textClass}`}>Seat Number</label>
                  <input
                    type="text"
                    value={seatNumber}
                    onChange={(e) => setSeatNumber(e.target.value.toUpperCase())}
                    className={`input ${sizedInputClass}`}
                    placeholder="12A"
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>Seat Class</label>
                  <select
                    value={seatClass}
                    onChange={(e) => setSeatClass(e.target.value as any)}
                    className={`input ${sizedInputClass}`}
                  >
                    <option value="economy">Economy</option>
                    <option value="premium_economy">Premium Economy</option>
                    <option value="business">Business</option>
                    <option value="first">First</option>
                  </select>
                </div>
                <div>
                  <label className={`label ${textClass}`}>Category</label>
                  <div className="flex gap-2">
                    {(['business', 'private', 'vacation'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategory(cat)}
                        className={`px-4 py-2 rounded ${
                          category === cat
                            ? 'bg-blue-500 text-white'
                            : isDarkMode
                            ? 'bg-gray-700 text-gray-300'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className={`label ${textClass}`}>Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={`input ${sizedInputClass}`}
                  rows={3}
                  placeholder="Additional information..."
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={onCancel}
              className="btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            {step === 'complete' && (
              <button
                type="submit"
                className="btn-primary"
                disabled={loading || !departure || !arrival}
              >
                {loading ? 'Saving...' : 'Save Flight'}
              </button>
            )}
          </div>
        </form>
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




