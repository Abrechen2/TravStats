/**
 * Simplified Flight Form V2
 *
 * Features:
 * - Dark Mode Support
 * - Smart Flight Number Lookup (Flight-First UX)
 * - Boarding Pass Scanner with Online Validation
 * - Step-by-Step guided flow
 * - Live Validation
 * - Auto-Arrival Time Suggestion
 */

import { useState, useEffect, useMemo } from 'react';
import { Airport, airportsApi } from '../lib/api';
import AirportAutocomplete from './AirportAutocomplete';
import BoardingPassScanner from './BoardingPassScanner';
import { BoardingPassData, getAirlineName } from '../lib/bcbpParser';
import type { FlightInput } from '../types';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { calculateDistance } from '../lib/geo';
import { estimateFlightTimes, storeHistoricalFlightTime } from '../lib/timeEstimation';

// Konsistente Error Messages (Deutsch)
const ERROR_MESSAGES = {
  NO_FLIGHT_NUMBER: 'Bitte geben Sie eine Flugnummer ein',
  NO_FLIGHTS_FOUND: 'Keine Flüge gefunden. Bitte versuchen Sie ein anderes Datum oder geben Sie die Daten manuell ein.',
  LOOKUP_UNAVAILABLE: 'Flugsuche momentan nicht verfügbar. Bitte geben Sie die Daten manuell ein.',
  BOARDING_PASS_ERROR: 'Boarding Pass konnte nicht gescannt werden. Bitte versuchen Sie es erneut oder geben Sie die Daten manuell ein.',
  MISSING_AIRPORTS: 'Bitte wählen Sie Start- und Zielflughafen aus',
  SAVE_FAILED: 'Flug konnte nicht gespeichert werden. Bitte überprüfen Sie Ihre Eingaben.',
  API_KEY_INFO: 'Hinweis: Für die automatische Flugsuche wird ein API-Schlüssel benötigt.',
};

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
  const [timeEstimationWarning, setTimeEstimationWarning] = useState<{
    show: boolean;
    source: 'historical' | 'heuristic';
    confidence: 'high' | 'medium' | 'low';
    sampleCount?: number;
  } | null>(null);

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
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState<'EUR' | 'USD' | 'GBP' | 'CHF'>('EUR');
  const [category, setCategory] = useState<'business' | 'private' | 'vacation'>('business');
  const [tags, setTags] = useState<string[]>([]);

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

  // Auto-suggest arrival time based on estimated flight duration
  useEffect(() => {
    if (departureDate && departureTime && departure && arrival && !arrivalDate) {
      try {
        // Simple heuristic: ~1 hour per 800km + 30min buffer
        const distance = calculateDistance(
          departure.lat,
          departure.lon,
          arrival.lat,
          arrival.lon
        );
        const estimatedHours = Math.max(0.5, distance / 800 + 0.5);

        const depDateTime = new Date(`${departureDate}T${departureTime}`);
        const arrDateTime = new Date(depDateTime.getTime() + estimatedHours * 60 * 60 * 1000);

        setArrivalDate(arrDateTime.toISOString().split('T')[0]);
        setArrivalTime(arrDateTime.toTimeString().slice(0, 5));
      } catch (err) {
        // If calculation fails, use same day + 2 hours as fallback
        const depDateTime = new Date(`${departureDate}T${departureTime}`);
        const arrDateTime = new Date(depDateTime.getTime() + 2 * 60 * 60 * 1000);
        setArrivalDate(arrDateTime.toISOString().split('T')[0]);
        setArrivalTime(arrDateTime.toTimeString().slice(0, 5));
      }
    }
  }, [departureDate, departureTime, departure, arrival]);

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
      setError(ERROR_MESSAGES.NO_FLIGHT_NUMBER);
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
        setError(ERROR_MESSAGES.NO_FLIGHTS_FOUND);
        setStep('complete'); // Skip to manual entry
        return;
      }

      setLookupResults(data.flights);
      setStep('select');
    } catch (err) {
      console.error('Flight lookup error:', err);
      setError(`${ERROR_MESSAGES.LOOKUP_UNAVAILABLE} ${ERROR_MESSAGES.API_KEY_INFO}`);
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

      const applyDateTime = (value?: string, setters?: { setDate: (v: string) => void; setTime: (v: string) => void }, useSearchDate?: boolean) => {
        if (!value || !setters) return;
        const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}:\d{2})?/);
        if (match) {
          // Use searchDate for departure date if provided, otherwise use API date
          if (match[1] && !useSearchDate) setters.setDate(match[1]);
          if (match[2]) setters.setTime(match[2]);
          return;
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          if (!useSearchDate) setters.setDate(parsed.toISOString().split('T')[0]);
          setters.setTime(parsed.toTimeString().slice(0, 5));
        }
      };

      // Use searchDate for departure date (user's input), but use API time
      if (searchDate) {
        setDepartureDate(searchDate);
        applyDateTime(flight.departure.scheduledTime, { setDate: () => {}, setTime: setDepartureTime }, true);
      } else {
        applyDateTime(flight.departure.scheduledTime, { setDate: setDepartureDate, setTime: setDepartureTime });
      }

      // For arrival, calculate based on departure date and flight duration
      applyDateTime(flight.arrival.scheduledTime, { setDate: setArrivalDate, setTime: setArrivalTime });

      // If searchDate was used, recalculate arrival date based on duration
      if (searchDate && flight.departure.scheduledTime && flight.arrival.scheduledTime) {
        const depTime = new Date(flight.departure.scheduledTime);
        const arrTime = new Date(flight.arrival.scheduledTime);
        const duration = arrTime.getTime() - depTime.getTime();

        const newDepTime = new Date(`${searchDate}T${departureTime || '00:00'}`);
        const newArrTime = new Date(newDepTime.getTime() + duration);

        setArrivalDate(newArrTime.toISOString().split('T')[0]);
        setArrivalTime(newArrTime.toTimeString().slice(0, 5));
      }

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
      const carrierCode = bcbpData.operatingCarrierDesignator;
      const scannedFlightNumber = bcbpData.flightNumber ? `${carrierCode || ''}${bcbpData.flightNumber}` : '';

      console.log('🎫 BOARDING PASS is SOURCE OF TRUTH - API only for optional enrichment');

      // Step 1: Get airport data for the scanned airports
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

      // Step 2: Set all boarding pass data (SOURCE OF TRUTH)
      if (carrierCode && bcbpData.flightNumber) {
        setFlightNumber(scannedFlightNumber);
        setAirline(bcbpData.airlineName || getAirlineName(carrierCode) || carrierCode);
      }

      if (bcbpData.dateOfFlight) {
        setDepartureDate(bcbpData.dateOfFlight);
        setArrivalDate(bcbpData.dateOfFlight);
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

      if (bcbpData.passengerName) {
        setNotes(`Passenger: ${bcbpData.passengerName}`);
      }

      // Set gate and terminal from boarding pass if available (SOURCE OF TRUTH)
      if (bcbpData.gate) {
        setGate(bcbpData.gate);
        console.log('🚪 Gate from boarding pass:', bcbpData.gate);
      }

      if (bcbpData.terminal) {
        setTerminal(bcbpData.terminal);
        console.log('🏢 Terminal from boarding pass:', bcbpData.terminal);
      }

      // Step 3: Try API enrichment (terminal, gate, times) - only if data matches!
      let apiTimesSet = false;
      if (!isFallbackParsing && carrierCode && bcbpData.flightNumber && bcbpData.dateOfFlight) {
        try {
          const response = await fetch(
            `/api/v1/flight-lookup/${carrierCode}${bcbpData.flightNumber}?date=${bcbpData.dateOfFlight}`
          );
          const data = await response.json();

          if (data.success && data.flights && data.flights.length > 0) {
            const apiFlight = data.flights[0];
            const apiDepartureDate = apiFlight.departure.scheduledTime?.split('T')[0];

            // Validate: API must match boarding pass
            const airportsMatch =
              apiFlight.departure.iata === bcbpData.departureAirport &&
              apiFlight.arrival.iata === bcbpData.arrivalAirport;
            const dateMatches = apiDepartureDate === bcbpData.dateOfFlight;

            if (airportsMatch && dateMatches) {
              console.log('✅ API data matches boarding pass - enriching with API times/terminal/gate');

              // Enrich with API times (if available and reasonable)
              if (apiFlight.departure.scheduledTime) {
                const apiDepTime = new Date(apiFlight.departure.scheduledTime).toTimeString().slice(0, 5);
                setDepartureTime(apiDepTime);
                apiTimesSet = true;
              }
              if (apiFlight.arrival.scheduledTime) {
                const apiArrTime = new Date(apiFlight.arrival.scheduledTime).toTimeString().slice(0, 5);
                setArrivalTime(apiArrTime);
              }

              // Enrich with terminal/gate if NOT already set from boarding pass
              if (apiFlight.departure.terminal && !bcbpData.terminal) {
                setTerminal(apiFlight.departure.terminal);
                console.log('🏢 Terminal from API (boarding pass had none):', apiFlight.departure.terminal);
              }
              if (apiFlight.departure.gate && !bcbpData.gate) {
                setGate(apiFlight.departure.gate);
                console.log('🚪 Gate from API (boarding pass had none):', apiFlight.departure.gate);
              }

              // Enrich with aircraft if available
              if (apiFlight.aircraft) {
                setAircraft(apiFlight.aircraft);
              }

              console.log('📊 API enrichment successful');
            } else {
              console.warn('⚠️ API data MISMATCH - ignoring API, using ONLY boarding pass data');
              console.warn('  Boarding Pass:', bcbpData.departureAirport, '→', bcbpData.arrivalAirport, '@', bcbpData.dateOfFlight);
              console.warn('  API Data:', apiFlight.departure.iata, '→', apiFlight.arrival.iata, '@', apiDepartureDate);
            }
          } else {
            console.log('ℹ️ No API data available - using only boarding pass data');
          }
        } catch (err) {
          console.warn('⚠️ API lookup failed - using only boarding pass data:', err);
        }
      }

      // Step 4: Estimate times if API didn't provide them (Hybrid Time Estimation)
      if (!apiTimesSet && bcbpData.dateOfFlight && depAirport && arrAirport && depAirport.iata && arrAirport.iata) {
        console.log('🔮 API times not available - using hybrid time estimation');

        // Use boarding time from boarding pass if available, otherwise default to 10:00 AM
        const boardingTime = bcbpData.boardingTime || '10:00';
        if (bcbpData.boardingTime) {
          console.log('⏰ Using boarding time from boarding pass:', bcbpData.boardingTime);
        } else {
          console.log('⏰ No boarding time in boarding pass, using default:', boardingTime);
        }

        const estimation = estimateFlightTimes(
          boardingTime,
          bcbpData.dateOfFlight,
          scannedFlightNumber,
          depAirport.iata,
          arrAirport.iata,
          depAirport.lat,
          depAirport.lon,
          arrAirport.lat,
          arrAirport.lon
        );

        setDepartureTime(estimation.departureTime);
        setArrivalTime(estimation.arrivalTime);

        // Show warning that times are estimated
        setTimeEstimationWarning({
          show: true,
          source: estimation.source,
          confidence: estimation.confidence,
          sampleCount: estimation.sampleCount,
        });

        console.log(`📊 Times estimated using ${estimation.source} (confidence: ${estimation.confidence})`);
        if (estimation.sampleCount !== undefined) {
          console.log(`   Based on ${estimation.sampleCount} historical flight(s)`);
        }
      }

      // Show success message
      if (isFallbackParsing) {
        console.log('✅ Used intelligent fallback parsing - please verify all data!');
        setNotes((prev) => (prev ? `${prev}\n` : '') + '⚠️ Extracted via fallback parsing - please verify!');
      } else {
        console.log('✅ Successfully parsed IATA BCBP boarding pass');
      }

      setStep('complete');

    } catch (err) {
      setError('Failed to process boarding pass. Please enter manually.');
    } finally {
      setLoading(false);
    }
  };

  // Live validation
  const canSubmit = useMemo(() => {
    return !!(departure && arrival && departureDate && arrivalDate);
  }, [departure, arrival, departureDate, arrivalDate]);

  // Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!departure || !arrival) {
      setError(ERROR_MESSAGES.MISSING_AIRPORTS);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const departureDateTime = `${departureDate}T${departureTime}:00Z`;
      const arrivalDateTime = `${arrivalDate}T${arrivalTime}:00Z`;

      // Store historical flight time data for future estimations
      // (only if user manually verified/corrected the times)
      if (flightNumber && departureTime && arrivalTime && departure.iata && arrival.iata) {
        // Assume boarding is 30min before departure (we don't store boarding time separately)
        const depDate = new Date(`${departureDate}T${departureTime}`);
        depDate.setMinutes(depDate.getMinutes() - 30);
        const estimatedBoardingTime = `${String(depDate.getHours()).padStart(2, '0')}:${String(depDate.getMinutes()).padStart(2, '0')}`;

        storeHistoricalFlightTime(
          flightNumber,
          departure.iata,
          arrival.iata,
          estimatedBoardingTime,
          departureTime,
          arrivalTime,
          departureDate
        );
      }

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
      setError(err.response?.data?.error || ERROR_MESSAGES.SAVE_FAILED);
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
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

              {/* Time Estimation Warning */}
              {timeEstimationWarning?.show && (
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-yellow-900' : 'bg-yellow-50'} border ${isDarkMode ? 'border-yellow-700' : 'border-yellow-200'}`}>
                  <div className={`font-medium ${isDarkMode ? 'text-yellow-200' : 'text-yellow-800'} flex items-center gap-2`}>
                    ⚠️ Geschätzte Flugzeiten
                  </div>
                  <div className={`text-sm ${isDarkMode ? 'text-yellow-300' : 'text-yellow-700'} mt-2`}>
                    {timeEstimationWarning.source === 'historical' ? (
                      <>
                        <strong>Basierend auf {timeEstimationWarning.sampleCount} {timeEstimationWarning.sampleCount === 1 ? 'historischen Flug' : 'historischen Flügen'}</strong> dieser Route.
                        <br />
                        Abflug- und Ankunftszeiten wurden aus Ihren früheren Flügen berechnet.
                      </>
                    ) : (
                      <>
                        <strong>Automatisch geschätzt</strong> basierend auf Boarding-Zeit und Flugdistanz.
                        <br />
                        Annahme: Abflug = Boarding + 30min, Flugdauer ≈ {Math.round((calculateDistance(
                          departure?.lat || 0,
                          departure?.lon || 0,
                          arrival?.lat || 0,
                          arrival?.lon || 0
                        ) / 800) * 60 + 15)} Minuten.
                      </>
                    )}
                  </div>
                  <div className={`text-sm ${isDarkMode ? 'text-yellow-300' : 'text-yellow-700'} mt-2 font-semibold`}>
                    → Bitte überprüfen und korrigieren Sie die Zeiten bei Bedarf.
                  </div>
                  <button
                    type="button"
                    onClick={() => setTimeEstimationWarning(null)}
                    className={`text-xs ${isDarkMode ? 'text-yellow-400 hover:text-yellow-300' : 'text-yellow-600 hover:text-yellow-800'} mt-2 underline`}
                  >
                    Warnung ausblenden
                  </button>
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

              {/* Arrival Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`label ${textClass}`}>Arrival Date *</label>
                  <input
                    type="date"
                    value={arrivalDate}
                    onChange={(e) => setArrivalDate(e.target.value)}
                    className={`input ${sizedInputClass}`}
                    required
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>Arrival Time</label>
                  <input
                    type="time"
                    value={arrivalTime}
                    onChange={(e) => setArrivalTime(e.target.value)}
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
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className={`input ${sizedInputClass}`}
                  >
                    <option value="business">Business</option>
                    <option value="private">Private</option>
                    <option value="vacation">Vacation</option>
                  </select>
                </div>
              </div>

              {/* Price & Currency */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className={`label ${textClass}`}>Ticket Price</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price ?? ''}
                    onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : undefined)}
                    className={`input ${sizedInputClass}`}
                    placeholder="249.99"
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'EUR' | 'USD' | 'GBP' | 'CHF')}
                    className={`input ${sizedInputClass}`}
                  >
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="CHF">CHF (Fr)</option>
                  </select>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className={`label ${textClass}`}>Tags</label>
                <input
                  type="text"
                  value={tags.join(', ')}
                  onChange={(e) => setTags(e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                  className={`input ${sizedInputClass}`}
                  placeholder="business, vacation, conference"
                />
                <p className={`text-xs ${mutedTextClass} mt-1`}>Comma-separated tags for filtering</p>
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
                className={`btn-primary ${!canSubmit ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={loading || !canSubmit}
                title={!canSubmit ? 'Bitte wählen Sie beide Flughäfen und Daten aus' : 'Flug speichern'}
              >
                {loading ? 'Speichere...' : 'Flug speichern'}
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




