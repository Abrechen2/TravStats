import { useState, useEffect, useRef } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { Flight, Trip } from "../types";
import ReceiptUpload from "./ReceiptUpload";
import CopyActionButton from "./FlightForm/CopyActionButton";
import CompanionPicker from "./CompanionPicker";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import { useSuggestions } from "../hooks/useSuggestions";
import { useToastStore } from "../store/toastStore";
import { estimateArrivalFromDeparture } from "../lib/timeEstimation";
import { airportsApi } from "../lib/api/airports";
import { tripsApi } from "../lib/api/trips";
import { logger } from "../lib/logger";
import CurrencyInput from "./CurrencyInput";

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
  // Format as YYYY-MM-DDTHH:MM for datetime-local input (browser-local). Used
  // only as the initial seed before the airport timezones resolve — see the
  // hydration effect, which re-renders these fields as airport-local.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format a UTC instant as a `YYYY-MM-DDTHH:MM` datetime-local value in the
 *  given IANA timezone (the departure/arrival airport's zone). */
function utcToZonedInput(iso: string | null, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm");
}

export default function FlightEditModal({
  flight,
  isOpen,
  onClose,
  onSave,
}: FlightEditModalProps): JSX.Element | null {
  const { t, i18n } = useTranslation(["flights", "common", "errors"]);
  const { features, display } = useSettingsStore();
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
    companions: f.companions ?? [],
    price: f.price || 0,
    currency: f.currency || "EUR",
    taxes: f.taxes || 0,
    fees: f.fees || 0,
    notes: f.notes || "",
    tags: f.tags?.join(", ") || "",
    receiptUrl: f.receiptUrl || "",
    departureTime: toLocalDatetime(f.departureTime),
    arrivalTime: toLocalDatetime(f.arrivalTime),
    tripId: f.tripId ?? "",
  });

  const [formData, setFormData] = useState(buildFormData(flight));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const addToast = useToastStore((s) => s.addToast);

  // Airport timezones for the departure/arrival fields. The datetime-local
  // inputs are seeded browser-local by buildFormData, then re-rendered as
  // airport-local once these resolve (see the hydration effect). `hydratedRef`
  // tracks whether the inputs currently hold airport-local values, so submit
  // pairs them with the matching timezone basis (no-op edits round-trip
  // losslessly instead of drifting when browser tz != airport tz).
  const userTz = display?.timezone || "UTC";
  const [depTz, setDepTz] = useState<string>(userTz);
  const [arrTz, setArrTz] = useState<string>(userTz);
  const hydratedRef = useRef(false);

  // Load trips for the picker. Failures are non-fatal: if the list fails
  // we just hide the picker rather than blocking the whole edit modal,
  // so the user can still update other flight fields.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    tripsApi
      .getAll()
      .then((all) => {
        if (!cancelled) setTrips(all);
      })
      .catch((err) => {
        logger.warn("Failed to load trips for FlightEditModal:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

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
    hydratedRef.current = false;
  }, [flight]);

  // Resolve airport timezones on open, then re-render the time inputs as
  // airport-local. The submit contract and the arrival estimate already treat
  // these fields as airport-local, so this makes the whole modal consistent
  // and fixes the open->save no-op drift. Applied once per flight (guarded by
  // hydratedRef) so it never clobbers a user edit.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      const depCode = flight.depIata || flight.depIcao;
      const arrCode = flight.arrIata || flight.arrIcao;
      const [depAirport, arrAirport] = await Promise.all([
        depCode ? airportsApi.getByCode(depCode).catch(() => null) : Promise.resolve(null),
        arrCode ? airportsApi.getByCode(arrCode).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled || hydratedRef.current) return;
      const dTz = depAirport?.timezone || userTz;
      const aTz = arrAirport?.timezone || userTz;
      setDepTz(dTz);
      setArrTz(aTz);
      setFormData((prev) => ({
        ...prev,
        departureTime: utcToZonedInput(flight.departureTime, dTz),
        arrivalTime: utcToZonedInput(flight.arrivalTime, aTz),
      }));
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, flight, userTz]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Pair each wall-clock with the timezone its input was rendered against,
      // for the canonical-UTC submit contract. Once hydrated the inputs are
      // airport-local (depTz/arrTz); before that they still hold the
      // browser-local seed, so fall back to the actual browser timezone — that
      // way a no-op save reproduces the exact same UTC instant either way.
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || userTz;
      const submitDepTz = hydratedRef.current ? depTz : browserTz;
      const submitArrTz = hydratedRef.current ? arrTz : browserTz;

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
        companions: formData.companions,
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
        depTimezone: formData.departureTime ? submitDepTz : undefined,
        arrivalLocal: formData.arrivalTime || undefined,
        arrTimezone: formData.arrivalTime ? submitArrTz : undefined,
      };

      await onSave(flight.id, updates);

      // Trip assignment lives on a separate endpoint (POST /trips/:id/flights)
      // because Flight.tripId is owned by the Trip relation, not by the
      // generic flight-update path. Apply it after onSave succeeds so a
      // failed field-save doesn't silently move the flight between trips.
      const previousTripId = flight.tripId ?? "";
      const nextTripId = formData.tripId;
      if (nextTripId !== previousTripId) {
        try {
          if (nextTripId) {
            // Add to new trip — backend uses updateMany so this also
            // moves the flight away from any prior trip atomically.
            await tripsApi.assignFlights(nextTripId, {
              flightIds: [flight.id],
              action: "add",
            });
          } else if (previousTripId) {
            // Cleared selection — detach from current trip.
            await tripsApi.assignFlights(previousTripId, {
              flightIds: [flight.id],
              action: "remove",
            });
          }
          addToast("success", t("flights:edit.tripAssignedToast"));
        } catch (tripErr) {
          logger.warn("Failed to update trip assignment:", tripErr);
          setError(t("flights:edit.tripAssignFailed"));
          return; // keep modal open so user sees the partial state
        }
      }

      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errors:updateFailed"));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-100 p-4">
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
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-sm">
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
              <div>
                <span
                  className="px-2 py-1 text-xs font-semibold rounded-full inline-block"
                  style={
                    formData.status === "flown"
                      ? {
                          background: "rgba(63,185,80,0.15)",
                          color: "var(--success)",
                        }
                      : formData.status === "scheduled"
                        ? {
                            background: "rgba(56,139,253,0.15)",
                            color: "#388bfd",
                          }
                        : formData.status === "historical" || formData.status === "duplicated"
                          ? {
                              // historical/duplicated are archival data, not an
                              // error state — amber matches the cruise pill
                              // palette (cruiseStatusStyle.ts) instead of red.
                              background: "rgba(251,191,36,0.15)",
                              color: "#fbbf24",
                            }
                          : {
                              background: "rgba(248,81,73,0.15)",
                              color: "var(--danger)",
                            }
                  }
                >
                  {t(`flights:status.${formData.status}`, { defaultValue: formData.status })}
                </span>
              </div>
              <label className="flex items-center gap-2 text-sm mt-2">
                <input
                  type="checkbox"
                  checked={formData.status === "cancelled"}
                  onChange={(e) => update("status", e.target.checked ? "cancelled" : "scheduled")}
                />
                {t("flights:status.cancelledCheckbox")}
              </label>
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
              <label className="label">{t("flights:edit.tripLabel")}</label>
              <select
                value={formData.tripId}
                onChange={(e) => update("tripId", e.target.value)}
                className="input"
              >
                <option value="">{t("flights:edit.tripNone")}</option>
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}
                  </option>
                ))}
              </select>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {t("flights:edit.tripHint")}
              </p>
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
            <CompanionPicker
              value={formData.companions}
              onChange={(v) => update("companions", v)}
            />
          </div>

          {/* Price & Currency — always available, matching the cruise editor
              (#192). Only the tax/fee breakdown stays behind cost tracking. */}
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
              <CurrencyInput
                value={formData.currency || "EUR"}
                onChange={(v) => update("currency", v)}
                className="input"
              />
            </div>
          </div>

          {/* Tax/fee breakdown (feature-gated) */}
          {features.enableCostTracking && (
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
