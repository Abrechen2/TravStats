import CurrencySelect from "../common/CurrencySelect";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useEffect, useState, useCallback } from "react";
import type { JSX, ReactNode } from "react";
import type { ParsedCruiseEntry, ParsedFlightSuggestion } from "../../lib/api/parse";
import type {
  CabinType,
  CruiseInput,
  CruiseStatus,
  CruiseStopInput,
  FlightInput,
  Port,
  Ship,
  TripStatus,
} from "../../types";
// AirportAutocomplete + airportsApi use the lib/api Airport (stricter `name`);
// use the same one so its value/onChange line up, then it flows into FlightInput.
import type { Airport } from "../../lib/api";
import { cruiseApi } from "../../lib/api/cruise";
import { flightsApi } from "../../lib/api/flights";
import { tripsApi } from "../../lib/api/trips";
import { createImportBatch } from "../../lib/api/importBatches";
import { useToastStore } from "../../store/toastStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { ShipPicker } from "./ShipPicker";
import { PortPicker } from "./PortPicker";
import { CruiseStopsEditor } from "./CruiseStopsEditor";
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";
import AirportAutocomplete from "../AirportAutocomplete";

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
const toIsoNoon = (d: string): string | undefined => (d ? `${d}T12:00:00.000Z` : undefined);

interface EntryData {
  input: CruiseInput;
  flightInputs: FlightInput[];
  tripLabel: string;
}

/**
 * Derive the auto-created trip's date span + status from the imported cruises.
 * Without an explicit status the backend falls back to the Trip Prisma default
 * ("completed"), which mislabels an upcoming fly & cruise booking — an
 * embarkation two days from now would otherwise show as "Abgeschlossen".
 */
export function deriveTripMeta(
  data: EntryData[],
  now: Date
): { startDate?: string; endDate?: string; status: TripStatus } {
  const starts = data.map((e) => e.input.startDate).filter((d): d is string => !!d);
  const ends = data.map((e) => e.input.endDate).filter((d): d is string => !!d);
  const startDate = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : undefined;
  const endDate = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : undefined;

  let status: TripStatus = "completed";
  if (startDate && new Date(startDate) > now) status = "planned";
  else if (endDate && new Date(endDate) < now) status = "completed";
  else if (startDate) status = "in_progress";

  return { startDate, endDate, status };
}

/**
 * Post-parse review for imported cruises + bundled fly & cruise flights.
 * Each cruise is an editable audit card; detected flights become opt-in
 * editable cards; everything can be grouped into one Trip on save.
 */

/**
 * A 409 from `POST /cruises` means the server already holds this booking —
 * the ordinary answer to re-reading a forwarded confirmation. Recognised by
 * the fixed code rather than by prose, so a reworded message never turns a
 * known outcome back into an unexplained failure.
 */
function isAlreadyImported(err: unknown): boolean {
  const res = (err as { response?: { status?: number; data?: { error?: string } } }).response;
  return res?.status === 409 && res.data?.error === "already_imported";
}

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
    entries.map((e) => ({ input: e.input, flightInputs: [], tripLabel: "" }))
  );
  const anyFlightsDetected = entries.some((e) => (e.flights?.length ?? 0) > 0);
  const [groupAsTrip, setGroupAsTrip] = useState(anyFlightsDetected || entries.length > 1);
  const [tripName, setTripName] = useState("");

  const handleEntryChange = useCallback((idx: number, data: EntryData): void => {
    setEntryData((prev) => prev.map((p, i) => (i === idx ? data : p)));
  }, []);

  const totalFlights = entryData.reduce((n, e) => n + e.flightInputs.length, 0);
  const defaultTripName = entryData[0]?.tripLabel || t("cruise:import.tripDefault");
  const showTripToggle = anyFlightsDetected || entries.length > 1;

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const allFlights = entryData.flatMap((e) => e.flightInputs);
      let tripId: string | undefined;
      if (groupAsTrip && (allFlights.length > 0 || entryData.length > 1)) {
        const trip = await tripsApi.create({
          name: tripName.trim() || defaultTripName,
          ...deriveTripMeta(entryData, new Date()),
        });
        tripId = trip.id;
      }

      // One import, one entry in the log — and a booking that was already read
      // once is counted, not created twice. A batch that cannot be created
      // must not cost the user their import, so it falls back to unbatched.
      let batchId: string | null = null;
      try {
        batchId = await createImportBatch("cruise", "email", sourceFileName ?? null);
      } catch (err: unknown) {
        logger.error("CruiseImportPreviewModal: import batch create failed", err);
      }

      let alreadyThere = 0;
      for (const e of entryData) {
        try {
          await cruiseApi.create({ ...e.input, tripId, importBatchId: batchId });
        } catch (err: unknown) {
          // 409 is the server saying "you already have this one" — the normal
          // answer to re-reading a forwarded confirmation, not a failure.
          if (isAlreadyImported(err)) {
            alreadyThere += 1;
            continue;
          }
          throw err;
        }
      }

      const flightIds: string[] = [];
      for (const f of allFlights) {
        const created = await flightsApi.create(f, { force: true });
        if (created.id) flightIds.push(created.id);
      }
      if (tripId && flightIds.length > 0) {
        await tripsApi.assignFlights(tripId, { flightIds, action: "add" });
      }

      if (alreadyThere > 0) {
        addToast("info", t("cruise:import.alreadyImported", { count: alreadyThere }));
      }
      addToast(
        "success",
        allFlights.length > 0
          ? t("cruise:import.savedWithFlights", {
              cruises: entryData.length,
              flights: allFlights.length,
            })
          : t("cruise:import.saved", { count: entryData.length })
      );
      await onSaved();
    } catch (err: unknown) {
      logger.error("CruiseImportPreviewModal: save failed", err);
      addToast("error", t("cruise:import.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-(--bg-surface) p-6">
        <h2 className="mb-1 text-xl font-semibold text-(--text-primary)">
          {t("cruise:import.previewTitle", { count: entries.length })}
        </h2>
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

        <div className="mt-6 flex items-center justify-between gap-3">
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
      </div>
    </div>
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
    const builtInput: CruiseInput = {
      shipId: ship?.id ?? undefined,
      shipNameOverride: ship ? undefined : (overrideName ?? undefined),
      cruiseLine: cruiseLine.trim() || undefined,
      routeName: routeName.trim() || undefined,
      departurePortId: departurePort?.id ?? undefined,
      arrivalPortId: arrivalPort?.id ?? undefined,
      startDate: toIsoNoon(startDate),
      endDate: toIsoNoon(endDate),
      status,
      cabinNumber: cabinNumber.trim() || undefined,
      cabinType: cabinType || undefined,
      deck: deck ? Number(deck) : undefined,
      bookingReference: bookingReference.trim() || undefined,
      price: price ? Number(price) : undefined,
      currency: (currency as CruiseInput["currency"]) || undefined,
      stops: stops.map(({ port: _port, ...rest }) => rest),
    };

    const userTz = useSettingsStore.getState().display?.timezone || "UTC";
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
          departureLocal: `${f.date}T00:00`,
          depTimezone: dep.timezone || userTz,
          arrivalLocal: `${f.date}T00:00`,
          arrTimezone: arr.timezone || userTz,
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

    onChange(index, { input: builtInput, flightInputs, tripLabel });
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

  return (
    <div className="space-y-3 rounded-lg border border-border bg-(--bg-base) p-4">
      {/* Ship */}
      <div>
        <label className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-(--text-muted)">
          {t("field.ship")}
          {ship ? (
            <span className="rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] normal-case text-emerald-300">
              ✓ {t("import.shipMatched")}
            </span>
          ) : overrideName ? (
            <span
              className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] normal-case text-amber-300"
              title={t("import.shipUnmatchedHint")}
            >
              ⚠ {t("import.shipUnmatched")}
            </span>
          ) : (
            <span className="rounded-sm bg-red-500/15 px-1.5 py-0.5 text-[10px] normal-case text-red-300">
              {t("import.missing")}
            </span>
          )}
        </label>
        <ShipPicker value={ship} onChange={setShip} />
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
              style={cruiseStatusPillStyle(status)}
            >
              {t(`status.${status}`, { defaultValue: status })}
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
        <input
          value={cruiseLine}
          onChange={(e): void => setCruiseLine(e.target.value)}
          className={INPUT}
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
