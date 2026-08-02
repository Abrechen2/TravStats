import HelpIcon from "../Help/HelpIcon";
import AirportAutocomplete from "../AirportAutocomplete";
import CompanionsField from "./fields/CompanionsField";
import HistoricalDateFields from "./fields/HistoricalDateFields";
import TimesFields, { type ActualTimesFieldsValue } from "./fields/TimesFields";
import CatalogueCombobox, {
  searchAirlineOptions,
  searchAircraftOptions,
} from "./fields/CatalogueCombobox";
import BookingFields from "./fields/BookingFields";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import type { Airport } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { estimateArrivalFromDeparture } from "../../lib/timeEstimation";
import CostFields, { type CostFieldsValue } from "./fields/CostFields";
import TripSelectField from "./fields/TripSelectField";
import StatusField from "./fields/StatusField";
import { useSettingsStore } from "../../store/settingsStore";

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
  // Actual departure/arrival (#200) — optional so existing callers/tests that
  // don't wire this in (e.g. FlightCompleteStep.timesFieldsWiring.test.tsx's
  // baseProps()) keep compiling; SimplifiedFlightFormV2 always supplies all
  // eight. When any setter is missing, the corresponding field just no-ops
  // instead of crashing — see handleActualChange below.
  actualDepartureDate?: string;
  actualDepartureTime?: string;
  actualArrivalDate?: string;
  actualArrivalTime?: string;
  setActualDepartureDate?: (v: string) => void;
  setActualDepartureTime?: (v: string) => void;
  setActualArrivalDate?: (v: string) => void;
  setActualArrivalTime?: (v: string) => void;
  // Flight info
  airline: string;
  operatingAirline: string;
  flightNumber: string;
  aircraft: string;
  terminal: string;
  gate: string;
  seatNumber: string;
  boardingGroup: string;
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
  setBoardingGroup: (v: string) => void;
  setSeatClass: (v: "economy" | "premium_economy" | "business" | "first") => void;
  setStatus: (v: "scheduled" | "flown" | "cancelled" | "historical") => void;
  setCategory: (v: "business" | "private" | "vacation") => void;
  // Booking (#197 — same fields the edit modal offers; #199 added the three
  // parser-filled ones that were previously rendered by neither form)
  bookingReference: string;
  ticketNumber: string;
  bookingClassLetter: string | undefined;
  baggageAllowance: string | undefined;
  frequentFlyerNumber: string | undefined;
  setBookingReference: (v: string) => void;
  setTicketNumber: (v: string) => void;
  setBookingClassLetter: (v: string) => void;
  setBaggageAllowance: (v: string) => void;
  setFrequentFlyerNumber: (v: string) => void;
  // Cost (#192; #199 added taxes/fees/receipt to the create path). Grouped
  // as one value object — this component just hands it to CostFields.
  cost: CostFieldsValue;
  onCostChange: (v: CostFieldsValue) => void;
  // Trip (#199) — the assignment itself runs AFTER the create, in
  // useFlightForm; this form only collects the choice.
  tripId: string;
  setTripId: (v: string) => void;
  // Tags & companions
  tags: string[];
  companions: string[];
  /** Raw parser output, read-only in the UI — see CompanionsField. */
  coPassengers: string[];
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
  actualDepartureDate,
  actualDepartureTime,
  actualArrivalDate,
  actualArrivalTime,
  setActualDepartureDate,
  setActualDepartureTime,
  setActualArrivalDate,
  setActualArrivalTime,
  airline,
  operatingAirline,
  flightNumber,
  aircraft,
  terminal,
  gate,
  seatNumber,
  boardingGroup,
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
  setBoardingGroup,
  setSeatClass,
  setStatus,
  setCategory,
  bookingReference,
  ticketNumber,
  bookingClassLetter,
  baggageAllowance,
  frequentFlyerNumber,
  setBookingReference,
  setTicketNumber,
  setBookingClassLetter,
  setBaggageAllowance,
  setFrequentFlyerNumber,
  cost,
  onCostChange,
  tripId,
  setTripId,
  tags,
  companions,
  coPassengers,
  setTags,
  setCompanions,
  notes,
  setNotes,
  textClass,
  mutedTextClass,
  sizedInputClass,
  setTimeEstimationWarning,
}: FlightCompleteStepProps): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const addToast = useToastStore((s) => s.addToast);
  const { features } = useSettingsStore();

  const canEstimateArrival = Boolean(
    departure && arrival && departureDate && departureTime && status !== "historical"
  );

  // Actual departure/arrival (#200) — defaults to empty strings when the
  // caller didn't wire the optional props in (see FlightCompleteStepProps),
  // so <TimesFields> always gets a well-formed actualValue. The individual
  // setter calls are optional-chained for the same reason.
  const actualTimesValue: ActualTimesFieldsValue = {
    actualDepDate: actualDepartureDate ?? "",
    actualDepTime: actualDepartureTime ?? "",
    actualArrDate: actualArrivalDate ?? "",
    actualArrTime: actualArrivalTime ?? "",
  };
  const handleActualTimesChange = (next: ActualTimesFieldsValue): void => {
    setActualDepartureDate?.(next.actualDepDate);
    setActualDepartureTime?.(next.actualDepTime);
    setActualArrivalDate?.(next.actualArrDate);
    setActualArrivalTime?.(next.actualArrTime);
  };

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

      {/* Date & Time — full inputs for normal flights, year/month/day for
          historical. Shared with the edit modal via HistoricalDateFields. */}
      {status === "historical" ? (
        <HistoricalDateFields
          value={departureDate}
          onChange={(next) => {
            setDepartureDate(next);
            setArrivalDate(next);
          }}
          labelClassName={textClass}
          inputClassName={sizedInputClass}
        />
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
          actualValue={actualTimesValue}
          onActualChange={handleActualTimesChange}
        />
      )}

      {/* Additional Fields */}
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.airline")}</label>
          <CatalogueCombobox
            value={airline}
            onChange={setAirline}
            search={searchAirlineOptions}
            placeholder={t("flights:form.placeholders.airline")}
            inputClassName={sizedInputClass}
          />
        </div>
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.operatingAirline")}</label>
          <CatalogueCombobox
            value={operatingAirline}
            onChange={setOperatingAirline}
            search={searchAirlineOptions}
            placeholder={t("flights:form.placeholders.operatingAirline")}
            inputClassName={sizedInputClass}
          />
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
        <StatusField status={status} onStatusChange={setStatus} labelClassName={textClass} />
      </div>

      {/* Equipment / Gate / Seat / Category */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={`label ${textClass}`}>{t("flights:form.aircraft")}</label>
          <CatalogueCombobox
            value={aircraft}
            onChange={setAircraft}
            search={searchAircraftOptions}
            placeholder={t("flights:form.placeholders.aircraft")}
            inputClassName={sizedInputClass}
          />
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

      <div className="grid grid-cols-4 gap-4">
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
          {/* #199 — the edit modal had this all along; the create form
              dropped a parser-provided boarding group on the way in. */}
          <label className={`label ${textClass}`}>{t("flights:form.boardingGroup")}</label>
          <input
            type="text"
            value={boardingGroup}
            onChange={(e) => setBoardingGroup(e.target.value)}
            className={`input ${sizedInputClass}`}
            placeholder={t("flights:form.placeholders.boardingGroup")}
            maxLength={20}
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

      {/* Cost (#192, #199) — shared with the edit modal; the tax/fee
          breakdown stays behind cost tracking (details in CostFields). */}
      <CostFields
        value={cost}
        onChange={onCostChange}
        showBreakdown={features.enableCostTracking}
        priceHelp={{
          content: t("flights:form.help.price"),
          expandedContent: t("flights:form.help.price"),
        }}
        labelClassName={textClass}
        inputClassName={sizedInputClass}
      />

      {/* Booking (#197, #199) — shared with the edit modal */}
      <BookingFields
        value={{
          bookingReference,
          ticketNumber,
          bookingClassLetter: bookingClassLetter ?? "",
          baggageAllowance: baggageAllowance ?? "",
          frequentFlyerNumber: frequentFlyerNumber ?? "",
        }}
        onChange={(v) => {
          setBookingReference(v.bookingReference);
          setTicketNumber(v.ticketNumber);
          setBookingClassLetter(v.bookingClassLetter);
          setBaggageAllowance(v.baggageAllowance);
          setFrequentFlyerNumber(v.frequentFlyerNumber);
        }}
        labelClassName={textClass}
        inputClassName={sizedInputClass}
      />

      {/* Trip (#199) — the assignment runs after the create, see
          useFlightForm.maybeAssignTrip */}
      <TripSelectField
        value={tripId}
        onChange={setTripId}
        labelClassName={textClass}
        inputClassName={sizedInputClass}
      />

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
      <CompanionsField
        companions={companions}
        onCompanionsChange={setCompanions}
        coPassengers={coPassengers}
        labelClassName={textClass}
      />

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
