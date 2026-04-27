import { useState, useEffect } from "react";
import type { Flight } from "../types";
import ReceiptUpload from "./ReceiptUpload";
import CopyActionButton from "./FlightForm/CopyActionButton";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import { useSuggestions } from "../hooks/useSuggestions";
import { useToastStore } from "../store/toastStore";
import { estimateArrivalFromDeparture } from "../lib/timeEstimation";
import { airportsApi } from "../lib/api/airports";
import { logger } from "../lib/logger";

import type { FlightInput } from "../types";

interface FlightEditModalProps {
  flight: Flight;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<FlightInput>) => Promise<void>;
}

function toLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Format as YYYY-MM-DDTHH:MM for datetime-local input (local timezone)
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FlightEditModal({
  flight,
  isOpen,
  onClose,
  onSave,
}: FlightEditModalProps): JSX.Element | null {
  const { t, i18n } = useTranslation(["flights", "common", "errors"]);
  const { features } = useSettingsStore();
  const { airlines: airlineSuggestions, aircraft: aircraftSuggestions } = useSuggestions();

  const buildFormData = (f: Flight) => ({
    airline: f.airline || "",
    operatingAirline: f.operatingAirline || "",
    flightNumber: f.flightNumber || "",
    aircraft: f.aircraft || "",
    status: f.status || "scheduled",
    category: f.category || "",
    seatClass: f.seatClass || "",
    seatNumber: f.seatNumber || "",
    gate: f.gate || "",
    terminal: f.terminal || "",
    boardingGroup: f.boardingGroup || "",
    bookingReference: f.bookingReference || "",
    ticketNumber: f.ticketNumber || "",
    companions: f.companions?.join(", ") || "",
    price: f.price || 0,
    currency: f.currency || "EUR",
    taxes: f.taxes || 0,
    fees: f.fees || 0,
    notes: f.notes || "",
    tags: f.tags?.join(", ") || "",
    receiptUrl: f.receiptUrl || "",
    departureTime: toLocalDatetime(f.departureTime),
    arrivalTime: toLocalDatetime(f.arrivalTime),
  });

  const [formData, setFormData] = useState(buildFormData(flight));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const addToast = useToastStore((s) => s.addToast);

  const update = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  /** Copy the date part of departureTime into arrivalTime while preserving
   *  arrivalTime's existing HH:MM. */
  const handleCopyDepartureDate = (): void => {
    if (!formData.departureTime) return;
    const depDate = formData.departureTime.split("T")[0];
    const arrTimePart = formData.arrivalTime.includes("T")
      ? formData.arrivalTime.split("T")[1]
      : "12:00";
    update("arrivalTime", `${depDate}T${arrTimePart}`);
  };

  const canEstimateArrival = Boolean(formData.departureTime && formData.status !== "historical");

  const handleEstimateArrival = async (): Promise<void> => {
    if (!formData.departureTime) return;
    const [depDate, depTime] = formData.departureTime.split("T");
    if (!depDate || !depTime) return;

    // Fetch timezones for both airports (lat/lon come from the flight record).
    let depTz: string | null = null;
    let arrTz: string | null = null;
    try {
      const depCode = flight.depIata || flight.depIcao;
      const arrCode = flight.arrIata || flight.arrIcao;
      const [depAirport, arrAirport] = await Promise.all([
        depCode ? airportsApi.getByCode(depCode).catch(() => null) : Promise.resolve(null),
        arrCode ? airportsApi.getByCode(arrCode).catch(() => null) : Promise.resolve(null),
      ]);
      depTz = depAirport?.timezone ?? null;
      arrTz = arrAirport?.timezone ?? null;
    } catch (err) {
      logger.warn("Failed to fetch airport timezones for arrival estimate:", err);
    }

    const result = estimateArrivalFromDeparture({
      departureDate: depDate,
      departureTime: depTime.slice(0, 5),
      departureLat: flight.depLat,
      departureLon: flight.depLon,
      departureTimezone: depTz,
      arrivalLat: flight.arrLat,
      arrivalLon: flight.arrLon,
      arrivalTimezone: arrTz,
    });

    update("arrivalTime", `${result.arrivalDate}T${result.arrivalTime}`);
    if (!result.tzAware) {
      addToast("warning", t("flights:form.estimateTzUnknown"));
    }
  };

  /** "+N day" hint below the arrival datetime-local field. */
  const arrivalDayOffsetEdit = (() => {
    if (formData.status === "historical") return 0;
    if (!formData.departureTime || !formData.arrivalTime) return 0;
    const depDate = formData.departureTime.split("T")[0];
    const arrDate = formData.arrivalTime.split("T")[0];
    if (!depDate || !arrDate || arrDate <= depDate) return 0;
    const [dy, dm, dd] = depDate.split("-").map(Number);
    const [ay, am, ad] = arrDate.split("-").map(Number);
    const from = Date.UTC(dy, dm - 1, dd);
    const to = Date.UTC(ay, am - 1, ad);
    return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
  })();

  useEffect(() => {
    setFormData(buildFormData(flight));
    setError("");
  }, [flight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Resolve the airport timezones for the canonical-UTC submit contract.
      // Falls back to the user's display timezone if the airport record has no
      // IANA name.
      const userTz = useSettingsStore.getState().display?.timezone || "UTC";
      const depCode = flight.depIata || flight.depIcao;
      const arrCode = flight.arrIata || flight.arrIcao;
      const [depAirport, arrAirport] = await Promise.all([
        depCode ? airportsApi.getByCode(depCode).catch(() => null) : Promise.resolve(null),
        arrCode ? airportsApi.getByCode(arrCode).catch(() => null) : Promise.resolve(null),
      ]);
      const depTz = depAirport?.timezone || userTz;
      const arrTz = arrAirport?.timezone || userTz;

      const updates: Partial<FlightInput> = {
        airline: formData.airline || undefined,
        operatingAirline: formData.operatingAirline || undefined,
        flightNumber: formData.flightNumber || undefined,
        aircraft: formData.aircraft || undefined,
        status: formData.status as FlightInput["status"],
        category: (formData.category || undefined) as FlightInput["category"],
        seatClass: (formData.seatClass || undefined) as FlightInput["seatClass"],
        seatNumber: formData.seatNumber || undefined,
        gate: formData.gate || undefined,
        terminal: formData.terminal || undefined,
        boardingGroup: formData.boardingGroup || undefined,
        bookingReference: formData.bookingReference || undefined,
        ticketNumber: formData.ticketNumber || undefined,
        companions: formData.companions
          ? formData.companions
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean)
          : [],
        price: formData.price > 0 ? formData.price : undefined,
        currency: formData.currency as FlightInput["currency"],
        taxes: formData.taxes > 0 ? formData.taxes : undefined,
        fees: formData.fees > 0 ? formData.fees : undefined,
        notes: formData.notes || undefined,
        tags: formData.tags
          ? formData.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
        receiptUrl: formData.receiptUrl || undefined,
        departureLocal: formData.departureTime || undefined,
        depTimezone: formData.departureTime ? depTz : undefined,
        arrivalLocal: formData.arrivalTime || undefined,
        arrTimezone: formData.arrivalTime ? arrTz : undefined,
      };

      await onSave(flight.id, updates);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errors:updateFailed"));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
      <div
        className="rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--bg-surface)" }}
      >
        <div
          className="sticky top-0 px-6 py-4"
          style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
              {t("flights:edit.title")}
            </h2>
            <button
              onClick={onClose}
              className="transition-colors"
              style={{ color: "var(--text-muted)" }}
              aria-label={t("common:buttons.close")}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {flight.depIata || flight.depIcao} {t("common:labels.routeSeparator")}{" "}
            {flight.arrIata || flight.arrIcao}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Date & Time — year/month for historical, full datetime for others */}
          {formData.status === "historical" ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t("flights:historicalYear")}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  placeholder={t("flights:historicalYearPlaceholder")}
                  value={
                    formData.departureTime ? new Date(formData.departureTime).getFullYear() : ""
                  }
                  onChange={(e) => {
                    const y = e.target.value.replace(/\D/g, "").slice(0, 4);
                    if (!y) {
                      update("departureTime", "");
                      return;
                    }
                    const currentMonth = formData.departureTime
                      ? String(new Date(formData.departureTime).getMonth() + 1).padStart(2, "0")
                      : "01";
                    const iso = new Date(`${y}-${currentMonth}-01T00:00:00`).toISOString();
                    setFormData({
                      ...formData,
                      departureTime: toLocalDatetime(iso),
                      arrivalTime: toLocalDatetime(iso),
                    });
                  }}
                  className="input"
                />
              </div>
              <div>
                <label className="label">{t("flights:historicalMonth")}</label>
                <select
                  value={
                    formData.departureTime
                      ? String(new Date(formData.departureTime).getMonth() + 1)
                      : ""
                  }
                  onChange={(e) => {
                    const m = e.target.value;
                    const y = formData.departureTime
                      ? new Date(formData.departureTime).getFullYear()
                      : new Date().getFullYear();
                    if (!m) {
                      const iso = new Date(`${y}-01-01T00:00:00`).toISOString();
                      setFormData({
                        ...formData,
                        departureTime: toLocalDatetime(iso),
                        arrivalTime: toLocalDatetime(iso),
                      });
                    } else {
                      const iso = new Date(`${y}-${m.padStart(2, "0")}-01T00:00:00`).toISOString();
                      setFormData({
                        ...formData,
                        departureTime: toLocalDatetime(iso),
                        arrivalTime: toLocalDatetime(iso),
                      });
                    }
                  }}
                  className="input"
                >
                  <option value="">{t("flights:historicalMonthNone")}</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {new Date(2000, i).toLocaleDateString(i18n.language, { month: "long" })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="editDepartureTime">
                  {t("flights:form.departure")}
                </label>
                <input
                  id="editDepartureTime"
                  type="datetime-local"
                  className="input"
                  value={formData.departureTime}
                  onChange={(e) => update("departureTime", e.target.value)}
                />
              </div>
              <div>
                <label className="label flex items-center gap-2" htmlFor="editArrivalTime">
                  {t("flights:form.arrival")}
                  <CopyActionButton
                    icon="arrow-down"
                    title={t("flights:form.copyDepartureDate")}
                    disabled={!formData.departureTime}
                    onClick={handleCopyDepartureDate}
                  />
                  <CopyActionButton
                    icon="calculator"
                    title={
                      canEstimateArrival
                        ? t("flights:form.estimateArrivalTime")
                        : t("flights:form.estimateNoDepartureTime")
                    }
                    disabled={!canEstimateArrival}
                    onClick={() => void handleEstimateArrival()}
                  />
                </label>
                <input
                  id="editArrivalTime"
                  type="datetime-local"
                  className="input"
                  value={formData.arrivalTime}
                  onChange={(e) => update("arrivalTime", e.target.value)}
                />
                {arrivalDayOffsetEdit > 0 && (
                  <p className="text-xs mt-1 text-blue-700 dark:text-blue-300">
                    {arrivalDayOffsetEdit === 1
                      ? t("flights:form.arrivalNextDay")
                      : t("flights:form.arrivalDayOffset", { count: arrivalDayOffsetEdit })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Airline / Operating / FlightNo */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">{t("flights:form.airline")}</label>
              <input
                type="text"
                value={formData.airline}
                onChange={(e) => update("airline", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.airline")}
                list="airline-suggestions-edit"
              />
              <datalist id="airline-suggestions-edit">
                {airlineSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="label">{t("flights:form.operatingAirline")}</label>
              <input
                type="text"
                value={formData.operatingAirline}
                onChange={(e) => update("operatingAirline", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.operatingAirline")}
                list="operating-airline-suggestions-edit"
              />
              <datalist id="operating-airline-suggestions-edit">
                {airlineSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="label">{t("flights:form.flightNumber")}</label>
              <input
                type="text"
                value={formData.flightNumber}
                onChange={(e) => update("flightNumber", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.flightNumber")}
              />
            </div>
          </div>

          {/* Aircraft */}
          <div>
            <label className="label">{t("flights:form.aircraft")}</label>
            <input
              type="text"
              value={formData.aircraft}
              onChange={(e) => update("aircraft", e.target.value)}
              className="input"
              placeholder={t("flights:form.placeholders.aircraft")}
              list="aircraft-suggestions-edit"
            />
            <datalist id="aircraft-suggestions-edit">
              {aircraftSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          {/* Status / Category / Seat Class */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">{t("flights:form.status")}</label>
              <select
                value={formData.status}
                onChange={(e) => {
                  const newStatus = e.target.value as Flight["status"];
                  if (newStatus === "historical") {
                    setFormData({
                      ...formData,
                      status: newStatus,
                      departureTime: "",
                      arrivalTime: "",
                    });
                  } else {
                    update("status", newStatus);
                  }
                }}
                className="input"
              >
                <option value="flown">{t("flights:status.flown")}</option>
                <option value="scheduled">{t("flights:status.scheduled")}</option>
                <option value="cancelled">{t("flights:status.cancelled")}</option>
                <option value="historical">{t("flights:status.historical")}</option>
              </select>
            </div>

            <div>
              <label className="label">{t("flights:form.category")}</label>
              <select
                value={formData.category}
                onChange={(e) => update("category", e.target.value)}
                className="input"
              >
                <option value="">{t("common:labels.optional")}</option>
                <option value="business">{t("flights:category.business")}</option>
                <option value="private">{t("flights:category.private")}</option>
                <option value="vacation">{t("flights:category.vacation")}</option>
              </select>
            </div>

            <div>
              <label className="label">{t("flights:form.seatClass")}</label>
              <select
                value={formData.seatClass}
                onChange={(e) => update("seatClass", e.target.value)}
                className="input"
              >
                <option value="">{t("common:labels.optional")}</option>
                <option value="economy">{t("flights:seatClass.economy")}</option>
                <option value="premium_economy">{t("flights:seatClass.premium_economy")}</option>
                <option value="business">{t("flights:seatClass.business")}</option>
                <option value="first">{t("flights:seatClass.first")}</option>
              </select>
            </div>
          </div>

          {/* Seat / Gate / Terminal / Boarding */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="label">{t("flights:form.seat")}</label>
              <input
                type="text"
                value={formData.seatNumber}
                onChange={(e) => update("seatNumber", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.seat")}
              />
            </div>
            <div>
              <label className="label">{t("flights:form.gate")}</label>
              <input
                type="text"
                value={formData.gate}
                onChange={(e) => update("gate", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.gate")}
              />
            </div>
            <div>
              <label className="label">{t("flights:form.terminal")}</label>
              <input
                type="text"
                value={formData.terminal}
                onChange={(e) => update("terminal", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.terminal")}
              />
            </div>
            <div>
              <label className="label">{t("flights:form.boardingGroup")}</label>
              <input
                type="text"
                value={formData.boardingGroup}
                onChange={(e) => update("boardingGroup", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.boardingGroup")}
              />
            </div>
          </div>

          {/* Booking Reference / Ticket Number */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t("flights:form.bookingReference")}</label>
              <input
                type="text"
                value={formData.bookingReference}
                onChange={(e) => update("bookingReference", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.bookingReference")}
              />
            </div>
            <div>
              <label className="label">{t("flights:form.ticketNumber")}</label>
              <input
                type="text"
                value={formData.ticketNumber}
                onChange={(e) => update("ticketNumber", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.ticketNumber")}
              />
            </div>
          </div>

          {/* Companions */}
          <div>
            <label className="label">{t("flights:form.companions")}</label>
            <input
              type="text"
              value={formData.companions}
              onChange={(e) => update("companions", e.target.value)}
              className="input"
              placeholder={t("flights:form.placeholders.companions")}
            />
          </div>

          {/* Cost (feature-gated) */}
          {features.enableCostTracking && (
            <>
              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-2">
                  <label className="label">{t("common:labels.price")}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => update("price", parseFloat(e.target.value) || 0)}
                    className="input"
                    placeholder={t("flights:form.placeholders.price")}
                  />
                </div>

                <div>
                  <label className="label">{t("flights:form.currency")}</label>
                  <select
                    value={formData.currency}
                    onChange={(e) =>
                      update("currency", e.target.value as Flight["currency"] & string)
                    }
                    className="input"
                  >
                    <option value="EUR">{t("flights:currency.EUR")}</option>
                    <option value="USD">{t("flights:currency.USD")}</option>
                    <option value="GBP">{t("flights:currency.GBP")}</option>
                    <option value="CHF">{t("flights:currency.CHF")}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t("common:labels.taxes")}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.taxes}
                    onChange={(e) => update("taxes", parseFloat(e.target.value) || 0)}
                    className="input"
                    placeholder={t("flights:form.placeholders.taxes")}
                  />
                </div>

                <div>
                  <label className="label">{t("common:labels.fees")}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.fees}
                    onChange={(e) => update("fees", parseFloat(e.target.value) || 0)}
                    className="input"
                    placeholder={t("flights:form.placeholders.fees")}
                  />
                </div>
              </div>
            </>
          )}

          {/* Tags */}
          <div>
            <label className="label">{t("flights:form.tags")}</label>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) => update("tags", e.target.value)}
              className="input"
              placeholder={t("flights:form.placeholders.tags")}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="label">{t("common:labels.notes")}</label>
            <textarea
              value={formData.notes}
              onChange={(e) => update("notes", e.target.value)}
              className="input"
              rows={3}
              placeholder={t("flights:form.placeholders.notes")}
            />
          </div>

          {/* Receipt Upload */}
          <ReceiptUpload
            currentReceiptUrl={formData.receiptUrl}
            onUploadSuccess={(receiptUrl) => update("receiptUrl", receiptUrl)}
            onDelete={() => update("receiptUrl", "")}
          />

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? t("common:buttons.saving") : t("flights:edit.saveChanges")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={loading}
            >
              {t("common:buttons.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
