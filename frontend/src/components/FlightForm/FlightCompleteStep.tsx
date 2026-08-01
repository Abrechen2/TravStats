import HelpIcon from "../Help/HelpIcon";
import AirportAutocomplete from "../AirportAutocomplete";
import CompanionPicker from "../CompanionPicker";
import TimesFields from "./fields/TimesFields";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import type { Airport } from "../../lib/api";
import { useSuggestions } from "../../hooks/useSuggestions";
import { useToastStore } from "../../store/toastStore";
import { estimateArrivalFromDeparture } from "../../lib/timeEstimation";
import CurrencyInput from "../CurrencyInput";

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

export interface TimeEstimationWarning {
  show: boolean;
  source: "historical" | "heuristic";
  confidence: "high" | "medium" | "low";
  sampleCount?: number;
}

export interface FlightCompleteStepProps {
  // Lookup context
  selectedFlight: FlightLookupResult | null;
  timeEstimationWarning: TimeEstimationWarning | null;
  // Airports
  departure: Airport | null;
  arrival: Airport | null;
  setDeparture: (a: Airport | null) => void;
  setArrival: (a: Airport | null) => void;
  // Date / Time
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  setDepartureDate: (v: string) => void;
  setDepartureTime: (v: string) => void;
  setArrivalDate: (v: string) => void;
  setArrivalTime: (v: string) => void;
  // Flight info
  airline: string;
  operatingAirline: string;
  flightNumber: string;
  aircraft: string;
  terminal: string;
  gate: string;
  seatNumber: string;
  seatClass: "economy" | "premium_economy" | "business" | "first";
  status: "scheduled" | "flown" | "cancelled" | "historical";
  category: "business" | "private" | "vacation";
  setAirline: (v: string) => void;
  setOperatingAirline: (v: string) => void;
  setFlightNumber: (v: string) => void;
  setAircraft: (v: string) => void;
  setTerminal: (v: string) => void;
  setGate: (v: string) => void;
  setSeatNumber: (v: string) => void;
  setSeatClass: (v: "economy" | "premium_economy" | "business" | "first") => void;
  setStatus: (v: "scheduled" | "flown" | "cancelled" | "historical") => void;
  setCategory: (v: "business" | "private" | "vacation") => void;
  // Booking (#197 — same fields the edit modal offers)
  bookingReference: string;
  ticketNumber: string;
  setBookingReference: (v: string) => void;
  setTicketNumber: (v: string) => void;
  // Price
  price: number | undefined;
  /** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …). */
  currency: string;
  setPrice: (v: number | undefined) => void;
  setCurrency: (v: string) => void;
  // Tags & companions
  tags: string[];
  companions: string[];
  setTags: (v: string[]) => void;
  setCompanions: React.Dispatch<React.SetStateAction<string[]>>;
  // Notes
  notes: string;
  setNotes: (v: string) => void;
  // Theme
  textClass: string;
  mutedTextClass: string;
  sizedInputClass: string;
  // Warning dismiss
  setTimeEstimationWarning: (v: TimeEstimationWarning | null) => void;
}

export default function FlightCompleteStep({
  selectedFlight,
  timeEstimationWarning,
  departure,
  arrival,
  setDeparture,
  setArrival,
  departureDate,
  departureTime,
  arrivalDate,
  arrivalTime,
  setDepartureDate,
  setDepartureTime,
  setArrivalDate,
  setArrivalTime,
  airline,
  operatingAirline,
  flightNumber,
  aircraft,
  terminal,
  gate,
  seatNumber,
  seatClass,
  status,
  category,
  setAirline,
  setOperatingAirline,
  setFlightNumber,
  setAircraft,
  setTerminal,
  setGate,
  setSeatNumber,
  setSeatClass,
  setStatus,
  setCategory,
  bookingReference,
  ticketNumber,
  setBookingReference,
  setTicketNumber,
  price,
  currency,
  setPrice,
  setCurrency,
  tags,
  companions,
  setTags,
  setCompanions,
  notes,
  setNotes,
  textClass,
  mutedTextClass,
  sizedInputClass,
  setTimeEstimationWarning,
}: FlightCompleteStepProps): JSX.Element {
  const { t, i18n } = useTranslation(["flights"]);
  // Debounced-search the live airline catalogue as the user types (#Task 26) —
  // FlightEditModal/FlightReviewModal still call useSuggestions() unfiltered.
  const { airlines: airlineSuggestions, aircraft: aircraftSuggestions } = useSuggestions(airline);
  const addToast = useToastStore((s) => s.addToast);

  const canEstimateArrival = Boolean(
    departure && arrival && departureDate && departureTime && status !== "historical"
  );

  const handleEstimateArrival = (): void => {
    if (!departure || !arrival || !departureDate || !departureTime) return;
    const result = estimateArrivalFromDeparture({
      departureDate,
      departureTime,
      departureLat: departure.lat,
      departureLon: departure.lon,
      departureTimezone: departure.timezone,
      arrivalLat: arrival.lat,
      arrivalLon: arrival.lon,
      arrivalTimezone: arrival.timezone,
    });
    setArrivalDate(result.arrivalDate);
    setArrivalTime(result.arrivalTime);
    if (!result.tzAware) {
      addToast("warning", t("flights:form.estimateTzUnknown"));
    }
  };

  return (
    <div className="space-y-6">
      {/* Flight Details (if from lookup) */}
      {selectedFlight && (
        <div className="p-4 rounded-lg bg-green-900 border border-green-700">
          <div className="text-sm font-medium text-green-200">
            {t("flights:form.lookupLoaded", {
              airline: selectedFlight.airline,
              flightNumber: selectedFlight.flightNumber,
            })}
          </div>
        </div>
      )}

      {/* Time Estimation Warning (hidden for historical flights) */}
      {timeEstimationWarning?.show && status !== "historical" && (
        <div className="p-4 rounded-lg bg-yellow-900 border border-yellow-700">
          <div className="font-medium text-yellow-200 flex items-center gap-2">
            {t("flights:form.estimatedTimes")}
          </div>
          <div className="text-sm text-yellow-300 mt-2">
            {timeEstimationWarning.source === "historical" ? (
              <>
                <strong>
                  {t("flights:form.estimatedTimesHistorical", {
                    count: timeEstimationWarning.sampleCount,
                  })}
                </strong>
                <br />
                {t("flights:form.estimatedTimesCalculated")}
              </>
            ) : (
              <>
                <strong>{t("flights:form.estimatedTimesAutomatic")}</strong>
                <br />
                {t("flights:form.estimatedTimesAssumption", {
                  minutes: Math.round(
                    (calculateDistance(
                      departure?.lat || 0,
                      departure?.lon || 0,
                      arrival?.lat || 0,
                      arrival?.lon || 0
                    ) /
                      800) *
                      60 +
                      15
                  ),
                })}
              </>
            )}
          </div>
          <div className="text-sm text-yellow-300 mt-2 font-semibold">
            {t("flights:form.reviewTimes")}
          </div>
          <button
            type="button"
            onClick={() => setTimeEstimationWarning(null)}
            className="text-xs text-yellow-400 hover:text-yellow-300 mt-2 underline"
          >
            {t("flights:form.hideWarning")}
          </button>
        </div>
      )}

      {/* Airports */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={`label ${textClass}`}>{t("flights:form.from")}</label>
            <HelpIcon content={t("flights:form.help.departureAirport")} position="top" />
          </div>
          <AirportAutocomplete
            value={departure}
            onChange={setDeparture}
            label=""
            placeholder={t("flights:form.placeholders.departureAirport")}
            required
          />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={`label ${textClass}`}>{t("flights:form.to")}</label>
            <HelpIcon content={t("flights:form.help.arrivalAirport")} position="top" />
          </div>
          <AirportAutocomplete
            value={arrival}
            onChange={setArrival}
            label=""
            placeholder={t("flights:form.placeholders.arrivalAirport")}
            required
          />
        </div>
      </div>

      {/* Historical flight checkbox */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={status === "historical"}
            onChange={(e) => {
              if (e.target.checked) {
                setStatus("historical");
                setTimeEstimationWarning(null);
              } else {
                if (departureDate && new Date(departureDate) < new Date()) setStatus("flown");
                else setStatus("scheduled");
              }
            }}
            className="rounded-sm"
          />
          <span className={`text-sm ${textClass}`}>{t("flights:historicalCheckbox")}</span>
        </label>
        {status === "historical" && (
          <p className={`text-xs mt-1 ml-6 ${mutedTextClass}`}>{t("flights:historicalHint")}</p>
        )}
      </div>

      {/* Date & Time — full inputs for normal flights, year/month for historical */}
      {status === "historical" ? (
        (() => {
          // Four valid storage shapes, in order of completeness:
          //   ""           -> nothing entered yet
          //   "YYYY"       -> year known, month unknown
          //   "YYYY-MM"    -> year + month known, day unknown (NEW)
          //   "YYYY-MM-DD" -> year + month + real day known
          // The legacy "YYYY-MM-01" shape is read as year+month+day=1 and
          // will display Day=1 in the new UI, which is honest about the data.
          const yearMatch = departureDate.match(/^(\d{1,4})/);
          const monthMatch = departureDate.match(/^\d{4}-(\d{2})/);
          const dayMatch = departureDate.match(/^\d{4}-\d{2}-(\d{2})$/);
          const yearStr = yearMatch?.[1] ?? "";
          const monthPadded = monthMatch?.[1] ?? "";
          const monthValue = monthPadded ? String(parseInt(monthPadded, 10)) : "";
          const dayPadded = dayMatch?.[1] ?? "";
          const dayValue = dayPadded ? String(parseInt(dayPadded, 10)) : "";

          // Returns how many days are in (year, month) where month is 1-12.
          // new Date(year, month, 0) gives the last day of the prior month
          // when month is treated as 1-based (JS idiom).
          const daysInMonth = (year: number, month: number): number =>
            new Date(year, month, 0).getDate();

          const numYear = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
          const numMonth = monthValue ? parseInt(monthValue, 10) : 0;
          const maxDay = numMonth > 0 ? daysInMonth(numYear, numMonth) : 31;

          return (
            <div className="grid gap-4" style={{ gridTemplateColumns: "1.5fr 2fr 1.2fr" }}>
              <div>
                <label className={`label ${textClass}`}>{t("flights:historicalYear")}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  placeholder={t("flights:historicalYearPlaceholder")}
                  value={yearStr}
                  onChange={(e) => {
                    const y = e.target.value.replace(/\D/g, "").slice(0, 4);
                    if (!y) {
                      setDepartureDate("");
                      setArrivalDate("");
                      return;
                    }
                    let next: string;
                    if (!monthPadded) {
                      // No month selected — store year-only
                      next = y;
                    } else if (!dayPadded) {
                      // Month known, no day — store YYYY-MM
                      next = `${y}-${monthPadded}`;
                    } else {
                      // Year + month + day: clamp day to the new month's max
                      const newMax = daysInMonth(parseInt(y, 10), parseInt(monthPadded, 10));
                      const clampedDay = Math.min(parseInt(dayPadded, 10), newMax);
                      next = `${y}-${monthPadded}-${String(clampedDay).padStart(2, "0")}`;
                    }
                    setDepartureDate(next);
                    setArrivalDate(next);
                  }}
                  className={`input ${sizedInputClass}`}
                />
              </div>
              <div>
                <label className={`label ${textClass}`}>{t("flights:historicalMonth")}</label>
                <select
                  value={monthValue}
                  onChange={(e) => {
                    const m = e.target.value;
                    const y = yearStr || String(new Date().getFullYear());
                    let next: string;
                    if (!m) {
                      // Month cleared — drop back to year-only (also clears day)
                      next = yearStr ? yearStr : "";
                    } else if (!dayPadded) {
                      // Month selected, no day — store YYYY-MM (NOT YYYY-MM-01)
                      next = `${y}-${m.padStart(2, "0")}`;
                    } else {
                      // Month changed while day is set — clamp day if needed
                      const newMax = daysInMonth(parseInt(y, 10), parseInt(m, 10));
                      const clampedDay = Math.min(parseInt(dayPadded, 10), newMax);
                      next = `${y}-${m.padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
                    }
                    setDepartureDate(next);
                    setArrivalDate(next);
                  }}
                  className={`input ${sizedInputClass}`}
                >
                  <option value="">{t("flights:historicalMonthNone")}</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {new Date(2000, i).toLocaleDateString(i18n.language, { month: "long" })}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`label ${textClass}`}>{t("flights:historicalDay")}</label>
                <select
                  value={dayValue}
                  disabled={!monthValue}
                  onChange={(e) => {
                    const d = e.target.value;
                    const y = yearStr || String(new Date().getFullYear());
                    const m = monthPadded;
                    let next: string;
                    if (!d) {
                      // Day cleared — transition back to YYYY-MM
                      next = `${y}-${m}`;
                    } else {
                      next = `${y}-${m}-${d.padStart(2, "0")}`;
                    }
                    setDepartureDate(next);
                    setArrivalDate(next);
                  }}
                  className={`input ${sizedInputClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <option value="">{t("flights:historicalDayNone")}</option>
                  {Array.from({ length: maxDay }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })()
      ) : (
        <TimesFields
          value={{
            depDate: departureDate,
            depTime: departureTime,
            arrDate: arrivalDate,
            arrTime: arrivalTime,
          }}
          onChange={(next) => {
            // Create-only extra, kept here rather than inside TimesFields
            // (which the edit form also renders and must not gain this):
            // when the user picks a NEW departure date and the arrival date
            // hasn't caught up yet (empty or still before it), nudge arrival
            // forward with it. `next.arrDate` still equals the pre-change
            // arrival date whenever the user edited the departure date input
            // specifically (TimesFields only touches the field that changed),
            // so comparing it here is equivalent to the pre-swap inline
            // `onChange` that did this same check against `arrivalDate`.
            const depDateChanged = next.depDate !== departureDate;
            const arrivalNeedsToCatchUp = !next.arrDate || next.arrDate < next.depDate;
            setDepartureDate(next.depDate);
            setDepartureTime(next.depTime);
            setArrivalDate(depDateChanged && arrivalNeedsToCatchUp ? next.depDate : next.arrDate);
            setArrivalTime(next.arrTime);
          }}
          onEstimateArrival={handleEstimateArrival}
          canEstimateArrival={canEstimateArrival}
          // Names the actual blocker when the calculator is disabled. Missing
          // airports takes priority over a missing departure time — matches
          // the pre-swap three-way tooltip this create form used to render
          // inline before TimesFields only had the generic "no departure
          // time" message (built for the edit form, which reaches this
          // screen with airports already set).
          estimateDisabledHint={
            !departure || !arrival ? t("flights:form.estimateNoAirports") : undefined
          }
          help={{
            depDate: { content: t("flights:form.help.departureDate") },
            depTime: {
              content: t("flights:form.help.departureTime"),
              expandedContent: t("flights:form.help.departureTimeExpanded"),
            },
            arrDate: { content: t("flights:form.help.arrivalDate") },
            arrTime: {
              content: t("flights:form.help.arrivalTime"),
              expandedContent: t("flights:form.help.arrivalTimeExpanded"),
            },
          }}
        />
      )}

      {/* Additional Fields */}
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.airline")}</label>
          <input
            type="text"
            value={airline}
            onChange={(e) => setAirline(e.target.value)}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.airline")}
            list="airline-suggestions"
          />
          <datalist id="airline-suggestions">
            {airlineSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.operatingAirline")}</label>
          <input
            type="text"
            value={operatingAirline}
            onChange={(e) => setOperatingAirline(e.target.value)}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.operatingAirline")}
            list="operating-airline-suggestions"
          />
          <datalist id="operating-airline-suggestions">
            {airlineSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.flightNumber")}</label>
          <input
            type="text"
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.flightNumber")}
            maxLength={10}
          />
        </div>
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.status")}</label>
          <div>
            <span
              className="px-2 py-1 text-xs font-semibold rounded-full inline-block"
              style={
                status === "flown"
                  ? {
                      background: "rgba(63,185,80,0.15)",
                      color: "var(--success)",
                    }
                  : status === "scheduled"
                    ? {
                        background: "rgba(56,139,253,0.15)",
                        color: "#388bfd",
                      }
                    : status === "historical"
                      ? {
                          // historical is archival data, not an error state —
                          // amber matches the cruise pill palette
                          // (cruiseStatusStyle.ts) instead of red. "duplicated"
                          // never reaches this form step (only assigned by
                          // lib/flightDuplicate.ts, which bypasses this UI), so
                          // this component's status prop type excludes it.
                          background: "rgba(251,191,36,0.15)",
                          color: "#fbbf24",
                        }
                      : {
                          background: "rgba(248,81,73,0.15)",
                          color: "var(--danger)",
                        }
              }
            >
              {t(`flights:status.${status}`, { defaultValue: status })}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm mt-2">
            <input
              type="checkbox"
              checked={status === "cancelled"}
              onChange={(e) => setStatus(e.target.checked ? "cancelled" : "scheduled")}
            />
            {t("flights:status.cancelledCheckbox")}
          </label>
        </div>
      </div>

      {/* Equipment / Gate / Seat / Category */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.aircraft")}</label>
          <input
            type="text"
            value={aircraft}
            onChange={(e) => setAircraft(e.target.value)}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.aircraft")}
            list="aircraft-suggestions"
          />
          <datalist id="aircraft-suggestions">
            {aircraftSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`label ${textClass}`}>{t("flights:form.terminal")}</label>
            <input
              type="text"
              value={terminal}
              onChange={(e) => setTerminal(e.target.value)}
              className={`input ${sizedInputClass}`}
              placeholder={t("flights:form.placeholders.terminal")}
            />
          </div>
          <div>
            <label className={`label ${textClass}`}>{t("flights:form.gate")}</label>
            <input
              type="text"
              value={gate}
              onChange={(e) => setGate(e.target.value)}
              className={`input ${sizedInputClass}`}
              placeholder={t("flights:form.placeholders.gate")}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.seat")}</label>
          <input
            type="text"
            value={seatNumber}
            onChange={(e) => setSeatNumber(e.target.value.toUpperCase())}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.seat")}
          />
        </div>
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.seatClass")}</label>
          <select
            value={seatClass}
            onChange={(e) =>
              setSeatClass(e.target.value as "economy" | "premium_economy" | "business" | "first")
            }
            className={`input ${sizedInputClass}`}
          >
            <option value="economy">{t("flights:seatClass.economy")}</option>
            <option value="premium_economy">{t("flights:seatClass.premium_economy")}</option>
            <option value="business">{t("flights:seatClass.business")}</option>
            <option value="first">{t("flights:seatClass.first")}</option>
          </select>
        </div>
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.category")}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as "business" | "private" | "vacation")}
            className={`input ${sizedInputClass}`}
          >
            <option value="business">{t("flights:category.business")}</option>
            <option value="private">{t("flights:category.private")}</option>
            <option value="vacation">{t("flights:category.vacation")}</option>
          </select>
        </div>
      </div>

      {/* Price & Currency — always available, matching the cruise form (#192).
          Only the tax/fee breakdown elsewhere stays behind cost tracking. */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className={`label ${textClass} flex items-center gap-2`}>
            {t("flights:form.price")}
            <HelpIcon
              content={t("flights:form.help.price")}
              expandedContent={t("flights:form.help.price")}
              position="top"
            />
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={price ?? ""}
            onChange={(e) => setPrice(e.target.value ? parseFloat(e.target.value) : undefined)}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.price")}
          />
        </div>
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.currency")}</label>
          <CurrencyInput
            value={currency}
            onChange={setCurrency}
            className={`input ${sizedInputClass}`}
          />
        </div>
      </div>

      {/* Booking Reference / Ticket Number (#197) */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.bookingReference")}</label>
          <input
            type="text"
            value={bookingReference}
            onChange={(e) => setBookingReference(e.target.value.toUpperCase())}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.bookingReference")}
          />
        </div>
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.ticketNumber")}</label>
          <input
            type="text"
            value={ticketNumber}
            onChange={(e) => setTicketNumber(e.target.value)}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.ticketNumber")}
          />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className={`label ${textClass} flex items-center gap-2`}>
          {t("flights:form.tags")}
          <HelpIcon
            content={t("flights:form.help.tags")}
            expandedContent={t("flights:form.help.tagsExpanded")}
            position="top"
          />
        </label>
        <input
          type="text"
          value={tags.join(", ")}
          onChange={(e) =>
            setTags(
              e.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            )
          }
          className={`input ${sizedInputClass}`}
          placeholder={t("flights:form.placeholders.tags")}
        />
        <p className={`text-xs ${mutedTextClass} mt-1`}>{t("flights:form.tagsHint")}</p>
      </div>

      {/* Travel Companions */}
      <div>
        <label className={`label ${textClass}`}>{t("flights:form.companions")}</label>
        <CompanionPicker value={companions} onChange={setCompanions} />
      </div>

      {/* Notes */}
      <div>
        <label className={`label ${textClass}`}>{t("flights:form.notes")}</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`input ${sizedInputClass}`}
          rows={3}
          placeholder={t("flights:form.placeholders.notes")}
        />
      </div>
    </div>
  );
}
