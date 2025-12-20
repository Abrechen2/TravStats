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

import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Airport, airportsApi } from '../lib/api';
import AirportAutocomplete from './AirportAutocomplete';
import HelpIcon from './Help/HelpIcon';
import { useTranslation } from '../hooks/useTranslation';

// Lazy load BoardingPassScanner as it's heavy (Tesseract.js)
const BoardingPassScanner = lazy(() => import('./BoardingPassScanner'));
import FlightReviewModal from './FlightReviewModal';
import type { FlightInput } from '../types';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import { calculateDistance } from '../lib/geo';
import { storeHistoricalFlightTime, estimateFlightTimes } from '../lib/timeEstimation';

// Error messages will be handled via i18n

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
  const { t } = useTranslation(['flights', 'errors', 'common']);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const settings = useSettingsStore();

  // UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [showEmailUploader, setShowEmailUploader] = useState(false);
  const [step, setStep] = useState<'input' | 'lookup' | 'select' | 'complete'>('input');
  const [timeEstimationWarning, setTimeEstimationWarning] = useState<{
    show: boolean;
    source: 'historical' | 'heuristic';
    confidence: 'high' | 'medium' | 'low';
    sampleCount?: number;
  } | null>(null);

  // Email Import & Review State
  const [parsedFlights, setParsedFlights] = useState<any[]>([]);
  const [currentFlightIndex, setCurrentFlightIndex] = useState(0);
  const [showFlightReview, setShowFlightReview] = useState(false);
  const [parserProvider] = useState<string>('unknown');
  const [originalEmailData] = useState<{ subject?: string; text?: string; html?: string } | undefined>();

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

  // Track if arrival date has been set manually (to avoid overwriting user input)
  const arrivalDateSetRef = useRef(false);

  // Auto-suggest arrival time based on estimated flight duration
  useEffect(() => {
    // Only auto-suggest if arrival date hasn't been set yet
    if (departureDate && departureTime && departure && arrival && !arrivalDateSetRef.current) {
      try {
        // Use hybrid estimation system (historical data or heuristics)
        // Assume boarding time is 30 minutes before departure
        const depDateTime = new Date(`${departureDate}T${departureTime}`);
        depDateTime.setMinutes(depDateTime.getMinutes() - 30);
        const boardingTime = `${String(depDateTime.getHours()).padStart(2, '0')}:${String(depDateTime.getMinutes()).padStart(2, '0')}`;

        const estimation = estimateFlightTimes(
          boardingTime,
          departureDate,
          flightNumber || undefined,
          departure.iata || '',
          arrival.iata || '',
          departure.lat,
          departure.lon,
          arrival.lat,
          arrival.lon
        );

        // Set estimated times
        setArrivalDate(departureDate); // Same day for now (could be next day for long flights)
        setArrivalTime(estimation.arrivalTime);
        arrivalDateSetRef.current = true;

        // Set warning to show user that times are estimated
        setTimeEstimationWarning({
          show: true,
          source: estimation.source,
          confidence: estimation.confidence,
          sampleCount: estimation.sampleCount,
        });
      } catch (err) {
        // If calculation fails, use same day + 2 hours as fallback
        const depDateTime = new Date(`${departureDate}T${departureTime}`);
        const arrDateTime = new Date(depDateTime.getTime() + 2 * 60 * 60 * 1000);
        setArrivalDate(arrDateTime.toISOString().split('T')[0]);
        setArrivalTime(arrDateTime.toTimeString().slice(0, 5));
        arrivalDateSetRef.current = true;

        // Set warning for fallback estimation
        setTimeEstimationWarning({
          show: true,
          source: 'heuristic',
          confidence: 'low',
        });
      }
    }
  }, [departureDate, departureTime, departure, arrival, flightNumber]);

  // Flight Lookup Handler
  const handleFlightLookup = async () => {
    if (!flightNumber.trim()) {
      setError(t('errors:noFlightNumber'));
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
        setError(t('errors:noFlightsFound'));
        setStep('complete'); // Skip to manual entry
        return;
      }

      setLookupResults(data.flights);
      setStep('select');
    } catch (err) {
      console.error('Flight lookup error:', err);
      setError(`${t('errors:lookupUnavailable')} ${t('errors:apiKeyInfo')}`);
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
      const results = await Promise.allSettled([
        flight.departure.iata ? airportsApi.getByCode(flight.departure.iata) : Promise.resolve(null),
        flight.arrival.iata ? airportsApi.getByCode(flight.arrival.iata) : Promise.resolve(null),
      ]);

      const depAirport = results[0].status === 'fulfilled' ? results[0].value : null;
      const arrAirport = results[1].status === 'fulfilled' ? results[1].value : null;

      // Handle errors: if one airport lookup failed, show warning but continue
      if (results[0].status === 'rejected' || results[1].status === 'rejected') {
        const failedAirports: string[] = [];
        if (results[0].status === 'rejected') {
          failedAirports.push(flight.departure.iata || 'departure');
        }
        if (results[1].status === 'rejected') {
          failedAirports.push(flight.arrival.iata || 'arrival');
        }
        // Don't set error, just log - user can still manually select airports
      }

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
        applyDateTime(flight.departure.scheduledTime, { setDate: () => { }, setTime: setDepartureTime }, true);
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
      setError(t('errors:failedToLoadAirport'));
    } finally {
      setLoading(false);
    }
  };

  // Boarding Pass Scanner with Ollama Vision
  // Now the scanner sends image to backend which uses Ollama + optional API enrichment
  // Returns ParsedBooking that we display in FlightReviewModal
  const handleBoardingPassScan = async (parsedData: any) => {
    setShowScanner(false);
    setError('');

    // parsedData is now already a ParsedBooking from Ollama Vision
    // Show it in the review modal
    setParsedFlights([parsedData]);
    setCurrentFlightIndex(0);
    setShowFlightReview(true);
  };

  // Live validation
  const canSubmit = useMemo(() => {
    return !!(departure && arrival && departureDate && arrivalDate);
  }, [departure, arrival, departureDate, arrivalDate]);

  // Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!departure || !arrival) {
      setError(t('errors:missingAirports'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Convert local times to ISO strings (properly handles timezone conversion)
      // Note: This treats input times as local browser time and converts to UTC
      const departureDateTime = new Date(`${departureDate}T${departureTime}:00`).toISOString();
      const arrivalDateTime = new Date(`${arrivalDate}T${arrivalTime}:00`).toISOString();

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

      // Clear time estimation warning after successful submit
      setTimeEstimationWarning(null);

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
      setError(err.response?.data?.error || t('errors:saveFailed'));
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
          <h2 className={`text-2xl font-bold ${textClass}`}>{t('flights:form.title')}</h2>
          <p className={`text-sm ${mutedTextClass} mt-1`}>
            {step === 'input' && t('flights:form.steps.input')}
            {step === 'select' && t('flights:form.steps.select')}
            {step === 'complete' && t('flights:form.steps.complete')}
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
                    <h3 className={`font-semibold text-lg ${textClass}`}>{t('flights:form.boardingPass.title')}</h3>
                    <p className={`text-sm ${mutedTextClass}`}>{t('flights:form.boardingPass.description')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    className="btn-primary"
                  >
                    {t('flights:form.boardingPass.scan')}
                  </button>
                </div>
              </div>

              {/* Email Import */}
              <div className={`bg-gradient-to-r ${isDarkMode ? 'from-green-900 to-teal-900' : 'from-green-50 to-teal-50'} border ${isDarkMode ? 'border-green-700' : 'border-green-200'} rounded-lg p-4`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className={`font-semibold text-lg ${textClass}`}>{t('flights:form.email.title')}</h3>
                    <p className={`text-sm ${mutedTextClass}`}>{t('flights:form.email.description')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEmailUploader(true)}
                    className="btn-secondary"
                  >
                    {t('flights:form.email.import')}
                  </button>
                </div>
              </div>

              {/* Flight Number Input */}
              <div>
                <label className={`label ${textClass} flex items-center gap-2`}>
                  {t('flights:form.flightNumber')} {t('flights:form.flightNumberExample')}
                  <HelpIcon
                    content={t('flights:form.help.flightNumber')}
                    expandedContent={t('flights:form.help.flightNumberExpanded')}
                    position="top"
                  />
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                    className={`input flex-1 ${sizedInputClass}`}
                    placeholder={t('flights:form.placeholders.flightNumber')}
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
                    {loading ? t('flights:form.searching') : t('flights:form.searchFlight')}
                  </button>
                </div>
                <p className={`text-xs ${mutedTextClass} mt-1`}>
                  {t('flights:form.lookupHint')}
                </p>
              </div>

              {/* Manual Entry Option */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setStep('complete')}
                  className={`text-sm ${isDarkMode ? 'text-blue-400' : 'text-blue-600'} hover:underline`}
                >
                  {t('flights:form.manualEntryAction')}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Select Flight from Results */}
          {step === 'select' && lookupResults.length > 0 && (
            <div className="space-y-4">
              <h3 className={`font-semibold text-lg ${textClass}`}>
                {t('flights:lookup.resultsTitle', { count: lookupResults.length })}
              </h3>
              {lookupResults.map((flight, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectFlight(flight)}
                  className={`w-full text-left p-4 rounded-lg border-2 ${isDarkMode
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
                        {flight.departure.iata} {t('common:labels.routeSeparator')} {flight.arrival.iata}
                      </div>
                      {flight.departure.scheduledTime && (
                        <div className={`text-xs ${mutedTextClass} mt-1`}>
                          {t('flights:lookup.departs')}: {new Date(flight.departure.scheduledTime).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {flight.status && (
                      <span className={`px-2 py-1 rounded text-xs ${flight.status === 'landed' ? 'bg-green-100 text-green-800' :
                        flight.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                        {t('flights:status.' + flight.status, { defaultValue: flight.status })}
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
                {t('flights:lookup.backToSearch')}
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
                    {t('flights:form.lookupLoaded', { airline: selectedFlight.airline, flightNumber: selectedFlight.flightNumber })}
                  </div>
                </div>
              )}

              {/* Time Estimation Warning */}
              {timeEstimationWarning?.show && (
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-yellow-900' : 'bg-yellow-50'} border ${isDarkMode ? 'border-yellow-700' : 'border-yellow-200'}`}>
                  <div className={`font-medium ${isDarkMode ? 'text-yellow-200' : 'text-yellow-800'} flex items-center gap-2`}>
                    {t('flights:form.estimatedTimes')}
                  </div>
                  <div className={`text-sm ${isDarkMode ? 'text-yellow-300' : 'text-yellow-700'} mt-2`}>
                    {timeEstimationWarning.source === 'historical' ? (
                      <>
                        <strong>{t('flights:form.estimatedTimesHistorical', { count: timeEstimationWarning.sampleCount })}</strong>
                        <br />
                        {t('flights:form.estimatedTimesCalculated')}
                      </>
                    ) : (
                      <>
                        <strong>{t('flights:form.estimatedTimesAutomatic')}</strong>
                        <br />
                        {t('flights:form.estimatedTimesAssumption', { minutes: Math.round((calculateDistance(
                          departure?.lat || 0,
                          departure?.lon || 0,
                          arrival?.lat || 0,
                          arrival?.lon || 0
                        ) / 800) * 60 + 15) })}
                      </>
                    )}
                  </div>
                  <div className={`text-sm ${isDarkMode ? 'text-yellow-300' : 'text-yellow-700'} mt-2 font-semibold`}>
                    {t('flights:form.reviewTimes')}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTimeEstimationWarning(null)}
                    className={`text-xs ${isDarkMode ? 'text-yellow-400 hover:text-yellow-300' : 'text-yellow-600 hover:text-yellow-800'} mt-2 underline`}
                  >
                    {t('flights:form.hideWarning')}
                  </button>
                </div>
              )}

              {/* Airports */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className={`label ${textClass}`}>{t('flights:form.from')}</label>
                    <HelpIcon
                      content={t('flights:form.help.departureAirport')}
                      position="top"
                    />
                  </div>
                  <AirportAutocomplete
                    value={departure}
                    onChange={setDeparture}
                    label=""
                    placeholder={t('flights:form.placeholders.departureAirport')}
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className={`label ${textClass}`}>{t('flights:form.to')}</label>
                    <HelpIcon
                      content={t('flights:form.help.arrivalAirport')}
                      position="top"
                    />
                  </div>
                  <AirportAutocomplete
                    value={arrival}
                    onChange={setArrival}
                    label=""
                    placeholder={t('flights:form.placeholders.arrivalAirport')}
                    required
                  />
                </div>
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`label ${textClass} flex items-center gap-2`}>
                    {t('flights:form.departureDate')}
                    <HelpIcon
                      content={t('flights:form.help.departureDate')}
                      position="top"
                    />
                  </label>
                  <input
                    type="date"
                    value={departureDate}
                    onChange={(e) => setDepartureDate(e.target.value)}
                    className={`input ${sizedInputClass}`}
                    required
                  />
                </div>
                <div>
                  <label className={`label ${textClass} flex items-center gap-2`}>
                    {t('flights:form.departureTime')}
                    <HelpIcon
                      content={t('flights:form.help.departureTime')}
                      expandedContent={t('flights:form.help.departureTimeExpanded')}
                      position="top"
                    />
                  </label>
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
                  <label className={`label ${textClass} flex items-center gap-2`}>
                    {t('flights:form.arrivalDate')} *
                    <HelpIcon
                      content={t('flights:form.help.arrivalDate')}
                      position="top"
                    />
                  </label>
                  <input
                    type="date"
                    value={arrivalDate}
                    onChange={(e) => setArrivalDate(e.target.value)}
                    className={`input ${sizedInputClass}`}
                    required
                  />
                </div>
                <div>
                  <label className={`label ${textClass} flex items-center gap-2`}>
                    {t('flights:form.arrivalTime')}
                    <HelpIcon
                      content={t('flights:form.help.arrivalTime')}
                      expandedContent={t('flights:form.help.arrivalTimeExpanded')}
                      position="top"
                    />
                  </label>
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
                  <label className={`label ${textClass}`}>{t('flights:form.airline')}</label>
                  <input
                    type="text"
                    value={airline}
                    onChange={(e) => setAirline(e.target.value)}
                    className={`input ${sizedInputClass}`}
                    placeholder={t('flights:form.placeholders.airline')}
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>{t('flights:form.flightNumber')}</label>
                  <input
                    type="text"
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                    className={`input ${sizedInputClass}`}
                    placeholder={t('flights:form.placeholders.flightNumber')}
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>{t('flights:form.status')}</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'scheduled' | 'flown' | 'cancelled')}
                    className={`input ${sizedInputClass}`}
                  >
                    <option value="flown">{t('flights:status.flown')}</option>
                    <option value="scheduled">{t('flights:status.scheduled')}</option>
                    <option value="cancelled">{t('flights:status.cancelled')}</option>
                  </select>
                </div>
              </div>

              {/* Equipment / Gate / Seat / Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`label ${textClass}`}>{t('flights:form.aircraft')}</label>
                  <input
                    type="text"
                    value={aircraft}
                    onChange={(e) => setAircraft(e.target.value)}
                    className={`input ${sizedInputClass}`}
                    placeholder={t('flights:form.placeholders.aircraft')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`label ${textClass}`}>{t('flights:form.terminal')}</label>
                    <input
                      type="text"
                      value={terminal}
                      onChange={(e) => setTerminal(e.target.value)}
                      className={`input ${sizedInputClass}`}
                      placeholder={t('flights:form.placeholders.terminal')}
                    />
                  </div>
                  <div>
                    <label className={`label ${textClass}`}>{t('flights:form.gate')}</label>
                    <input
                      type="text"
                      value={gate}
                      onChange={(e) => setGate(e.target.value)}
                      className={`input ${sizedInputClass}`}
                      placeholder={t('flights:form.placeholders.gate')}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={`label ${textClass}`}>{t('flights:form.seat')}</label>
                  <input
                    type="text"
                    value={seatNumber}
                    onChange={(e) => setSeatNumber(e.target.value.toUpperCase())}
                    className={`input ${sizedInputClass}`}
                    placeholder={t('flights:form.placeholders.seat')}
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>{t('flights:form.seatClass')}</label>
                  <select
                    value={seatClass}
                    onChange={(e) => setSeatClass(e.target.value as 'economy' | 'premium_economy' | 'business' | 'first')}
                    className={`input ${sizedInputClass}`}
                  >
                    <option value="economy">{t('flights:seatClass.economy')}</option>
                    <option value="premium_economy">{t('flights:seatClass.premium_economy')}</option>
                    <option value="business">{t('flights:seatClass.business')}</option>
                    <option value="first">{t('flights:seatClass.first')}</option>
                  </select>
                </div>
                <div>
                  <label className={`label ${textClass}`}>{t('flights:form.category')}</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as 'business' | 'private' | 'vacation')}
                    className={`input ${sizedInputClass}`}
                  >
                    <option value="business">{t('flights:category.business')}</option>
                    <option value="private">{t('flights:category.private')}</option>
                    <option value="vacation">{t('flights:category.vacation')}</option>
                  </select>
                </div>
              </div>

              {/* Price & Currency */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className={`label ${textClass} flex items-center gap-2`}>
                    {t('flights:form.price')}
                    <HelpIcon
                      content={t('flights:form.help.price')}
                      expandedContent={t('flights:form.help.price')}
                      position="top"
                    />
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price ?? ''}
                    onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : undefined)}
                    className={`input ${sizedInputClass}`}
                    placeholder={t('flights:form.placeholders.price')}
                  />
                </div>
                <div>
                  <label className={`label ${textClass}`}>{t('flights:form.currency')}</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'EUR' | 'USD' | 'GBP' | 'CHF')}
                    className={`input ${sizedInputClass}`}
                  >
                    <option value="EUR">{t('flights:currency.EUR')}</option>
                    <option value="USD">{t('flights:currency.USD')}</option>
                    <option value="GBP">{t('flights:currency.GBP')}</option>
                    <option value="CHF">{t('flights:currency.CHF')}</option>
                  </select>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className={`label ${textClass} flex items-center gap-2`}>
                  {t('flights:form.tags')}
                  <HelpIcon
                    content={t('flights:form.help.tags')}
                    expandedContent={t('flights:form.help.tagsExpanded')}
                    position="top"
                  />
                </label>
                <input
                  type="text"
                  value={tags.join(', ')}
                  onChange={(e) => setTags(e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                  className={`input ${sizedInputClass}`}
                  placeholder={t('flights:form.placeholders.tags')}
                />
                <p className={`text-xs ${mutedTextClass} mt-1`}>{t('flights:form.tagsHint')}</p>
              </div>

              {/* Notes */}
              <div>
                <label className={`label ${textClass}`}>{t('flights:form.notes')}</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={`input ${sizedInputClass}`}
                  rows={3}
                  placeholder={t('flights:form.placeholders.notes')}
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
              {t('flights:form.cancel')}
            </button>
            {step === 'complete' && (
              <button
                type="submit"
                className={`btn-primary ${!canSubmit ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={loading || !canSubmit}
                title={!canSubmit ? t('flights:form.validation.selectAirportsAndDates') : t('flights:form.submit')}
              >
                {loading ? t('flights:form.saving') : t('flights:form.submit')}
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Boarding Pass Scanner Modal */}
      {showScanner && (
        <Suspense fallback={
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-8">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                <p className="text-gray-600 dark:text-gray-300">{t('flights:form.loadingScanner')}</p>
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

      {/* Email Uploader Modal - TODO: Implement EmailUploader component */}
      {showEmailUploader && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md">
            <h3 className="text-lg font-bold mb-4">{t('flights:form.email.title')}</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{t('flights:form.email.notImplemented')}</p>
            <button
              onClick={() => setShowEmailUploader(false)}
              className="btn-primary"
            >
              {t('common:buttons.close')}
            </button>
          </div>
        </div>
      )}

      {/* Flight Review Modal (for Email & Boarding Pass) */}
      {showFlightReview && parsedFlights.length > 0 && (
        <FlightReviewModal
          isOpen={showFlightReview}
          onClose={() => {
            setShowFlightReview(false);
            setParsedFlights([]);
            setCurrentFlightIndex(0);
          }}
          onConfirm={async (flightData) => {
            try {
              await onSubmit(flightData);

              // Check if there are more flights to process
              if (currentFlightIndex < parsedFlights.length - 1) {
                // Move to next flight
                setCurrentFlightIndex(currentFlightIndex + 1);
                // Review modal stays open for next flight
              } else {
                // All flights processed - close everything
                setShowFlightReview(false);
                setParsedFlights([]);
                setCurrentFlightIndex(0);
                onCancel(); // Close Add Flight Dialog
              }
            } catch (err) {
              // Error is handled in FlightReviewModal
              throw err;
            }
          }}
          initialData={parsedFlights[currentFlightIndex]}
          source="email"
          flightIndex={currentFlightIndex}
          totalFlights={parsedFlights.length}
          parserProvider={parserProvider}
          originalData={originalEmailData}
        />
      )}
    </div>
  );
}














