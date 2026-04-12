import { useState, useEffect, lazy, Suspense } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { Airport, airportsApi, flightsApi } from "../lib/api";
import AirportAutocomplete from "./AirportAutocomplete";

// Lazy load BoardingPassScanner as it's heavy (Tesseract.js)
const BoardingPassScanner = lazy(() => import("./BoardingPassScanner"));
import type { ScanResultData } from "./BoardingPassScanner";
import type { FlightInput, FlightLookupResult } from "../types";
import { useSettingsStore } from "../store/settingsStore";
import { logger } from "../lib/logger";

interface SimplifiedFlightFormProps {
  onSubmit: (flight: FlightInput) => Promise<void>;
  onCancel: () => void;
}

export default function SimplifiedFlightForm({
  onSubmit,
  onCancel,
}: SimplifiedFlightFormProps): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoFillMessage, setAutoFillMessage] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Required fields
  const [departure, setDeparture] = useState<Airport | null>(null);
  const [arrival, setArrival] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState("");
  const [departureTime, setDepartureTime] = useState("12:00");

  // Optional fields (advanced)
  const [airline, setAirline] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [aircraft, setAircraft] = useState("");
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("14:00");
  const [status, setStatus] = useState<"scheduled" | "flown" | "cancelled" | "historical">("flown");
  const [historical, setHistorical] = useState(false);
  const [notes, setNotes] = useState("");
  const [price, setPrice] = useState<string>("");
  const [taxes, setTaxes] = useState<string>("");
  const [fees, setFees] = useState<string>("");
  const [currency, setCurrency] = useState<"EUR" | "USD" | "GBP" | "CHF">("EUR");
  const [category, setCategory] = useState<"business" | "private" | "vacation">("business");
  const [tagInput, setTagInput] = useState("");
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
    const today = new Date().toISOString().split("T")[0];
    setDepartureDate(today);
    setArrivalDate(today);
  }, []);

  // Auto-calculate arrival time (2 hours after departure)
  useEffect(() => {
    if (departureDate && departureTime && !arrivalDate) {
      const depDateTime = new Date(`${departureDate}T${departureTime}`);
      depDateTime.setHours(depDateTime.getHours() + 2);

      setArrivalDate(depDateTime.toISOString().split("T")[0]);
      setArrivalTime(depDateTime.toTimeString().slice(0, 5));
    }
  }, [departureDate, departureTime, arrivalDate]);

  // Auto-set status based on date (skip when historical is active)
  useEffect(() => {
    if (historical) return;
    if (departureDate) {
      const depDate = new Date(departureDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (depDate < today) {
        setStatus("flown");
      } else {
        setStatus("scheduled");
      }
    }
  }, [departureDate, historical]);

  const applyLookupData = (lookup: FlightLookupResult) => {
    if (!lookup) return;

    if (lookup.airline) setAirline(lookup.airline);
    if (lookup.flightNumber) setFlightNumber(lookup.flightNumber);
    if (lookup.aircraft) setAircraft((prev) => prev || lookup.aircraft || "");

    if (lookup.departure) setDeparture(lookup.departure as Airport);
    if (lookup.arrival) setArrival(lookup.arrival as Airport);

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
      setDate(parsed.toISOString().split("T")[0]);
      setTime(parsed.toTimeString().slice(0, 5));
    };

    updateDateTime(lookup.departureTime, setDepartureDate, setDepartureTime);
    updateDateTime(lookup.arrivalTime, setArrivalDate, setArrivalTime);
  };

  useEffect(() => {
    const normalizedFlightNumber = flightNumber.trim();
    if (!normalizedFlightNumber) {
      setAutoFillMessage("");
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setAutoFillMessage(t("flights:form.simplified.lookupSearching"));
      try {
        const lookup = await flightsApi.lookup({
          flightNumber: normalizedFlightNumber,
          date: departureDate || undefined,
        });

        if (cancelled || !lookup) return;

        applyLookupData(lookup);
        setShowAdvanced(true);
        setAutoFillMessage(t("flights:form.simplified.lookupSuccess"));
      } catch (lookupError) {
        if (!cancelled) {
          logger.warn("Flight lookup failed", lookupError);
          setAutoFillMessage("");
        }
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flightNumber, departureDate]);

  const handleBoardingPassScan = async (scanData: ScanResultData): Promise<void> => {
    setShowScanner(false);
    setError("");

    const depCode = scanData.departureCode || "";
    const arrCode = scanData.arrivalCode || "";

    try {
      // Lookup airports by IATA code using getByCode API
      let depAirport: Airport | undefined;
      let arrAirport: Airport | undefined;

      try {
        const [dep, arr] = await Promise.all([
          airportsApi.getByCode(depCode),
          airportsApi.getByCode(arrCode),
        ]);

        depAirport = dep;
        arrAirport = arr;
      } catch {
        // If airports not found even with external lookup, create placeholder objects
        logger.warn("Airports not found anywhere, using IATA codes directly");
        depAirport = {
          id: 0,
          iata: depCode,
          name: depCode,
          lat: 0,
          lon: 0,
        };
        arrAirport = {
          id: 0,
          iata: arrCode,
          name: arrCode,
          lat: 0,
          lon: 0,
        };

        // Show warning to user
        setError(
          t("flights:form.simplified.airportsNotFoundManual", { dep: depCode, arr: arrCode })
        );
      }

      // Set airports
      setDeparture(depAirport ?? null);
      setArrival(arrAirport ?? null);

      // Set date from departureTime if available
      if (scanData.departureTime) {
        const dateStr = scanData.departureTime.split("T")[0];
        setDepartureDate(dateStr);
        setArrivalDate(dateStr);
      }

      // Set airline and flight number
      if (scanData.airline) {
        setAirline(scanData.airline);
      }
      if (scanData.flightNumber) {
        setFlightNumber(scanData.flightNumber);
      }

      // Set status to flown (since user has boarding pass)
      setStatus("flown");

      // Show advanced options since we have flight details
      setShowAdvanced(true);

      // Show success message
      setError("");
    } catch {
      setError(t("flights:form.simplified.airportDataNotFound", { dep: depCode, arr: arrCode }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!departure || !arrival) {
      setError(t("flights:form.validation.selectAirports"));
      return;
    }

    if (!historical && !departureDate) {
      setError(t("flights:form.validation.selectDate"));
      return;
    }

    const priceNum = price ? Number(price) : undefined;
    const taxesNum = taxes ? Number(taxes) : undefined;
    const feesNum = fees ? Number(fees) : undefined;

    if (priceNum !== undefined && (isNaN(priceNum) || priceNum < 0)) {
      setError(t("flights:form.validation.invalidPrice"));
      return;
    }
    if (taxesNum !== undefined && (isNaN(taxesNum) || taxesNum < 0)) {
      setError(t("flights:form.validation.invalidPrice"));
      return;
    }
    if (feesNum !== undefined && (isNaN(feesNum) || feesNum < 0)) {
      setError(t("flights:form.validation.invalidPrice"));
      return;
    }

    setLoading(true);

    try {
      // Convert local times to ISO strings (properly handles timezone conversion)
      // Note: This treats input times as local browser time and converts to UTC
      const departureDateTime = departureDate
        ? new Date(`${departureDate}T${departureTime || "00:00"}:00`).toISOString()
        : undefined;
      const arrivalDateTime =
        arrivalDate || departureDate
          ? new Date(`${arrivalDate || departureDate}T${arrivalTime || "00:00"}:00`).toISOString()
          : undefined;

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
        status: historical ? "historical" : status,
        notes: notes || undefined,
        price: priceNum,
        taxes: taxesNum,
        fees: feesNum,
        currency,
        category,
        tags: tags.length ? tags : undefined,
      });
    } catch (err: unknown) {
      const errorObj = err as { response?: { data?: { error?: string } } };
      setError(errorObj.response?.data?.error ?? t("flights:form.simplified.failedToSave"));
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = () => {
    const clean = tagInput.trim();
    if (!clean || tags.includes(clean)) return;
    setTags([...tags, clean]);
    setTagInput("");
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-surface)] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--bg-surface)] border-b px-6 py-4">
          <h2 className="text-2xl font-bold">✈️ {t("flights:form.title")}</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {t("flights:form.simplified.subtitle")}
          </p>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Boarding Pass Scanner Button */}
          <div className="border border-[var(--color-border)] bg-[var(--bg-elevated)] rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">🎫 {t("flights:form.boardingPass.title")}</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  {t("flights:form.boardingPass.description")}
                </p>
              </div>
              <button type="button" onClick={() => setShowScanner(true)} className="btn-primary">
                📸 {t("flights:form.boardingPass.scan")}
              </button>
            </div>
          </div>

          {/* Quick Add Section */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">
              {t("flights:form.simplified.orEnterManually")}
            </h3>

            {/* Airports */}
            <div className="grid grid-cols-2 gap-4">
              <AirportAutocomplete
                value={departure}
                onChange={setDeparture}
                label={t("flights:list.from")}
                placeholder={t("flights:form.placeholders.departureAirport")}
                required
              />
              <AirportAutocomplete
                value={arrival}
                onChange={setArrival}
                label={t("flights:list.to")}
                placeholder={t("flights:form.placeholders.arrivalAirport")}
                required
              />
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t("flights:form.departureDate")}</label>
                <input
                  type="date"
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">{t("flights:form.departureTime")}</label>
                <input
                  type="time"
                  value={departureTime}
                  onChange={(e) => setDepartureTime(e.target.value)}
                  className="input"
                />
              </div>
            </div>

            {/* Historical flight checkbox */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={historical}
                  onChange={(e) => {
                    setHistorical(e.target.checked);
                    if (e.target.checked) setStatus("historical");
                    else {
                      if (departureDate && new Date(departureDate) < new Date()) setStatus("flown");
                      else setStatus("scheduled");
                    }
                  }}
                  className="rounded"
                />
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {t("flights:historicalCheckbox")}
                </span>
              </label>
              {historical && (
                <p className="text-xs mt-1 ml-6" style={{ color: "var(--text-muted)" }}>
                  {t("flights:historicalHint")}
                </p>
              )}
            </div>

            {/* Status */}
            <div>
              <label className="label">{t("flights:form.status")}</label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "scheduled" | "flown" | "cancelled" | "historical")
                }
                className="input"
              >
                <option value="flown">{t("flights:status.flown")} ✓</option>
                <option value="scheduled">{t("flights:status.scheduled")}</option>
                <option value="cancelled">{t("flights:status.cancelled")}</option>
                <option value="historical">{t("flights:status.historical")}</option>
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
              <span>{showAdvanced ? "▼" : "▶"}</span>
              {t("flights:form.simplified.advancedOptions")}
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-6">
                {/* Flight Details */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t("flights:form.airline")}</label>
                    <input
                      type="text"
                      value={airline}
                      onChange={(e) => setAirline(e.target.value)}
                      className="input"
                      placeholder={t("flights:form.placeholders.airline")}
                    />
                  </div>
                  <div>
                    <label className="label">{t("flights:form.flightNumber")}</label>
                    <input
                      type="text"
                      value={flightNumber}
                      onChange={(e) => setFlightNumber(e.target.value)}
                      className="input"
                      placeholder={t("flights:form.placeholders.flightNumber")}
                    />
                    {autoFillMessage && (
                      <p className="text-xs text-blue-600 mt-1">{autoFillMessage}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="label">{t("flights:form.aircraft")}</label>
                  <input
                    type="text"
                    value={aircraft}
                    onChange={(e) => setAircraft(e.target.value)}
                    className="input"
                    placeholder={t("flights:form.placeholders.aircraft")}
                  />
                </div>

                {/* Arrival Date/Time Override */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t("flights:form.arrivalDate")}</label>
                    <input
                      type="date"
                      value={arrivalDate}
                      onChange={(e) => setArrivalDate(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">{t("flights:form.arrivalTime")}</label>
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
                    <label className="label">{t("flights:form.price")}</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="input"
                        placeholder={t("flights:form.placeholders.price")}
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
                    <label className="label">{t("flights:form.category")}</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as typeof category)}
                      className="input"
                    >
                      <option value="business">{t("flights:category.business")}</option>
                      <option value="private">{t("flights:category.private")}</option>
                      <option value="vacation">{t("flights:category.vacation")}</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t("flights:form.taxes")}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={taxes}
                      onChange={(e) => setTaxes(e.target.value)}
                      className="input"
                      placeholder={t("flights:form.placeholders.optional")}
                    />
                  </div>
                  <div>
                    <label className="label">{t("flights:form.fees")}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={fees}
                      onChange={(e) => setFees(e.target.value)}
                      className="input"
                      placeholder={t("flights:form.placeholders.optional")}
                    />
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <label className="label">{t("flights:form.tags")}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      className="input"
                      placeholder={t("flights:form.placeholders.tags")}
                    />
                    <button
                      type="button"
                      onClick={handleAddTag}
                      className="btn-secondary whitespace-nowrap"
                    >
                      {t("flights:form.simplified.addTag")}
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
                  <label className="label">{t("flights:form.notes")}</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="input"
                    rows={2}
                    placeholder={t("flights:form.placeholders.notes")}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            <button type="button" onClick={onCancel} className="btn-secondary" disabled={loading}>
              {t("flights:form.cancel")}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !departure || !arrival || (!historical && !departureDate)}
            >
              {loading ? t("flights:form.saving") : `✓ ${t("flights:form.submit")}`}
            </button>
          </div>
        </form>

        {/* Helper Text */}
        <div className="px-6 pb-4 text-sm text-[var(--text-muted)] border-t pt-4">
          💡 {t("flights:form.simplified.proTip")}
        </div>
      </div>

      {/* Boarding Pass Scanner Modal */}
      {showScanner && (
        <Suspense
          fallback={
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-[var(--bg-surface)] rounded-lg p-8">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto mb-2"></div>
                  <p className="text-[var(--text-muted)]">{t("flights:form.loadingScanner")}</p>
                </div>
              </div>
            </div>
          }
        >
          <BoardingPassScanner
            onScanSuccess={handleBoardingPassScan}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
