import CurrencySelect from "../common/CurrencySelect";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useEffect, useId, useRef, useState, useCallback } from "react";
import type { JSX, ReactNode } from "react";
import type { ParsedCruiseEntry, ParsedFlightSuggestion } from "../../lib/api/parse";
import type {
  CabinType,
  CruiseInput,
  CruiseWriteBody,
  CruiseStatus,
  CruiseStopInput,
  FlightInput,
  Port,
  Ship,
} from "../../types";
// AirportAutocomplete + airportsApi use the lib/api Airport (stricter `name`);
// use the same one so its value/onChange line up, then it flows into FlightInput.
import type { Airport } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { airportZone } from "../FlightForm/flightPayload";
import { MissingZoneError, dayInput } from "../../lib/api/timeInput";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { cruiseStopToWire } from "./cruiseStopWire";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import Modal from "../Modal";
import { deriveCruiseStatus } from "../../shared/statusDerivation";
import { ShipPicker } from "./ShipPicker";
import CatalogueCombobox from "../FlightForm/fields/CatalogueCombobox";
import { searchCruiseLineOptions } from "./cruiseLineOptions";
import { PortPicker } from "./PortPicker";
import { CruiseStopsEditor } from "./CruiseStopsEditor";
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";
import AirportAutocomplete from "../AirportAutocomplete";
import type { EntryData } from "./cruiseImportEntry";
import { storeCruiseImport } from "./cruiseImportSave";
import type { CruiseImportOutcome } from "./cruiseImportSave";
import { CruiseImportFlightGap } from "./CruiseImportFlightGap";
import { CruiseReimportCompare } from "./CruiseReimportCompare";
import type { ReimportConflict, ReimportSummary } from "./CruiseReimportCompare";
import Toggletip from "../ui/Toggletip";

export { deriveTripMeta } from "./cruiseImportEntry";

interface CruiseImportPreviewModalProps {
  entries: ParsedCruiseEntry[];
  /** The uploaded file's name, so the import log row can be identified later
   *  rather than reading like every other email import that day (#19). */
  sourceFileName?: string | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

const CABIN_TYPES: CabinType[] = ["inside", "oceanview", "balcony", "suite"];
const SEAT_CLASSES = ["economy", "premium_economy", "business", "first"] as const;
type SeatClass = (typeof SEAT_CLASSES)[number];

const INPUT =
  "w-full rounded-md border border-border bg-(--bg-surface) px-2 py-1.5 text-sm text-(--text-primary) focus:border-(--accent) focus:outline-hidden";

const dateOnly = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");
// A cruise's first/last day travels as a bare `YYYY-MM-DD` (ADR 0002).
const toDay = (d: string): string | undefined => dayInput(d) ?? undefined;

/**
 * Post-parse review for imported cruises + bundled fly & cruise flights.
 * Each cruise is an editable audit card; detected flights become opt-in
 * editable cards; everything can be grouped into one Trip on save.
 */
export function CruiseImportPreviewModal({
  entries,
  sourceFileName,
  onCancel,
  onSaved,
}: CruiseImportPreviewModalProps): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [saving, setSaving] = useState(false);
  const [entryData, setEntryData] = useState<EntryData[]>(() =>
    // Placeholder until each card's effect builds the write body on mount.
    entries.map((e) => ({
      input: { ...e.input, stops: [] },
      stops: [],
      flightInputs: [],
      tripLabel: "",
    }))
  );
  const anyFlightsDetected = entries.some((e) => (e.flights?.length ?? 0) > 0);
  const [groupAsTrip, setGroupAsTrip] = useState(anyFlightsDetected || entries.length > 1);
  const [tripName, setTripName] = useState("");
  /** Bookings the server already held whose plan the user is comparing (forgejo#225). */
  const [reimports, setReimports] = useState<ReimportConflict[] | null>(null);
  /** Flights the import did not store, named with a retry (re-review residual of I4). */
  const [flightGap, setFlightGap] = useState<CruiseImportOutcome | null>(null);
  /** The stored outcome while the comparison and the flight list are open. */
  const outcomeRef = useRef<CruiseImportOutcome | null>(null);

  const handleEntryChange = useCallback((idx: number, data: EntryData): void => {
    setEntryData((prev) => prev.map((p, i) => (i === idx ? data : p)));
  }, []);

  const totalFlights = entryData.reduce((n, e) => n + e.flightInputs.length, 0);
  const defaultTripName = entryData[0]?.tripLabel || t("cruise:import.tripDefault");
  const showTripToggle = anyFlightsDetected || entries.length > 1;

  const handleSave = async (): Promise<void> => {
    const timeError = entryData.find((e) => e.timeError)?.timeError;
    if (timeError) {
      addToast("error", saveErrorMessage(timeError, t, "cruise:import.saveError"));
      return;
    }
    setSaving(true);
    try {
      const allFlights = entryData.flatMap((e) => e.flightInputs);
      const outcome = await storeCruiseImport({
        entryData,
        wantTrip: groupAsTrip && (allFlights.length > 0 || entryData.length > 1),
        tripName: tripName.trim() || defaultTripName,
        sourceFileName: sourceFileName ?? null,
      });
      outcomeRef.current = outcome;
      if (outcome.conflicts.length > 0) setReimports(outcome.conflicts);
      else afterComparison();
    } catch (err: unknown) {
      logger.error("CruiseImportPreviewModal: save failed", err);
      addToast("error", saveErrorMessage(err, t, "cruise:import.saveError"));
    } finally {
      setSaving(false);
    }
  };

  /** Last step: the import's own messages, then `onSaved`. */
  const finish = (addedFlights: number, stillMissing: number): void => {
    const outcome = outcomeRef.current;
    outcomeRef.current = null;
    setFlightGap(null);
    if (!outcome) return;
    if (outcome.alreadyThere > 0) {
      addToast("info", t("cruise:import.alreadyImported", { count: outcome.alreadyThere }));
    }
    // Counts what this import STORED, not what it read.
    const flights = outcome.storedFlights + addedFlights;
    if (outcome.created > 0) {
      addToast(
        "success",
        flights > 0
          ? t("cruise:import.savedWithFlights", { cruises: outcome.created, flights })
          : t("cruise:import.saved", { count: outcome.created })
      );
    }
    if (stillMissing > 0) {
      addToast("warning", t("cruise:flightGap.leftOut", { count: stillMissing }));
    }
    void Promise.resolve(onSaved()).catch((err: unknown) => {
      logger.error("CruiseImportPreviewModal: finishing the import failed", err);
      addToast("error", saveErrorMessage(err, t, "cruise:import.saveError"));
    });
  };

  /** After the comparison: flights that were not stored are named before the end. */
  const afterComparison = (): void => {
    const outcome = outcomeRef.current;
    if (outcome && outcome.gap.length > 0) setFlightGap(outcome);
    else finish(0, 0);
  };

  const onReimportDone = (summary: ReimportSummary): void => {
    setReimports(null);
    if (summary.applied > 0) {
      addToast("success", t("cruise:reimport.appliedToast", { count: summary.applied }));
    }
    afterComparison();
  };

  // The shared frame, like the lodging preview (forgejo#166): in place, the
  // preview sat before the add chooser's portal and never got the keyboard.
  return (
    <>
      {reimports && <CruiseReimportCompare conflicts={reimports} onDone={onReimportDone} />}
      {flightGap && (
        <CruiseImportFlightGap
          items={flightGap.gap}
          created={flightGap.created > 0}
          tripId={flightGap.tripId}
          onDone={({ added, stillMissing }) => finish(added, stillMissing)}
        />
      )}
      <Modal
        open
        onClose={onCancel}
        busy={saving}
        maxWidth={672}
        closeLabel={t("common:buttons.close")}
        title={t("cruise:import.previewTitle", { count: entries.length })}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-(--text-muted)">
              {totalFlights > 0 && t("cruise:import.flightCount", { count: totalFlights })}
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:text-(--text-primary) disabled:opacity-50"
              >
                {t("common:buttons.cancel")}
              </button>
              <button
                type="button"
                onClick={(): void => void handleSave()}
                disabled={saving}
                className="btn-primary px-4 py-2 text-sm"
              >
                {saving ? t("common:loading.default") : t("cruise:import.save")}
              </button>
            </div>
          </div>
        }
      >
        <p className="mb-4 text-sm text-(--text-muted)">{t("cruise:import.editHint")}</p>

        <div className="space-y-4">
          {entries.map((entry, idx) => (
            <CruiseImportEntryEditor
              key={idx}
              index={idx}
              entry={entry}
              onChange={handleEntryChange}
            />
          ))}
        </div>

        {showTripToggle && (
          <div className="mt-4 rounded-lg border border-border bg-(--bg-base) p-3">
            <label className="flex items-center gap-2 text-sm text-(--text-primary)">
              <input
                type="checkbox"
                checked={groupAsTrip}
                onChange={(e): void => setGroupAsTrip(e.target.checked)}
              />
              {t("cruise:import.groupAsTrip")}
            </label>
            {groupAsTrip && (
              <input
                value={tripName}
                onChange={(e): void => setTripName(e.target.value)}
                placeholder={defaultTripName}
                className={`${INPUT} mt-2`}
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function Field({
  label,
  missing,
  children,
}: {
  label: string;
  missing?: boolean;
  children: ReactNode;
}): JSX.Element {
  const { t } = useTranslation("cruise");
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-(--text-muted)">
        {label}
        {missing && (
          <span className="text-[10px] normal-case text-red-300">({t("import.missing")})</span>
        )}
      </label>
      {children}
    </div>
  );
}

interface EditableFlight {
  include: boolean;
  flightNumber: string;
  airline: string;
  date: string;
  depAirport: Airport | null;
  arrAirport: Airport | null;
  seatClass: SeatClass | "";
  direction?: "outbound" | "return";
}

function CruiseImportEntryEditor({
  entry,
  index,
  onChange,
}: {
  entry: ParsedCruiseEntry;
  index: number;
  onChange: (index: number, data: EntryData) => void;
}): JSX.Element {
  const { t } = useTranslation("cruise");
  const shipInputId = useId();
  const { input } = entry;
  const overrideName = input.shipNameOverride ?? null;

  const [ship, setShip] = useState<Ship | null>(entry.ship ?? null);
  const [cruiseLine, setCruiseLine] = useState(input.cruiseLine ?? "");
  const [routeName, setRouteName] = useState(input.routeName ?? "");
  const [startDate, setStartDate] = useState(dateOnly(input.startDate));
  const [endDate, setEndDate] = useState(dateOnly(input.endDate));
  const [status, setStatus] = useState<CruiseStatus>(input.status ?? "scheduled");
  const [cabinNumber, setCabinNumber] = useState(input.cabinNumber ?? "");
  const [cabinType, setCabinType] = useState<CabinType | "">(input.cabinType ?? "");
  const [deck, setDeck] = useState(input.deck != null ? String(input.deck) : "");
  const [bookingReference, setBookingReference] = useState(input.bookingReference ?? "");
  const [price, setPrice] = useState(input.price != null ? String(input.price) : "");
  const [currency, setCurrency] = useState<string>(input.currency ?? "EUR");
  const recentCurrencies = useRecentCurrencies();
  const [departurePort, setDeparturePort] = useState<Port | null>(entry.departurePort ?? null);
  const [arrivalPort, setArrivalPort] = useState<Port | null>(entry.arrivalPort ?? null);
  const [stops, setStops] = useState<CruiseStopInput[]>(() =>
    (input.stops ?? []).map((s) => ({
      ...s,
      port: entry.stopPorts?.[s.dayNumber] ?? s.port ?? null,
    }))
  );
  const [showStops, setShowStops] = useState(entry.unmatchedPorts.length > 0);

  const [flights, setFlights] = useState<EditableFlight[]>(() =>
    (entry.flights ?? []).map((f: ParsedFlightSuggestion) => ({
      include: true,
      flightNumber: f.flightNumber ?? "",
      airline: f.airline ?? "",
      // Default a missing date from the cruise: outbound = embarkation,
      // return = disembarkation.
      date:
        dateOnly(f.date) ||
        (f.direction === "return" ? dateOnly(input.endDate) : dateOnly(input.startDate)),
      // Pre-filled by the backend (home airport + nearest airport to the
      // port); fully editable below.
      depAirport: f.departureAirport ?? null,
      arrAirport: f.arrivalAirport ?? null,
      seatClass: f.cabinClass ?? "",
      direction: f.direction,
    }))
  );

  const updateFlight = useCallback((idx: number, patch: Partial<EditableFlight>): void => {
    setFlights((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }, []);

  useEffect(() => {
    const builtInput: CruiseWriteBody = {
      shipId: ship?.id ?? undefined,
      shipNameOverride: ship ? undefined : (overrideName ?? undefined),
      cruiseLine: cruiseLine.trim() || undefined,
      routeName: routeName.trim() || undefined,
      departurePortId: departurePort?.id ?? undefined,
      arrivalPortId: arrivalPort?.id ?? undefined,
      startDate: toDay(startDate),
      endDate: toDay(endDate),
      status,
      cabinNumber: cabinNumber.trim() || undefined,
      cabinType: cabinType || undefined,
      deck: deck ? Number(deck) : undefined,
      bookingReference: bookingReference.trim() || undefined,
      price: price ? Number(price) : undefined,
      currency: (currency as CruiseInput["currency"]) || undefined,
      stops: [],
    };
    let timeError: MissingZoneError | undefined;
    try {
      builtInput.stops = stops.map(cruiseStopToWire);
    } catch (err: unknown) {
      if (!(err instanceof MissingZoneError)) throw err;
      timeError = err;
    }

    const flightInputs: FlightInput[] = flights
      .filter((f) => f.include && f.depAirport && f.arrAirport && f.date)
      .map((f): FlightInput => {
        const dep = f.depAirport!;
        const arr = f.arrAirport!;
        return {
          airline: f.airline.trim() || undefined,
          flightNumber: f.flightNumber.trim() || undefined,
          departure: dep,
          arrival: arr,
          // Tentative fly & cruise flight: known calendar date, unknown time.
          // Each airport's own zone; none means the save refuses (no UTC guess).
          departureLocal: `${f.date}T00:00`,
          depTimezone: airportZone(dep) ?? undefined,
          arrivalLocal: `${f.date}T00:00`,
          arrTimezone: airportZone(arr) ?? undefined,
          depTimeSemantics: "DATE_ONLY",
          arrTimeSemantics: "DATE_ONLY",
          status: "scheduled",
          seatClass: f.seatClass || undefined,
          dataSource: "email_import",
        };
      });

    // Derive a default trip label from the ship/override name + year. No t()
    // here on purpose: react-i18next's `t` can change identity between renders,
    // and any unstable value in this effect's deps drives an infinite
    // setState→render loop. The parent falls back to t("import.tripDefault")
    // when this comes back empty.
    const shipName = ship?.name ?? overrideName ?? "";
    const tripLabel = shipName ? `${shipName}${startDate ? ` ${startDate.slice(0, 4)}` : ""}` : "";

    if (!timeError && flightInputs.some((f) => !f.depTimezone || !f.arrTimezone)) {
      timeError = new MissingZoneError("flights");
    }
    onChange(index, { input: builtInput, stops, flightInputs, tripLabel, timeError });
  }, [
    ship,
    cruiseLine,
    routeName,
    startDate,
    endDate,
    status,
    cabinNumber,
    cabinType,
    deck,
    bookingReference,
    price,
    currency,
    departurePort,
    arrivalPort,
    stops,
    flights,
    overrideName,
    index,
    onChange,
  ]);

  const portStops = stops.filter((s) => !s.isAtSea).length;
  const seaDays = stops.length - portStops;

  // What the server will store (forgejo#168): it derives the status from the
  // dates with this same rule, so the pill shows that, not the parser's hint.
  const shownStatus = deriveCruiseStatus({
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    current: status,
  }) as CruiseStatus;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-(--bg-base) p-4">
      {/* Ship */}
      <div>
        {/* The label names the ship search only; the match badge is beside it,
            so its help button is not read into the field's name (forgejo#249). */}
        <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-(--text-muted)">
          <label htmlFor={shipInputId}>{t("field.ship")}</label>
          {ship ? (
            <span className="rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] normal-case text-emerald-300">
              ✓ {t("import.shipMatched")}
            </span>
          ) : overrideName ? (
            <Toggletip
              content={t("import.shipUnmatchedHint")}
              triggerClassName="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] normal-case text-amber-300"
            >
              ⚠ {t("import.shipUnmatched")}
            </Toggletip>
          ) : (
            <span className="rounded-sm bg-red-500/15 px-1.5 py-0.5 text-[10px] normal-case text-red-300">
              {t("import.missing")}
            </span>
          )}
        </div>
        <ShipPicker id={shipInputId} value={ship} onChange={setShip} />
        {!ship && overrideName && (
          <p className="mt-1 text-[11px] text-amber-300/80">
            {t("import.shipUnmatched")}: {overrideName}
          </p>
        )}
      </div>

      {/* Route name */}
      <Field label={t("field.routeName")}>
        <input
          value={routeName}
          onChange={(e): void => setRouteName(e.target.value)}
          placeholder={t("field.routeName")}
          className={INPUT}
        />
      </Field>

      {/* Dates + status */}
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("field.depart")} missing={!startDate}>
          <input
            type="date"
            value={startDate}
            onChange={(e): void => setStartDate(e.target.value)}
            style={{ colorScheme: "dark" }}
            className={INPUT}
          />
        </Field>
        <Field label={t("field.arrive")} missing={!endDate}>
          <input
            type="date"
            value={endDate}
            onChange={(e): void => setEndDate(e.target.value)}
            style={{ colorScheme: "dark" }}
            className={INPUT}
          />
        </Field>
        {/* #status-from-dates: cruise write paths derive scheduled/in_progress/
            flown from the dates — a select just let the UI set a value the
            backend would immediately overwrite. Only "cancelled" stays
            user-controlled, via the checkbox below. Mirrors CruiseEditModal. */}
        <Field label={t("field.status")}>
          <div>
            <span
              className="inline-block rounded-full px-2 py-1 text-xs font-semibold"
              style={cruiseStatusPillStyle(shownStatus)}
            >
              {t(`status.${shownStatus}`, { defaultValue: shownStatus })}
            </span>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={status === "cancelled"}
              onChange={(e): void => setStatus(e.target.checked ? "cancelled" : "scheduled")}
            />
            {t("status.cancelledCheckbox")}
          </label>
        </Field>
      </div>

      {/* Cabin */}
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("field.cabinNumber")}>
          <input
            value={cabinNumber}
            onChange={(e): void => setCabinNumber(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label={t("field.cabinType")}>
          <select
            value={cabinType}
            onChange={(e): void => setCabinType(e.target.value as CabinType | "")}
            className={INPUT}
          >
            <option value="">—</option>
            {CABIN_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`cabinType.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("field.deck")}>
          <input
            type="number"
            value={deck}
            onChange={(e): void => setDeck(e.target.value)}
            className={INPUT}
          />
        </Field>
      </div>

      {/* Price + currency + booking ref */}
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("field.price")}>
          <input
            type="number"
            value={price}
            onChange={(e): void => setPrice(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label={t("field.currency")}>
          <CurrencySelect
            value={currency}
            onChange={setCurrency}
            recent={recentCurrencies}
            aria-label={t("field.currency")}
          />
        </Field>
        <Field label={t("field.bookingReference")}>
          <input
            value={bookingReference}
            onChange={(e): void => setBookingReference(e.target.value)}
            className={INPUT}
          />
        </Field>
      </div>

      <Field label={t("field.line")}>
        <CatalogueCombobox
          ariaLabel={t("field.line")}
          value={cruiseLine}
          onChange={setCruiseLine}
          search={searchCruiseLineOptions}
          inputClassName={INPUT}
          browseOnFocus
        />
      </Field>

      {/* Overview departure / arrival ports */}
      <div className="grid grid-cols-2 gap-3">
        <PortPicker
          label={t("field.departPort")}
          value={departurePort}
          onChange={setDeparturePort}
        />
        <PortPicker label={t("field.arrivePort")} value={arrivalPort} onChange={setArrivalPort} />
      </div>

      {/* Unmatched-port warning */}
      {entry.unmatchedPorts.length > 0 && (
        <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
          <strong>{t("import.unmatchedTitle")}:</strong>{" "}
          {entry.unmatchedPorts
            .map((p) => `${t("stops.day")} ${p.dayNumber}: ${p.portName}`)
            .join(", ")}
          <div className="mt-0.5 text-[11px] text-amber-300/80">{t("import.unmatchedHint")}</div>
        </div>
      )}

      {/* Itinerary */}
      <div>
        <button
          type="button"
          onClick={(): void => setShowStops((s) => !s)}
          className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm text-(--text-primary) hover:border-(--accent)"
        >
          <span>
            {t("import.stopsEdit")} · {portStops} {t("field.ports", { count: portStops })},{" "}
            {seaDays} {t("field.sea_days", { count: seaDays })}
          </span>
          <span>{showStops ? "▴" : "▾"}</span>
        </button>
        {showStops && (
          <div className="mt-3">
            <CruiseStopsEditor stops={stops} onChange={setStops} />
          </div>
        )}
      </div>

      {/* Fly & cruise flights */}
      {flights.length > 0 && (
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-(--text-primary)">
            ✈ {t("import.flightsTitle")}
            <span className="rounded-sm bg-(--accent-soft) px-1.5 py-0.5 text-[10px] text-(--accent)">
              {t("import.flightTentative")}
            </span>
          </div>
          <div className="space-y-3">
            {flights.map((f, i) => (
              <FlightCard key={i} flight={f} onChange={(patch): void => updateFlight(i, patch)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FlightCard({
  flight,
  onChange,
}: {
  flight: EditableFlight;
  onChange: (patch: Partial<EditableFlight>) => void;
}): JSX.Element {
  const { t } = useTranslation("cruise");
  const airportsMissing = flight.include && (!flight.depAirport || !flight.arrAirport);

  return (
    <div className="rounded-md border border-border bg-(--bg-surface) p-3">
      <div className="mb-2 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-(--text-primary)">
          <input
            type="checkbox"
            checked={flight.include}
            onChange={(e): void => onChange({ include: e.target.checked })}
          />
          {flight.direction === "return"
            ? t("import.flightReturn")
            : flight.direction === "outbound"
              ? t("import.flightOutbound")
              : t("import.flightLeg")}
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label={t("field.airline")}>
          <input
            value={flight.airline}
            onChange={(e): void => onChange({ airline: e.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label={t("field.flightNumber")}>
          <input
            value={flight.flightNumber}
            onChange={(e): void => onChange({ flightNumber: e.target.value })}
            className={INPUT}
          />
        </Field>
        <Field label={t("field.flightDate")}>
          <input
            type="date"
            value={flight.date}
            onChange={(e): void => onChange({ date: e.target.value })}
            style={{ colorScheme: "dark" }}
            className={INPUT}
          />
        </Field>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <AirportAutocomplete
          label={t("field.departPortAirport")}
          value={flight.depAirport}
          onChange={(a): void => onChange({ depAirport: a })}
        />
        <AirportAutocomplete
          label={t("field.arrivePortAirport")}
          value={flight.arrAirport}
          onChange={(a): void => onChange({ arrAirport: a })}
        />
      </div>

      <div className="mt-2">
        <Field label={t("field.flightClass")}>
          <select
            value={flight.seatClass}
            onChange={(e): void => onChange({ seatClass: e.target.value as SeatClass | "" })}
            className={INPUT}
          >
            <option value="">—</option>
            {SEAT_CLASSES.map((c) => (
              <option key={c} value={c}>
                {t(`seatClass.${c}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {airportsMissing && (
        <p className="mt-2 text-[11px] text-amber-300/90">{t("import.flightAirportsMissing")}</p>
      )}
    </div>
  );
}
