import { useState, useEffect } from 'react';
import { Airport, FlightInput } from '../types';
import { airportsApi, parseApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';

interface ParsedBooking {
  airline?: string;
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  pnr?: string;
  seat?: string;
  terminal?: string;
  gate?: string;
  price?: string;
  currency?: string;
  aircraft?: string;
  seatClass?: string;
  bookingReference?: string;
  ticketNumber?: string;
  boardingGroup?: string;
  taxes?: string;
  fees?: string;
  missing?: string[];
}

interface FlightReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (flight: FlightInput) => Promise<void>;
  initialData: ParsedBooking;
  source: 'email' | 'boardingpass';
  flightIndex?: number; // For multi-flight: "Flight 1 of 3"
  totalFlights?: number;
  parserProvider?: string; // Provider used for parsing (regex, ollama, openai, claude)
  originalData?: {
    subject?: string;
    text?: string;
    html?: string;
  }; // Original email/boarding pass data for feedback
}

export default function FlightReviewModal({
  isOpen,
  onClose,
  onConfirm,
  initialData,
  source,
  flightIndex,
  totalFlights,
  parserProvider = 'unknown',
  originalData,
}: FlightReviewModalProps) {
  const { user } = useAuthStore();
  // Form state
  const [flightNumber, setFlightNumber] = useState('');
  const [airline, setAirline] = useState('');
  const [departureCode, setDepartureCode] = useState('');
  const [arrivalCode, setArrivalCode] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [aircraft, setAircraft] = useState('');
  const [seatClass, setSeatClass] = useState<'economy' | 'premium_economy' | 'business' | 'first'>('economy');
  const [seat, setSeat] = useState('');
  const [terminal, setTerminal] = useState('');
  const [gate, setGate] = useState('');
  const [bookingReference, setBookingReference] = useState('');
  const [boardingGroup, setBoardingGroup] = useState('');
  const [ticketNumber, setTicketNumber] = useState('');
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState<'EUR' | 'USD' | 'GBP' | 'CHF'>('EUR');
  const [taxes, setTaxes] = useState<number | undefined>(undefined);
  const [fees, setFees] = useState<number | undefined>(undefined);

  // Airport lookup state
  const [departureAirport, setDepartureAirport] = useState<Airport | null>(null);
  const [arrivalAirport, setArrivalAirport] = useState<Airport | null>(null);
  const [airportLoading, setAirportLoading] = useState(false);
  const [airportError, setAirportError] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Initialize form with parsed data
  useEffect(() => {
    if (initialData) {
      setFlightNumber(initialData.flightNumber || '');
      setAirline(initialData.airline || '');
      setDepartureCode(initialData.departureCode || '');
      setArrivalCode(initialData.arrivalCode || '');
      setDepartureTime(initialData.departureTime ? formatDateTimeLocal(initialData.departureTime) : '');
      setArrivalTime(initialData.arrivalTime ? formatDateTimeLocal(initialData.arrivalTime) : '');
      setAircraft(initialData.aircraft || '');
      setSeat(initialData.seat || '');
      setTerminal(initialData.terminal || '');
      setGate(initialData.gate || '');
      setBookingReference(initialData.bookingReference || initialData.pnr || '');
      setBoardingGroup(initialData.boardingGroup || '');
      setTicketNumber(initialData.ticketNumber || '');

      // Parse price fields
      if (initialData.price) {
        const priceNum = parseFloat(initialData.price);
        if (!isNaN(priceNum)) setPrice(priceNum);
      }
      if (initialData.taxes) {
        const taxesNum = parseFloat(initialData.taxes);
        if (!isNaN(taxesNum)) setTaxes(taxesNum);
      }
      if (initialData.fees) {
        const feesNum = parseFloat(initialData.fees);
        if (!isNaN(feesNum)) setFees(feesNum);
      }
      if (initialData.currency) {
        setCurrency(initialData.currency.toUpperCase() as 'EUR' | 'USD' | 'GBP' | 'CHF');
      }

      // Map seat class
      const mappedSeatClass = mapSeatClass(initialData.seatClass);
      if (mappedSeatClass) {
        setSeatClass(mappedSeatClass);
      }

      // Lookup airports
      if (initialData.departureCode || initialData.arrivalCode) {
        lookupAirports(initialData.departureCode, initialData.arrivalCode);
      }
    }
  }, [initialData]);

  // Format datetime for datetime-local input
  const formatDateTimeLocal = (isoString: string): string => {
    try {
      return new Date(isoString).toISOString().slice(0, 16);
    } catch {
      return '';
    }
  };

  // Map parsed seat class to FlightInput format
  const mapSeatClass = (seatClass?: string): 'economy' | 'premium_economy' | 'business' | 'first' | null => {
    if (!seatClass) return null;
    const lower = seatClass.toLowerCase();
    if (lower.includes('first')) return 'first';
    if (lower.includes('business')) return 'business';
    if (lower.includes('premium')) return 'premium_economy';
    if (lower.includes('economy')) return 'economy';
    return null;
  };

  // Lookup airports by IATA code
  const lookupAirports = async (depCode?: string, arrCode?: string) => {
    if (!depCode && !arrCode) return;

    setAirportLoading(true);
    setAirportError('');

    try {
      if (depCode) {
        const depResults = await airportsApi.search(depCode);
        const depMatch = depResults.find(
          (a: Airport) => a.iata?.toUpperCase() === depCode.toUpperCase()
        );
        if (depMatch) {
          setDepartureAirport(depMatch);
        } else {
          setAirportError(`Abflughafen ${depCode} nicht gefunden`);
        }
      }

      if (arrCode) {
        const arrResults = await airportsApi.search(arrCode);
        const arrMatch = arrResults.find(
          (a: Airport) => a.iata?.toUpperCase() === arrCode.toUpperCase()
        );
        if (arrMatch) {
          setArrivalAirport(arrMatch);
        } else {
          setAirportError((prev) =>
            prev ? `${prev}, Ankunftsflughafen ${arrCode} nicht gefunden` : `Ankunftsflughafen ${arrCode} nicht gefunden`
          );
        }
      }
    } catch (err) {
      setAirportError('Fehler beim Laden der Flughäfen');
    } finally {
      setAirportLoading(false);
    }
  };

  // Retry airport lookup when codes change
  useEffect(() => {
    if (departureCode && !departureAirport) {
      lookupAirports(departureCode, undefined);
    }
  }, [departureCode]);

  useEffect(() => {
    if (arrivalCode && !arrivalAirport) {
      lookupAirports(undefined, arrivalCode);
    }
  }, [arrivalCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!departureAirport || !arrivalAirport) {
      setError('Bitte geben Sie gültige Flughafencodes ein');
      return;
    }

    if (!departureTime || !arrivalTime) {
      setError('Abflug- und Ankunftszeit sind erforderlich');
      return;
    }

    setLoading(true);

    try {
      const flightInput: FlightInput = {
        airline,
        flightNumber,
        aircraft,
        departure: departureAirport,
        arrival: arrivalAirport,
        departureTime: new Date(departureTime).toISOString(),
        arrivalTime: new Date(arrivalTime).toISOString(),
        seatNumber: seat || undefined,
        seatClass: seatClass || undefined,
        boardingGroup: boardingGroup || undefined,
        gate: gate || undefined,
        terminal: terminal || undefined,
        bookingReference: bookingReference || undefined,
        ticketNumber: ticketNumber || undefined,
        price,
        currency,
        taxes,
        fees,
        status: new Date(departureTime) < new Date() ? 'flown' : 'scheduled',
      };

      // Check if data was corrected and collect feedback
      const hasCorrections = checkForCorrections(initialData, flightInput);
      if (hasCorrections && user) {
        // Collect feedback asynchronously (don't await to avoid blocking)
        collectFeedback(initialData, flightInput).catch(err => {
          console.warn('Failed to collect feedback:', err);
        });
      }

      await onConfirm(flightInput);
      // onConfirm handles closing the modal or moving to next flight
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Fehler beim Speichern');
    } finally {
      setLoading(false);
    }
  };

  // Check if user made corrections to parsed data
  const checkForCorrections = (original: ParsedBooking, corrected: FlightInput): boolean => {
    // Check critical fields
    if (original.flightNumber !== corrected.flightNumber) return true;
    if (original.departureCode !== corrected.departure?.iata) return true;
    if (original.arrivalCode !== corrected.arrival?.iata) return true;
    if (original.departureTime && corrected.departureTime) {
      const origTime = new Date(original.departureTime).getTime();
      const corrTime = new Date(corrected.departureTime).getTime();
      if (Math.abs(origTime - corrTime) > 60000) return true; // More than 1 minute difference
    }
    if (original.pnr !== corrected.bookingReference) return true;
    if (original.seat !== corrected.seatNumber) return true;
    return false;
  };

  // Collect feedback for corrections
  const collectFeedback = async (original: ParsedBooking, corrected: FlightInput) => {
    try {
      const originalResult = [{
        flightNumber: original.flightNumber,
        departureCode: original.departureCode,
        arrivalCode: original.arrivalCode,
        departureTime: original.departureTime,
        arrivalTime: original.arrivalTime,
        pnr: original.pnr,
        seat: original.seat,
        gate: original.gate,
        terminal: original.terminal,
        airline: original.airline,
      }];

      const correctedResult = [{
        flightNumber: corrected.flightNumber,
        departureCode: corrected.departure?.iata,
        arrivalCode: corrected.arrival?.iata,
        departureTime: corrected.departureTime,
        arrivalTime: corrected.arrivalTime,
        pnr: corrected.bookingReference,
        seat: corrected.seatNumber,
        gate: corrected.gate,
        terminal: corrected.terminal,
        airline: corrected.airline,
      }];

      await parseApi.submitParserCorrection({
        sourceType: source,
        provider: parserProvider,
        originalResult,
        correctedResult,
        originalData,
      });
    } catch (error) {
      // Silently fail - feedback collection should not break the flow
      console.warn('Failed to submit parser correction feedback:', error);
    }
  };

  if (!isOpen) return null;

  const title = source === 'email' ? 'Email-Import prüfen' : 'Boarding Pass prüfen';
  const showProgress = totalFlights && totalFlights > 1 && flightIndex !== undefined;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
            {showProgress && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Flug {flightIndex! + 1} von {totalFlights}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Schließen"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {airportError && (
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <p className="text-yellow-800 dark:text-yellow-200">{airportError}</p>
            </div>
          )}

          {airportLoading && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-blue-800 dark:text-blue-200">Lade Flughäfen...</p>
            </div>
          )}

          {/* Flight Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Flugnummer *
              </label>
              <input
                type="text"
                value={flightNumber}
                onChange={(e) => setFlightNumber(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="LH123"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Fluggesellschaft
              </label>
              <input
                type="text"
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="Lufthansa"
              />
            </div>
          </div>

          {/* Route */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Abflughafen (IATA) *
              </label>
              <input
                type="text"
                value={departureCode}
                onChange={(e) => {
                  const code = e.target.value.toUpperCase();
                  setDepartureCode(code);
                  setDepartureAirport(null);
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="FRA"
                maxLength={3}
                required
              />
              {departureAirport && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  ✓ {departureAirport.name} ({departureAirport.iata})
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Ankunftsflughafen (IATA) *
              </label>
              <input
                type="text"
                value={arrivalCode}
                onChange={(e) => {
                  const code = e.target.value.toUpperCase();
                  setArrivalCode(code);
                  setArrivalAirport(null);
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="JFK"
                maxLength={3}
                required
              />
              {arrivalAirport && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  ✓ {arrivalAirport.name} ({arrivalAirport.iata})
                </p>
              )}
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Abflugzeit *
              </label>
              <input
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Ankunftszeit *
              </label>
              <input
                type="datetime-local"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Aircraft and Class */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Flugzeugtyp
              </label>
              <input
                type="text"
                value={aircraft}
                onChange={(e) => setAircraft(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="z.B. Airbus A321"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sitzklasse
              </label>
              <select
                value={seatClass}
                onChange={(e) => setSeatClass(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="business">Business</option>
                <option value="first">First Class</option>
              </select>
            </div>
          </div>

          {/* Seat Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sitzplatz
              </label>
              <input
                type="text"
                value={seat}
                onChange={(e) => setSeat(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="12A"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Terminal
              </label>
              <input
                type="text"
                value={terminal}
                onChange={(e) => setTerminal(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Gate
              </label>
              <input
                type="text"
                value={gate}
                onChange={(e) => setGate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="A12"
              />
            </div>
          </div>

          {/* Booking Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Buchungsreferenz (PNR)
              </label>
              <input
                type="text"
                value={bookingReference}
                onChange={(e) => setBookingReference(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="z.B. 9RFAA7"
                maxLength={6}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Boarding-Gruppe
              </label>
              <input
                type="text"
                value={boardingGroup}
                onChange={(e) => setBoardingGroup(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="z.B. 1 oder A"
                maxLength={3}
              />
            </div>
          </div>

          {/* Ticket Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Ticketnummer
            </label>
            <input
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              placeholder="z.B. 2202236084346"
              maxLength={13}
            />
          </div>

          {/* Cost Breakdown */}
          <div className="border dark:border-gray-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Kosten (optional)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Gesamtpreis
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={price || ''}
                  onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="513.47"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Währung
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                  <option value="CHF">CHF</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Steuern
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={taxes || ''}
                  onChange={(e) => setTaxes(e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="45.67"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Gebühren
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={fees || ''}
                  onChange={(e) => setFees(e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="12.30"
                />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-semibold"
              disabled={loading}
            >
              {showProgress ? 'Abbrechen' : 'Verwerfen'}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || airportLoading || !departureAirport || !arrivalAirport}
            >
              {loading ? 'Speichert...' : showProgress ? 'Weiter' : 'Bestätigen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
