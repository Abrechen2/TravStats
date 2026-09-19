import HelpIcon from "../Help/HelpIcon";
import AirportAutocomplete from "../AirportAutocomplete";
import HistoricalDateFields from "./fields/HistoricalDateFields";
import TimesFields, { type ActualTimesFieldsValue } from "./fields/TimesFields";
import CatalogueCombobox, { searchAirlineOptions } from "./fields/CatalogueCombobox";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import type { Airport } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { estimateArrivalFromDeparture } from "../../lib/timeEstimation";
import { type CostFieldsValue } from "./fields/CostFields";
import StatusField from "./fields/StatusField";
import { useSettingsStore } from "../../store/settingsStore";
import FlightFormSection from "./FlightFormSection";
import { RequiredMark } from "./requiredFields";
import AircraftSection from "./sections/AircraftSection";
import BookingAndNotesSection from "./sections/BookingAndNotesSection";
import PriceAndSeatSection from "./sections/PriceAndSeatSection";
import { countValue, priceSummaryValue, summaryLine } from "./sections/sectionSummaries";

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
  /** "" is the explicit "(optional)" choice — stored as NULL. */
  seatClass: "" | "economy" | "premium_economy" | "business" | "first";
  status: "scheduled" | "flown" | "cancelled" | "historical";
  /** "" is the explicit "(optional)" choice — stored as NULL. */
  category: "" | "business" | "private" | "vacation";
  setAirline: (v: string) => void;
  setOperatingAirline: (v: string) => void;
  setFlightNumber: (v: string) => void;
  setAircraft: (v: string) => void;
  setTerminal: (v: string) => void;
  setGate: (v: string) => void;
  setSeatNumber: (v: string) => void;
  setBoardingGroup: (v: string) => void;
  setSeatClass: (v: "" | "economy" | "premium_economy" | "business" | "first") => void;
  setStatus: (v: "scheduled" | "flown" | "cancelled" | "historical") => void;
  setCategory: (v: "" | "business" | "private" | "vacation") => void;
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
  const { t } = useTranslation(["flights", "common"]);
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

  /**
   * What each folded group is hiding, in one line — see `sectionSummaries`.
   *
   * Computed here rather than inside each section because the section
   * components render only when OPEN-ish content is wanted, while the summary
   * is what the closed header shows; keeping both in the parent means one
   * place decides what "filled in" means for a given field.
   */
  /**
   * The core group is open by default, but it can be folded — by the user, or
   * by a session that remembers one — and a folded group that says nothing is
   * exactly what the summaries exist to prevent. It is also the group a
   * refused save unfolds, so its header is what the user sees a moment before
   * the cursor lands.
   */
  const coreSummary = summaryLine([
    {
      label: t("flights:form.from"),
      value: departure?.iata ?? departure?.name ?? "",
    },
    {
      label: t("flights:form.to"),
      value: arrival?.iata ?? arrival?.name ?? "",
    },
    { label: t("flights:form.departureDate"), value: departureDate },
    { label: t("flights:form.airline"), value: airline },
  ]);

  const priceAndSeatSummary = summaryLine([
    { label: t("flights:form.price"), value: priceSummaryValue(cost.price, cost.currency) },
    { label: t("flights:form.seat"), value: seatNumber },
    {
      label: t("flights:form.seatClass"),
      value: seatClass ? t(`flights:seatClass.${seatClass}`) : "",
    },
    { label: t("flights:form.category"), value: category ? t(`flights:category.${category}`) : "" },
  ]);

  const aircraftSummary = summaryLine([
    { label: t("flights:form.aircraft"), value: aircraft },
    { label: t("flights:form.terminal"), value: terminal },
    { label: t("flights:form.gate"), value: gate },
  ]);

  const bookingSummary = summaryLine([
    { label: t("flights:form.bookingReference"), value: bookingReference },
    { label: t("flights:form.ticketNumber"), value: ticketNumber },
    { label: t("flights:form.tags"), value: countValue(tags) },
    { label: t("flights:form.companions"), value: countValue(companions) },
    { label: t("flights:form.notes"), value: notes ? t("flights:form.sections.filledIn") : "" },
  ]);

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

      {/* Kern — route, times and airline, open by default (forgejo#88, point
          9). The three groups below it are folded: this is the part without
          which there is no flight to record. */}
      <FlightFormSection
        id="core"
        title={t("flights:form.sections.core")}
        summary={coreSummary}
        defaultOpen
      >
        <div className="space-y-6">
          {/* Airports */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={`label ${textClass}`}>
                  {t("flights:form.from")} <RequiredMark />
                </label>
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
                <label className={`label ${textClass}`}>
                  {t("flights:form.to")} <RequiredMark />
                </label>
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
                setArrivalDate(
                  depDateChanged && arrivalNeedsToCatchUp ? next.depDate : next.arrDate
                );
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
              markRequired
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
        </div>
      </FlightFormSection>

      {/* The three folded groups. Each closed header names what is filled in,
          so the fold can never be the reason a price is forgotten. */}
      <FlightFormSection
        id="priceAndSeat"
        title={t("flights:form.sections.priceAndSeat")}
        summary={priceAndSeatSummary}
      >
        <PriceAndSeatSection
          seatNumber={seatNumber}
          boardingGroup={boardingGroup}
          seatClass={seatClass}
          category={category}
          setSeatNumber={setSeatNumber}
          setBoardingGroup={setBoardingGroup}
          setSeatClass={setSeatClass}
          setCategory={setCategory}
          cost={cost}
          onCostChange={onCostChange}
          showCostBreakdown={features.enableCostTracking}
          priceHelp={{
            content: t("flights:form.help.price"),
            expandedContent: t("flights:form.help.price"),
          }}
          labelClassName={textClass}
          inputClassName={sizedInputClass}
        />
      </FlightFormSection>

      <FlightFormSection
        id="aircraft"
        title={t("flights:form.sections.aircraft")}
        summary={aircraftSummary}
      >
        <AircraftSection
          aircraft={aircraft}
          terminal={terminal}
          gate={gate}
          setAircraft={setAircraft}
          setTerminal={setTerminal}
          setGate={setGate}
          labelClassName={textClass}
          inputClassName={sizedInputClass}
        />
      </FlightFormSection>

      <FlightFormSection
        id="booking"
        title={t("flights:form.sections.booking")}
        summary={bookingSummary}
      >
        <BookingAndNotesSection
          booking={{
            bookingReference,
            ticketNumber,
            bookingClassLetter: bookingClassLetter ?? "",
            baggageAllowance: baggageAllowance ?? "",
            frequentFlyerNumber: frequentFlyerNumber ?? "",
          }}
          onBookingChange={(v) => {
            setBookingReference(v.bookingReference);
            setTicketNumber(v.ticketNumber);
            setBookingClassLetter(v.bookingClassLetter);
            setBaggageAllowance(v.baggageAllowance);
            setFrequentFlyerNumber(v.frequentFlyerNumber);
          }}
          tripId={tripId}
          setTripId={setTripId}
          tags={tags}
          setTags={setTags}
          companions={companions}
          setCompanions={setCompanions}
          coPassengers={coPassengers}
          notes={notes}
          setNotes={setNotes}
          labelClassName={textClass}
          mutedTextClassName={mutedTextClass}
          inputClassName={sizedInputClass}
        />
      </FlightFormSection>

      {/* The legend the asterisks refer to. Below the fields rather than above
          them: it explains a mark the reader has already met. */}
      <p className={`text-xs ${mutedTextClass}`}>{t("flights:form.requiredLegend")}</p>
    </div>
  );
}
