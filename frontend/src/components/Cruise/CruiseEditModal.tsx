import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import {
  isOutcomeUnknownSaveError,
  isTransientSaveError,
  saveErrorKey,
} from "../../lib/saveErrorMessage";
import { useSettingsStore } from "../../store/settingsStore";
import type { Cruise, CruiseStatus, CruiseStopInput, Port, Ship, Trip } from "../../types";
import { cruiseApi, tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { ShipPicker } from "./ShipPicker";
import { PortPicker } from "./PortPicker";
import { CruiseStopsEditor } from "./CruiseStopsEditor";
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";
import CatalogueCombobox from "../FlightForm/fields/CatalogueCombobox";
import { searchCruiseLineOptions } from "./cruiseLineOptions";
import { useTripPreselection } from "../../hooks/useTripPreselection";
import { useCruiseDateSuggestions } from "./useCruiseDateSuggestions";
import { suggestCruiseRouteName } from "./cruiseRouteName";
import { stopKeyAt } from "./cruiseStopKeys";
import {
  FieldError,
  FormErrorBanner,
  RequiredLegend,
  RequiredMark,
  SaveBlockedHint,
  fieldErrorProps,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { MissingStep } from "../form";
import {
  cruiseFieldErrors,
  cruiseFormFields,
  cruiseFormOpening,
  cruiseFormSnapshot,
  cruiseWriteBody,
  lacksIdentity,
  stopLacksPort,
} from "./cruiseFormDraft";
import type { CruiseFormFields } from "./cruiseFormDraft";
import {
  CRUISE_INPUT_CLASS,
  CRUISE_LABEL_CLASS,
  CruiseCabinSection,
  CruiseColorSection,
  CruiseCostsSection,
  CruiseMetaSection,
  FormSection,
} from "./CruiseFormSections";
import type { SetCruiseField } from "./CruiseFormSections";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  cruise?: Cruise;
  onClose: () => void;
  onSaved: (saved: Cruise) => void | Promise<void>;
  /**
   * What the "stored, but the follow-up failed" notice names. The list's
   * wording by default; the detail page passes the view's.
   */
  afterSaveFailedKey?: string;
  /**
   * Re-reads the caller's list WITHOUT closing this form — offered when a
   * create's answer was lost (`isOutcomeUnknownSaveError`), so the user can
   * look before sending again. Omitted where the caller cannot do that.
   */
  onReload?: () => void;
}

const SHIP_ID = "cruise-form-ship";
const LINE_ID = "cruise-form-line";
const ROUTE_ID = "cruise-form-route";
const START_ID = "cruise-form-start";
const END_ID = "cruise-form-end";
const HINT_ID = "cruise-form-save-blocked";
const IDENTITY_HINT_ID = "cruise-form-identity-hint";
const STOPS_PREFIX = "cruise-form-stops";

// color-scheme: dark tells the browser to render native picker widgets
// (calendar icon, spinners) in dark mode colors. Without it, date /
// datetime-local inputs render the TT.MM.JJJJ placeholder mask in a
// nearly-black color that is unreadable on our dark surface.
const DARK_PICKER_STYLE: React.CSSProperties = { colorScheme: "dark" };

/**
 * Modal for creating or editing a cruise — a single manual entry form.
 * Email/PDF import is the first route in the add-dialog (DomainImportPanel),
 * so this modal no longer carries its own import chooser.
 *
 * Save pattern (forgejo#245): **disabled save + `SaveBlockedHint`**. What the
 * server refuses outright — a new cruise without anything to recognise it by
 * or without a start date, and a day that is neither a port nor a sea day —
 * greys out "Speichern" and is named beside it; each item takes the cursor to
 * its field, unfolding the day it belongs to. Field rules (end before start,
 * deck, price) are checked on the click instead and land at their field.
 */
export function CruiseEditModal({
  mode,
  cruise,
  onClose,
  onSaved,
  afterSaveFailedKey,
  onReload,
}: Props): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);

  // ONE source for the starting values, read by the state AND the dirty guard.
  const [initial] = useState<CruiseFormFields>(() => cruiseFormFields(cruise, baseCurrency));
  const [draft, setDraft] = useState<CruiseFormFields>(initial);
  const set: SetCruiseField = useCallback(
    (key, value) => setDraft((prev) => ({ ...prev, [key]: value })),
    []
  );
  const setStops = useCallback((stops: CruiseStopInput[]): void => set("stops", stops), [set]);
  const setEndDate = useCallback((endDate: string): void => set("endDate", endDate), [set]);

  const onEndDateChange = useCruiseDateSuggestions({
    startDate: draft.startDate,
    stops: draft.stops,
    setStops,
    endDate: draft.endDate,
    setEndDate,
  });

  // Trip assignment. Unlike a flight — whose tripId is owned by the Trip
  // relation and applied through tripsApi.assignFlights AFTER the save — a
  // cruise owns its own tripId, so the choice travels in the cruise payload.
  // Loading the list is non-fatal on purpose: with no list the field simply
  // offers "no trip", which beats taking the whole dialog down over a lookup.
  const [trips, setTrips] = useState<Trip[]>([]);
  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getAll()
      .then((all) => {
        if (!cancelled) setTrips(all);
      })
      .catch((err: unknown) => {
        logger.warn("CruiseEditModal: failed to load trips", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** The trip the form itself suggested for a new cruise — not the user's change. */
  const [autoTripId, setAutoTripId] = useState<string | null>(null);
  const preselectTrip = useTripPreselection({
    enabled: mode === "create",
    trips,
    date: draft.startDate,
    value: draft.tripId,
    onChange: (tripId) => {
      set("tripId", tripId);
      setAutoTripId(tripId);
    },
  });
  const pickTrip = (tripId: string): void => {
    preselectTrip(tripId);
    setAutoTripId(null);
  };

  // The baseline is the form as it settles after opening (its own date
  // suggestions applied); a trip it preselected is no reason to ask either.
  // Computed once per opening and once per draft change, not on every render:
  // the snapshot walks every stop (review M7).
  const baseline = useMemo(() => cruiseFormSnapshot(cruiseFormOpening(initial)), [initial]);
  const draftKey = useMemo(() => JSON.stringify(cruiseFormSnapshot(draft)), [draft]);
  const guarded = useMemo(
    () =>
      cruiseFormSnapshot(
        autoTripId !== null && draft.tripId === autoTripId
          ? { ...draft, tripId: initial.tripId }
          : draft
      ),
    [autoTripId, draft, initial.tripId]
  );
  const { dirty, markSaved } = useDirtyGuard(baseline, guarded);
  const saving = useSaveOnce<Cruise>({ afterSaveFailedKey });
  const failure = useFormFailure(draftKey);

  const fieldErrors = failure.attempted ? cruiseFieldErrors(draft) : {};
  const endError = fieldErrors.endDate ? t(fieldErrors.endDate) : null;

  // What keeps "Speichern" greyed out, said beside it (forgejo#245).
  const missing: MissingStep[] = [
    ...(mode === "create" && lacksIdentity(draft, cruise?.shipNameOverride)
      ? [{ field: SHIP_ID, label: t("cruise:form.missing.identity") }]
      : []),
    ...(mode === "create" && !draft.startDate
      ? [{ field: START_ID, label: t("cruise:form.missing.startDate") }]
      : []),
    ...draft.stops.flatMap((stop, index) =>
      stopLacksPort(stop)
        ? [
            {
              field: `${STOPS_PREFIX}-${stopKeyAt(stop, index)}-port`,
              label: t("cruise:form.missing.stopPort", { day: stop.dayNumber }),
            },
          ]
        : []
    ),
  ];

  const routeNameSuggestion = draft.routeName
    ? ""
    : suggestCruiseRouteName(draft.departurePort, draft.stops, draft.arrivalPort);

  const onShipPicked = (ship: Ship): void => {
    setDraft((prev) => ({
      ...prev,
      ship,
      cruiseLine: prev.cruiseLine || ship.cruiseLine,
    }));
  };

  const handleSave = async (): Promise<void> => {
    failure.markAttempted();
    if (Object.keys(cruiseFieldErrors(draft)).length > 0) {
      failure.focusFirstProblem();
      return;
    }
    failure.clear();
    // The request and what follows it are two steps (forgejo#247): a list that
    // fails to reload must not turn a stored cruise into "konnte nicht
    // gespeichert werden" — the next click would have created it twice.
    const outcome = await saving.save(
      () =>
        mode === "create" || !cruise
          ? cruiseApi.create(cruiseWriteBody(draft))
          : cruiseApi.update(cruise.id, cruiseWriteBody(draft)),
      async (stored) => {
        markSaved();
        await onSaved(stored);
      }
    );
    if (outcome.status === "failed") {
      logger.error("CruiseEditModal: save failed", outcome.error);
      failure.fail(
        saveErrorKey(
          outcome.error,
          "cruise:form.saveError",
          {},
          { create: mode === "create" || !cruise }
        )
      );
    }
  };

  const headerTitle = mode === "create" ? t("form.createTitle") : t("form.editTitle");
  const required = mode === "create";

  // In the shared frame: header and buttons stay put, the body scrolls,
  // Escape closes it, and a changed form asks first (forgejo#248).
  return (
    <Modal
      open
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      closeLabel={t("common:buttons.close")}
      title={headerTitle}
      maxWidth={672}
      footer={(requestClose) =>
        // Stored, but the follow-up failed: the only honest action left is to
        // close. Another "Speichern" would send nothing (`useSaveOnce`).
        saving.afterSaveFailed ? (
          <>
            <p role="status" className="mr-auto self-center text-sm text-(--text-muted)">
              {t(saving.afterSaveFailedKey)}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim)"
            >
              {t("common:buttons.close")}
            </button>
          </>
        ) : (
          <>
            <div className="mr-auto self-center">
              <SaveBlockedHint id={HINT_ID} missing={missing} />
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving.saving}
              className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
            >
              {t("form.cancel")}
            </button>
            <button
              type="button"
              onClick={(): void => void handleSave()}
              disabled={saving.saving || saving.saved !== null || missing.length > 0}
              aria-describedby={HINT_ID}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
            >
              {saving.saving ? t("form.saving") : t("form.save")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef}>
        <FormSection
          title={
            <>
              {`${t("field.ship")} & ${t("field.line")}`}
              {required && (
                <>
                  {" "}
                  <RequiredMark />
                </>
              )}
            </>
          }
        >
          {required && (
            <p id={IDENTITY_HINT_ID} className="mb-3 text-xs text-(--text-muted)">
              {t("form.identityHint")}
            </p>
          )}
          <ShipPicker
            id={SHIP_ID}
            label={t("field.ship")}
            value={draft.ship}
            onChange={onShipPicked}
          />
          <div className={`mt-3 ${CRUISE_LABEL_CLASS}`}>
            <label htmlFor={LINE_ID}>{t("field.line")}</label>
            <CatalogueCombobox
              id={LINE_ID}
              value={draft.cruiseLine}
              onChange={(v): void => set("cruiseLine", v)}
              search={searchCruiseLineOptions}
              inputClassName={CRUISE_INPUT_CLASS}
              browseOnFocus
            />
          </div>
          <label className={`mt-3 ${CRUISE_LABEL_CLASS}`}>
            {t("field.routeName")}
            <input
              id={ROUTE_ID}
              className={CRUISE_INPUT_CLASS}
              value={draft.routeName}
              onChange={(e): void => set("routeName", e.target.value)}
            />
          </label>
          {/* Offered, never written on its own: a route name is the user's
              wording, and the ports only say what it could be. */}
          {routeNameSuggestion && (
            <button
              type="button"
              onClick={(): void => set("routeName", routeNameSuggestion)}
              className="mt-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent) pointer-coarse:min-h-(--ts-size-touch-min)"
            >
              {t("form.routeNameSuggestion", { name: routeNameSuggestion })}
            </button>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className={CRUISE_LABEL_CLASS}>
              <span>
                {t("field.startDate")}
                {required && (
                  <>
                    {" "}
                    <RequiredMark />
                  </>
                )}
              </span>
              <input
                id={START_ID}
                type="date"
                className={CRUISE_INPUT_CLASS}
                style={DARK_PICKER_STYLE}
                value={draft.startDate}
                onChange={(e): void => set("startDate", e.target.value)}
                aria-required={required || undefined}
              />
            </label>
            <div className="flex flex-col gap-1">
              <label className={CRUISE_LABEL_CLASS}>
                {t("field.endDate")}
                <input
                  id={END_ID}
                  type="date"
                  className={CRUISE_INPUT_CLASS}
                  style={DARK_PICKER_STYLE}
                  value={draft.endDate}
                  onChange={(e): void => onEndDateChange(e.target.value)}
                  {...fieldErrorProps(END_ID, endError)}
                />
              </label>
              <FieldError id={END_ID} error={endError} />
            </div>
          </div>
          {/* #status-from-dates: cruise write paths derive scheduled/
                in_progress/flown from the dates — a select just let the UI
                set a value the backend would immediately overwrite. Only
                "cancelled" stays user-controlled, via the checkbox below. */}
          <div className="mt-3">
            <span
              className="inline-block rounded-full px-2 py-1 text-xs font-semibold"
              style={cruiseStatusPillStyle(draft.status)}
            >
              {t(`status.${draft.status}`, { defaultValue: draft.status })}
            </span>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)">
            <input
              type="checkbox"
              checked={draft.status === "cancelled"}
              onChange={(e): void =>
                set("status", (e.target.checked ? "cancelled" : "scheduled") as CruiseStatus)
              }
              className="pointer-coarse:h-5 pointer-coarse:w-5"
            />
            {t("status.cancelledCheckbox")}
          </label>
        </FormSection>

        <CruiseColorSection color={draft.color} onChange={(c): void => set("color", c)} />

        <FormSection title={t("stops.title")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PortPicker
              id="cruise-form-departure-port"
              value={draft.departurePort}
              onChange={(p: Port): void => set("departurePort", p)}
              label={t("field.departure_port")}
            />
            <PortPicker
              id="cruise-form-arrival-port"
              value={draft.arrivalPort}
              onChange={(p: Port): void => set("arrivalPort", p)}
              label={t("field.arrival_port")}
            />
          </div>
          <div className="mt-3">
            <CruiseStopsEditor
              stops={draft.stops}
              onChange={setStops}
              idPrefix={STOPS_PREFIX}
              missingHintId={HINT_ID}
              startDate={draft.startDate}
            />
          </div>
        </FormSection>

        <CruiseCabinSection fields={draft} set={set} errors={fieldErrors} />
        <CruiseCostsSection fields={draft} set={set} errors={fieldErrors} />
        <CruiseMetaSection fields={draft} set={set} trips={trips} onPickTrip={pickTrip} />

        <FormErrorBanner
          message={failure.failureKey !== null ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey !== null && isTransientSaveError(failure.failureKey)
              ? (): void => void handleSave()
              : undefined
          }
          retryDisabled={saving.saving}
          onReload={
            failure.failureKey !== null && isOutcomeUnknownSaveError(failure.failureKey)
              ? onReload
              : undefined
          }
        />
        {required && <RequiredLegend className="mt-3" />}
      </div>
    </Modal>
  );
}
