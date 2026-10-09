import { useState, useEffect, useId, useRef } from "react";
import type { Flight } from "../types";
import TimesFields from "./FlightForm/fields/TimesFields";
import HistoricalToggleField from "./FlightForm/fields/HistoricalToggleField";
import { applyHistoricalToggle } from "./FlightForm/historicalToggle";
import { editSubmitZones, airportLocalInputs, storedZoneAt } from "./FlightForm/editModalDatetime";
import {
  EDIT_IDS,
  applyTripChange,
  buildEditFormData,
  buildEditUpdates,
  buildFlightAirports,
  editActualPairErrors,
  editFormGaps,
  editFormSnapshot,
} from "./FlightForm/editFormModel";
import { SERVER_TIME_FIELDS } from "./FlightForm/createFormState";
import { FLIGHT_FORM_TOUCH } from "./FlightForm/formTouch";
import { focusFirstMissingRequired } from "./FlightForm/requiredFields";
import {
  FormErrorBanner,
  RequiredLegend,
  SaveBlockedHint,
  useDirtyGuard,
  useFormFailure,
} from "./form";
import Modal from "./Modal";
import RouteFields from "./FlightForm/fields/RouteFields";
import HistoricalDateFields from "./FlightForm/fields/HistoricalDateFields";
import CatalogueCombobox, {
  searchAirlineOptions,
  searchAircraftOptions,
} from "./FlightForm/fields/CatalogueCombobox";
import BookingFields from "./FlightForm/fields/BookingFields";
import CostFields from "./FlightForm/fields/CostFields";
import { flightFormExtract, flightHints } from "../lib/extractTargets";
import TripSelectField from "./FlightForm/fields/TripSelectField";
import StatusField from "./FlightForm/fields/StatusField";
import { useAirportLocalTimes } from "./FlightForm/useAirportLocalTimes";
import CompanionsField from "./FlightForm/fields/CompanionsField";
import TagInput from "./TagInput";
import { splitTagText } from "../lib/tagList";
import { apiErrorMachineCode } from "../lib/apiError";
import SuggestionChips from "./common/SuggestionChips";
import { useFlightEntrySuggestions } from "../hooks/useFlightEntrySuggestions";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import { estimateArrivalFromDeparture } from "../lib/timeEstimation";
import { airportsApi } from "../lib/api/airports";
import { logger } from "../lib/logger";

import type { FlightInput } from "../types";
import type { Airport } from "../lib/api";
import { isTransientSaveError, saveErrorKey } from "../lib/saveErrorMessage";
import { flightArrival, flightDeparture } from "../lib/entityTimes";
import { storedFlightFolds, type FlightFolds } from "../lib/flightFolds";

interface FlightEditModalProps {
  flight: Flight;
  isOpen: boolean;
  onClose: () => void;
  /** Stores the update. Must NOT close the dialog: the dialog closes itself
   *  once the trip assignment that follows the save has gone through too. */
  onSave: (id: string, updates: Partial<FlightInput>) => Promise<void>;
  /** After the save and the trip assignment — the caller reloads its view. */
  onAfterSave?: () => void;
}

export default function FlightEditModal({
  flight,
  isOpen,
  onClose,
  onSave,
  onAfterSave,
}: FlightEditModalProps): JSX.Element | null {
  const { t } = useTranslation(["flights", "common", "errors"]);
  const { features } = useSettingsStore();

  const [formData, setFormData] = useState(() => buildEditFormData(flight));
  // Q5: the occurrence of a repeated hour the flight was stored with, re-sent unless changed.
  const [folds, setFolds] = useState<FlightFolds>(() =>
    storedFlightFolds(flightDeparture(flight), flightArrival(flight))
  );
  const [loading, setLoading] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  // Editable departure/arrival airports — changing either feeds a new code
  // into useAirportLocalTimes below, which re-resolves that side's zone.
  const [departureAirport, setDepartureAirport] = useState<Airport | null>(
    () => buildFlightAirports(flight).departure
  );
  const [arrivalAirport, setArrivalAirport] = useState<Airport | null>(
    () => buildFlightAirports(flight).arrival
  );

  // Airport timezones for the departure/arrival fields. The inputs are seeded
  // from `times` (the airports' clocks) by buildFormData and re-derived once
  // useAirportLocalTimes resolves both zones (the sync effect below);
  // `hydrated` says whether that happened, so submit pairs them with the
  // matching zones. Before it, the hook reports a placeholder zone that is
  // never submitted (editSubmitZones) nor used for a notice — not the
  // browser's, which is no airport's.
  const browserTz = "UTC";
  const {
    depTimezone: depTz,
    arrTimezone: arrTz,
    hydrated,
  } = useAirportLocalTimes({
    isOpen,
    depCode: departureAirport?.iata || departureAirport?.icao || null,
    arrCode: arrivalAirport?.iata || arrivalAirport?.icao || null,
    browserTimezone: browserTz,
    depKnownZone: storedZoneAt(
      departureAirport,
      flight.depIata,
      flight.depIcao,
      flight.depTimezone
    ),
    arrKnownZone: storedZoneAt(arrivalAirport, flight.arrIata, flight.arrIcao, flight.arrTimezone),
  });

  // The airport zones the inputs were last rendered in (hydration effect).
  const lastZones = useRef<{ dep: string; arr: string } | null>(null);

  const suggestions = useFlightEntrySuggestions({
    enabled: isOpen,
    airline: formData.airline,
    dep: departureAirport?.iata || departureAirport?.icao,
    arr: arrivalAirport?.iata || arrivalAirport?.icao,
  });

  const update = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  const canEstimateArrival = Boolean(
    formData.departureDate && formData.departureTime && formData.status !== "historical"
  );

  const handleEstimateArrival = async (): Promise<void> => {
    if (!formData.departureDate || !formData.departureTime) return;

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
      departureDate: formData.departureDate,
      departureTime: formData.departureTime,
      departureLat: flight.depLat,
      departureLon: flight.depLon,
      departureTimezone: depTz,
      arrivalLat: flight.arrLat,
      arrivalLon: flight.arrLon,
      arrivalTimezone: arrTz,
    });

    // Both arrival fields land in a single update — see the hydration effect
    // below for why a half-converted date/time pair must never be observable.
    setFormData((prev) => ({
      ...prev,
      arrivalDate: result.arrivalDate,
      arrivalTime: result.arrivalTime,
    }));
    if (!result.tzAware) {
      addToast("warning", t("flights:form.estimateTzUnknown"));
    }
  };

  useEffect(() => {
    setFormData(buildEditFormData(flight));
    const airports = buildFlightAirports(flight);
    setDepartureAirport(airports.departure);
    setArrivalAirport(airports.arrival);
  }, [flight]);

  // Once useAirportLocalTimes resolves BOTH zones, re-render the date/time
  // inputs as airport-local. The submit contract and the arrival estimate
  // already treat these fields as airport-local, so this makes the whole
  // modal consistent and fixes the open->save no-op drift. Re-applies
  // whenever the flight changes (even if the resolved zones don't, e.g. same
  // route on a different flight) so the wall clock always reflects the
  // current flight's stored instant.
  //
  // All four fields land in ONE setFormData call — never two — because a
  // render that observed departure split from arrival (or date split from
  // time) would pair a wall clock from one zone basis with a timezone from
  // another on the next submit. See FlightEditModal.timezone.test.tsx.
  useEffect(() => {
    if (!hydrated) return;
    lastZones.current = { dep: depTz, arr: arrTz };
    setFormData((prev) => ({ ...prev, ...airportLocalInputs(flight, depTz, arrTz) }));
  }, [hydrated, depTz, arrTz, flight]);

  // The time inputs as stored — the seed, and the airport-local reading once
  // the zones resolved: neither is the user's change (editFormSnapshot).
  const storedTimes = [
    buildEditFormData(flight),
    ...(hydrated ? [airportLocalInputs(flight, depTz, arrTz)] : []),
    ...(lastZones.current
      ? [airportLocalInputs(flight, lastZones.current.dep, lastZones.current.arr)]
      : []),
  ];
  const snapshot = editFormSnapshot(
    formData,
    storedTimes,
    { departure: departureAirport, arrival: arrivalAirport },
    folds
  );
  const [initialSnapshot] = useState(snapshot);
  const { dirty, markSaved } = useDirtyGuard(initialSnapshot, snapshot, { open: isOpen });

  /**
   * Pattern: "enabled save, a refused click focuses the first gap" — the
   * create form's (forgejo#245), so creating and editing a flight answer a
   * missing time the same way. What is missing is listed beside the save.
   */
  const formId = useId();
  const hintId = `${formId}-blocked`;
  const missing = editFormGaps(formData, t);
  const failure = useFormFailure(JSON.stringify(snapshot));
  const [serverField, setServerField] = useState<string | null>(null);
  const serverTimeField =
    failure.failureKey && serverField ? SERVER_TIME_FIELDS[serverField] : undefined;
  const timeErrors = {
    ...(failure.attempted ? editActualPairErrors(formData, t) : {}),
    ...(serverTimeField ? { [serverTimeField]: t(failure.failureKey!) } : {}),
  };
  // The flight is stored; only the trip assignment after it failed.
  const [savedTripFailed, setSavedTripFailed] = useState(false);
  const inFlight = useRef(false);

  const finishAfterSave = async (): Promise<void> => {
    try {
      // Trip assignment lives on its own endpoint and runs only after the save
      // went through, so a refused save never moves the flight between trips.
      const changed = await applyTripChange(flight, formData.tripId);
      if (changed) addToast("success", t("flights:edit.tripAssignedToast"));
    } catch (tripErr) {
      logger.warn("Failed to update trip assignment:", tripErr);
      // Said in the dialog, which stays open: it used to be set on a dialog
      // its caller had already closed, so nobody ever saw it.
      setSavedTripFailed(true);
      onAfterSave?.();
      return;
    }
    onAfterSave?.();
    onClose();
  };

  const handleSubmit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    failure.markAttempted();
    if (missing.length > 0) {
      // A required field first; otherwise the half-filled actual pair, whose
      // error renders with this click.
      if (!focusFirstMissingRequired(failure.rootRef.current)) failure.focusFirstProblem();
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    failure.clear();
    try {
      // The airports' zones once both resolved; null = send no time at all.
      const last = lastZones.current;
      const zones = editSubmitZones({ hydrated, depTz, arrTz }, formData, [
        buildEditFormData(flight),
        ...(last ? [airportLocalInputs(flight, last.dep, last.arr)] : []),
      ]);
      await onSave(
        flight.id,
        buildEditUpdates({ formData, flight, zones, folds, departureAirport, arrivalAirport })
      );
      markSaved();
    } catch (err: unknown) {
      // Not `err.message`: for a refused save that is axios's own
      // "Request failed with status code 400", in English.
      const data = (err as { response?: { data?: { field?: unknown } } } | null)?.response?.data;
      setServerField(
        apiErrorMachineCode(err) && typeof data?.field === "string" ? data.field : null
      );
      failure.fail(saveErrorKey(err, "errors:updateFailed"));
      return;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
    await finishAfterSave();
  };

  // The shared frame brings the close button, Escape, the scroll lock and the
  // focus return. The actions sit in its footer (as in the create form), tied
  // to the form by `form=`, so "Abbrechen" goes through the discard question.
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      busy={loading}
      dirty={dirty && !savedTripFailed}
      maxWidth={672}
      closeLabel={t("common:buttons.close")}
      title={
        <span className="flex flex-col">
          <span className="text-xl font-bold">{t("flights:edit.title")}</span>
          <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>
            {departureAirport?.iata || departureAirport?.icao} {t("common:labels.routeSeparator")}{" "}
            {arrivalAirport?.iata || arrivalAirport?.icao}
          </span>
        </span>
      }
      footer={(requestClose) =>
        savedTripFailed ? (
          <>
            <p role="status" className="mr-auto self-center text-sm text-[var(--text-muted)]">
              {t("flights:edit.savedTripAssignFailed")}
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSavedTripFailed(false);
                void finishAfterSave();
              }}
            >
              {t("common:buttons.retry")}
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              {t("common:buttons.close")}
            </button>
          </>
        ) : (
          <>
            <div className="mr-auto self-center">
              <SaveBlockedHint id={hintId} missing={missing} />
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="btn-secondary"
              disabled={loading}
            >
              {t("common:buttons.cancel")}
            </button>
            <button
              type="submit"
              form={formId}
              disabled={loading}
              className="btn-primary"
              aria-describedby={hintId}
            >
              {loading ? t("common:buttons.saving") : t("flights:edit.saveChanges")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef}>
        <form
          id={formId}
          onSubmit={(e) => void handleSubmit(e)}
          className={`space-y-4 ${FLIGHT_FORM_TOUCH}`}
        >
          {/* Announced and focusable (forgejo#246); a time the server refused is
            shown at that time instead. */}
          <FormErrorBanner
            message={failure.failureKey && !serverTimeField ? t(failure.failureKey) : null}
            onRetry={
              failure.failureKey && isTransientSaveError(failure.failureKey)
                ? () => void handleSubmit()
                : undefined
            }
            retryDisabled={loading}
          />

          {/* Changing either side re-resolves its timezone (useAirportLocalTimes above). */}
          <RouteFields
            departure={departureAirport}
            arrival={arrivalAirport}
            onDepartureChange={setDepartureAirport}
            onArrivalChange={setArrivalAirport}
            ids={{ departure: EDIT_IDS.departureAirport, arrival: EDIT_IDS.arrivalAirport }}
          />

          {/* The way out of "historical" — see HistoricalToggleField and
              applyHistoricalToggle for why each exists. */}
          <HistoricalToggleField
            id="editHistoricalToggle"
            checked={formData.status === "historical"}
            onChange={(checked) => setFormData((prev) => applyHistoricalToggle(prev, checked))}
          />

          {/* Date & Time — year/month/day for historical (shared with the
              create form via HistoricalDateFields, so a DATE_ONLY flight's
              known day is editable instead of being rewritten to 01),
              split date+time for others */}
          {formData.status === "historical" ? (
            <HistoricalDateFields
              value={formData.departureDate}
              onChange={(next) =>
                setFormData((prev) => ({
                  ...prev,
                  departureDate: next,
                  arrivalDate: next,
                  departureTime: "",
                  arrivalTime: "",
                }))
              }
              idPrefix="edit"
            />
          ) : (
            <TimesFields
              value={{
                depDate: formData.departureDate,
                depTime: formData.departureTime,
                arrDate: formData.arrivalDate,
                arrTime: formData.arrivalTime,
              }}
              onChange={(next) =>
                setFormData((prev) => ({
                  ...prev,
                  departureDate: next.depDate,
                  departureTime: next.depTime,
                  arrivalDate: next.arrDate,
                  arrivalTime: next.arrTime,
                }))
              }
              onEstimateArrival={() => void handleEstimateArrival()}
              canEstimateArrival={canEstimateArrival}
              ids={{
                depDate: "editDepartureDate",
                depTime: "editDepartureTime",
                arrDate: "editArrivalDate",
                arrTime: "editArrivalTime",
                actualDepDate: "editActualDepartureDate",
                actualDepTime: "editActualDepartureTime",
                actualArrDate: "editActualArrivalDate",
                actualArrTime: "editActualArrivalTime",
              }}
              actualValue={{
                actualDepDate: formData.actualDepartureDate,
                actualDepTime: formData.actualDepartureTime,
                actualArrDate: formData.actualArrivalDate,
                actualArrTime: formData.actualArrivalTime,
              }}
              clockChange={
                hydrated
                  ? { depZone: depTz, arrZone: arrTz, folds, onFoldsChange: setFolds }
                  : undefined
              }
              markRequired
              errors={timeErrors}
              onActualChange={(next) =>
                setFormData((prev) => ({
                  ...prev,
                  actualDepartureDate: next.actualDepDate,
                  actualDepartureTime: next.actualDepTime,
                  actualArrivalDate: next.actualArrDate,
                  actualArrivalTime: next.actualArrTime,
                }))
              }
            />
          )}

          {/* Airline / Operating / FlightNo */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor={EDIT_IDS.airline}>
                {t("flights:form.airline")}
              </label>
              <CatalogueCombobox
                id={EDIT_IDS.airline}
                value={formData.airline}
                onChange={(v) => update("airline", v)}
                search={searchAirlineOptions}
                placeholder={t("flights:form.placeholders.airline")}
              />
            </div>

            <div>
              <label className="label" htmlFor={EDIT_IDS.operatingAirline}>
                {t("flights:form.operatingAirline")}
              </label>
              <CatalogueCombobox
                id={EDIT_IDS.operatingAirline}
                value={formData.operatingAirline}
                onChange={(v) => update("operatingAirline", v)}
                search={searchAirlineOptions}
                placeholder={t("flights:form.placeholders.operatingAirline")}
              />
            </div>

            <div>
              <label className="label" htmlFor={EDIT_IDS.flightNumber}>
                {t("flights:form.flightNumber")}
              </label>
              <input
                id={EDIT_IDS.flightNumber}
                type="text"
                value={formData.flightNumber}
                onChange={(e) => update("flightNumber", e.target.value.toUpperCase())}
                className="input"
                placeholder={t("flights:form.placeholders.flightNumber")}
                maxLength={10}
              />
              <SuggestionChips
                value={formData.flightNumber}
                suggestions={suggestions.flightNumbers}
                onPick={(v) => update("flightNumber", v)}
                fieldLabel={t("flights:form.flightNumber")}
              />
            </div>
          </div>

          {/* Aircraft */}
          <div>
            <label className="label" htmlFor={EDIT_IDS.aircraft}>
              {t("flights:form.aircraft")}
            </label>
            <CatalogueCombobox
              id={EDIT_IDS.aircraft}
              value={formData.aircraft}
              onChange={(v) => update("aircraft", v)}
              search={searchAircraftOptions}
              placeholder={t("flights:form.placeholders.aircraft")}
            />
          </div>

          {/* Status / Category / Seat Class */}
          <div className="grid grid-cols-3 gap-4">
            <StatusField status={formData.status} onStatusChange={(v) => update("status", v)} />

            <div>
              <label className="label" htmlFor={EDIT_IDS.category}>
                {t("flights:form.category")}
              </label>
              <select
                id={EDIT_IDS.category}
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

            <TripSelectField
              value={formData.tripId}
              onChange={(v) => update("tripId", v)}
              hint={t("flights:edit.tripHint")}
            />

            <div>
              <label className="label" htmlFor={EDIT_IDS.seatClass}>
                {t("flights:form.seatClass")}
              </label>
              <select
                id={EDIT_IDS.seatClass}
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
              <label className="label" htmlFor={EDIT_IDS.seat}>
                {t("flights:form.seat")}
              </label>
              <input
                id={EDIT_IDS.seat}
                type="text"
                value={formData.seatNumber}
                onChange={(e) => update("seatNumber", e.target.value.toUpperCase())}
                className="input"
                placeholder={t("flights:form.placeholders.seat")}
              />
              <SuggestionChips
                value={formData.seatNumber}
                suggestions={suggestions.seats}
                onPick={(v) => update("seatNumber", v)}
                fieldLabel={t("flights:form.seat")}
              />
            </div>
            <div>
              <label className="label" htmlFor={EDIT_IDS.gate}>
                {t("flights:form.gate")}
              </label>
              <input
                id={EDIT_IDS.gate}
                type="text"
                value={formData.gate}
                onChange={(e) => update("gate", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.gate")}
              />
            </div>
            <div>
              <label className="label" htmlFor={EDIT_IDS.terminal}>
                {t("flights:form.terminal")}
              </label>
              <input
                id={EDIT_IDS.terminal}
                type="text"
                value={formData.terminal}
                onChange={(e) => update("terminal", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.terminal")}
              />
              <SuggestionChips
                value={formData.terminal}
                suggestions={suggestions.departureTerminals}
                onPick={(v) => update("terminal", v)}
                fieldLabel={t("flights:form.terminal")}
              />
            </div>
            <div>
              <label className="label" htmlFor={EDIT_IDS.boardingGroup}>
                {t("flights:form.boardingGroup")}
              </label>
              <input
                id={EDIT_IDS.boardingGroup}
                type="text"
                value={formData.boardingGroup}
                onChange={(e) => update("boardingGroup", e.target.value)}
                className="input"
                placeholder={t("flights:form.placeholders.boardingGroup")}
                maxLength={20}
              />
            </div>
          </div>

          {/* Booking (#197, #199) — shared with the create form */}
          <BookingFields
            value={{
              bookingReference: formData.bookingReference,
              ticketNumber: formData.ticketNumber,
              bookingClassLetter: formData.bookingClassLetter,
              baggageAllowance: formData.baggageAllowance,
              frequentFlyerNumber: formData.frequentFlyerNumber,
            }}
            onChange={(v) => setFormData((prev) => ({ ...prev, ...v }))}
            frequentFlyerSuggestion={suggestions.frequentFlyerNumber}
          />

          {/* Companions */}
          <CompanionsField
            companions={formData.companions}
            onCompanionsChange={(v) => update("companions", v)}
            coPassengers={flight.coPassengers}
          />

          {/* Cost (#192, #199) — shared with the create form. The modal's own
              state now speaks the same undefined-means-unrecorded language
              CostFields does, so nothing is converted here and a 0 survives
              the round trip (SRV-UI-001). */}
          <CostFields
            value={{
              price: formData.price,
              currency: formData.currency || "EUR",
              taxes: formData.taxes,
              fees: formData.fees,
              receiptUrl: formData.receiptUrl,
            }}
            onChange={(v) =>
              setFormData((prev) => ({
                ...prev,
                price: v.price,
                currency: v.currency,
                taxes: v.taxes,
                fees: v.fees,
                receiptUrl: v.receiptUrl,
              }))
            }
            showBreakdown={features.enableCostTracking}
            receiptExtract={flightFormExtract(flightHints(flight), formData, (v) =>
              setFormData((prev) => ({ ...prev, ...v }))
            )}
          />

          {/* Tags */}
          <div>
            <label className="label">{t("flights:form.tags")}</label>
            <TagInput
              value={splitTagText(formData.tags)}
              onChange={(tags) => update("tags", tags.join(", "))}
              ariaLabel={t("flights:form.tags")}
              placeholder={t("flights:form.placeholders.tags")}
            />
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {t("flights:form.tagsHint")}
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="label" htmlFor={EDIT_IDS.notes}>
              {t("common:labels.notes")}
            </label>
            <textarea
              id={EDIT_IDS.notes}
              value={formData.notes}
              onChange={(e) => update("notes", e.target.value)}
              className="input"
              rows={3}
              placeholder={t("flights:form.placeholders.notes")}
            />
          </div>

          <RequiredLegend />
        </form>
      </div>
    </Modal>
  );
}
