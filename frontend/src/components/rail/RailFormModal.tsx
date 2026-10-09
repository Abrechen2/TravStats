import { useEffect, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTripPreselection } from "../../hooks/useTripPreselection";
import { useTranslation } from "../../hooks/useTranslation";
import { railApi } from "../../lib/api/rail";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { isTransientSaveError } from "../../lib/saveErrorMessage";
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
import type { Trip } from "../../types";
import type { RailJourney } from "../../types/rail";
import SuggestionChips from "../common/SuggestionChips";
import { ClockChangeNotice } from "../common/ClockChangeNotice";
import { trainLabel, useRailEntrySuggestions } from "../../hooks/useRailEntrySuggestions";
import { StationPicker } from "./StationPicker";
import { RailLookupPanel } from "./RailLookupPanel";
import { RailFormDetails } from "./RailFormDetails";
import { INPUT_CLASS, LabelledInput, Section } from "./railFormFields";
import type { RailStationDraft } from "./RailStationField";
import {
  canSubmit,
  connectionDraftFrom,
  dayPart,
  draftFrom,
  geometryNotice,
  hasDayOnlyEnd,
  isStationComplete,
  knownStationZone,
  onwardDraftFrom,
  railFieldId,
  saveErrorFrom,
  toRailInput,
  withClock,
  type RailFormDraft,
  type RailFormErrorField,
  type RailSaveError,
} from "./railFormModel";

interface Props {
  journey: RailJourney | null;
  /** A prefilled new leg — the connection the detail page asked for. */
  initialDraft?: RailFormDraft;
  /** The leg a new journey continues; the server binds both via a booking. */
  connectsFrom?: string;
  onClose: () => void;
  onSaved: (saved: RailJourney) => void | Promise<void>;
  /**
   * Called when "save and add a connection" saved a leg and the dialog stays
   * open for the next one — the caller refreshes, but does not close.
   */
  onProgress?: (saved: RailJourney) => void | Promise<void>;
  /**
   * What the "stored, but the follow-up failed" notice names: the list by
   * default; the detail page passes the view's wording.
   */
  afterSaveFailedKey?: string;
}

const HINT_ID = "rail-form-save-blocked";
/** The time inputs' ids — `saveErrorFrom` names a refused time by these fields. */
const TIME_ID = {
  departureLocal: railFieldId("departureLocal"),
  arrivalLocal: railFieldId("arrivalLocal"),
};
/** A checkbox row a finger can hit on a coarse pointer. */
const CHECK_ROW = "flex items-center gap-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)";

/** A notice about the line is read, not glanced at — longer than a "saved". */
const NOTICE_MS = 12_000;

// Native date/time pickers render their mask unreadably dark on our surface
// without it — the same note the cruise form carries.
const DARK_PICKER_STYLE = { colorScheme: "dark" } as const;

/**
 * Create or edit one train ride (spec 2026-09-25-rail-domain, phase 1).
 *
 * Times are entered on each station's own clock and sent without an offset;
 * the server finds the zone from the station and stores the instant. The
 * status is not a field: it follows from the times, and only a cancellation
 * is the user's to state — the same rule the cruise form follows.
 *
 * Shared form blocks (forgejo#245–#249), pattern "disabled save +
 * `SaveBlockedHint`": both save buttons stay greyed out until the stations
 * and the departure are there, and the line beside them says which is
 * missing. A refusal by the server is shown at its time field or in the
 * banner, until the next edit; a save is sent once (`useSaveOnce`), and a
 * changed form asks before it is discarded.
 */
export function RailFormModal({
  journey: initialJourney,
  initialDraft,
  connectsFrom: initialConnectsFrom,
  onClose,
  onSaved,
  onProgress,
  afterSaveFailedKey,
}: Props): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  // The dialog can move on to the next leg without closing, so what it edits
  // and what it continues are state, seeded from the props.
  const [journey, setJourney] = useState<RailJourney | null>(initialJourney);
  const [connectsFrom, setConnectsFrom] = useState<RailJourney | string | undefined>(
    initialConnectsFrom
  );
  const [formKey, setFormKey] = useState(0);
  const [draft, setDraft] = useState<RailFormDraft>(
    () => initialDraft ?? draftFrom(initialJourney)
  );
  /** The draft as the ride opened, to tell a time changed away and back from one really changed. */
  const [opened, setOpened] = useState<RailFormDraft>(
    () => initialDraft ?? draftFrom(initialJourney)
  );
  const [trips, setTrips] = useState<Trip[]>([]);
  /** Which typed coordinate of each station `LocationInput` refused, if any. */
  const [depBad, setDepBad] = useState<"lat" | "lon" | null>(null);
  const [arrBad, setArrBad] = useState<"lat" | "lon" | null>(null);
  const depValid = depBad === null;
  const arrValid = arrBad === null;
  /** The last refusal; shown only while `failure` still holds it (until the next edit). */
  const [refusal, setRefusal] = useState<RailSaveError | null>(null);
  /** Which button the refused save came from, so "Erneut versuchen" repeats it. */
  const [retryConnect, setRetryConnect] = useState(false);
  /** "Save and add a connection" stored the leg, but the list did not reload. */
  const [progressRefreshFailed, setProgressRefreshFailed] = useState(false);
  /** The trip the form itself suggested for a new ride — not the user's change. */
  const [autoTripId, setAutoTripId] = useState<string | null>(null);
  // The baseline is the ride as the dialog OPENED it (or the next leg it
  // moved on to), the same draft the form starts from. A trip the form
  // preselected on its own is no reason to ask "discard changes?".
  const {
    dirty,
    markSaved,
    reset: resetDirty,
  } = useDirtyGuard(
    opened,
    autoTripId !== null && draft.tripId === autoTripId ? { ...draft, tripId: opened.tripId } : draft
  );
  const saving = useSaveOnce<RailJourney>({ afterSaveFailedKey });
  const failure = useFormFailure(JSON.stringify(draft));
  /** Where the ride continues after a change the lookup revealed. */
  const [onward, setOnward] = useState<RailStationDraft | null>(null);

  const set = <K extends keyof RailFormDraft>(key: K, value: RailFormDraft[K]): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  // Non-fatal on purpose: without the list the field offers "no trip", which
  // beats taking the dialog down over a side lookup.
  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getAll()
      .then((all) => {
        if (!cancelled) setTrips(all);
      })
      .catch((err: unknown) => logger.warn("RailFormModal: failed to load trips", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // A NEW ride is filed under the one trip whose dates contain its departure
  // day, as flights, cruises and stays are; a pick by hand ends it.
  const preselectTrip = useTripPreselection({
    enabled: journey === null,
    trips,
    date: draft.departureLocal,
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

  const { suggestions, failed: suggestionsFailed } = useRailEntrySuggestions({
    departure: draft.departure,
    arrival: draft.arrival,
    operator: draft.operator,
  });
  const typedTrain = trainLabel({
    category: draft.trainCategory.trim() || null,
    number: draft.trainNumber.trim(),
  });
  const trainChips = suggestions.trains.map(trainLabel);
  const pickTrain = (label: string): void => {
    const train = suggestions.trains.find((candidate) => trainLabel(candidate) === label);
    if (!train) return;
    setDraft((prev) => ({
      ...prev,
      trainCategory: train.category ?? "",
      trainNumber: train.number,
    }));
  };

  // Another station is another zone, where the old choice of occurrence means
  // nothing; a rename of the same station keeps it.
  const setStation = (end: "departure" | "arrival", next: RailStationDraft): void =>
    setDraft((prev) => {
      const moved = next.lat !== prev[end].lat || next.lon !== prev[end].lon;
      return {
        ...prev,
        [end]: next,
        ...(moved ? { [`${end}Fold`]: null } : {}),
      };
    });

  /**
   * A typed time ends the stored occurrence of a repeated hour: it was the old
   * clock's. Typing the clock the ride OPENED with, at the station it opened
   * with, gives it back — a change away and back must not move the ride.
   */
  const setTime = (end: "departure" | "arrival", value: string): void => {
    setDraft((prev) => {
      const sameClock = value === opened[`${end}Local`] && !opened[`${end}DayOnly`];
      const sameStation = prev[end].lat === opened[end].lat && prev[end].lon === opened[end].lon;
      return {
        ...prev,
        [`${end}Local`]: value,
        [`${end}Fold`]: sameClock && sameStation ? opened[`${end}Fold`] : null,
      };
    });
  };

  const toggleDayOnly = (end: "departure" | "arrival", dayOnly: boolean): void => {
    setDraft((prev) => {
      const local = end === "departure" ? prev.departureLocal : prev.arrivalLocal;
      const next = dayOnly ? dayPart(local) : withClock(local);
      // The time is no longer the stored one, so neither is its occurrence.
      return end === "departure"
        ? { ...prev, departureDayOnly: dayOnly, departureLocal: next, departureFold: null }
        : { ...prev, arrivalDayOnly: dayOnly, arrivalLocal: next, arrivalFold: null };
    });
  };

  const ready = canSubmit(draft) && depValid && arrValid;
  // What keeps both save buttons greyed out, said beside them (forgejo#245);
  // the same conditions as `ready`, one item per gap, each focusing its field.
  const missing: MissingStep[] = [
    ...stationGap(
      draft.departure,
      "rail-dep",
      t("rail:form.departureStation"),
      t("rail:form.missing.depName")
    ),
    ...(depBad === null
      ? []
      : [{ field: `rail-dep-${depBad}`, label: t("rail:form.missing.depCoordinates") }]),
    ...stationGap(
      draft.arrival,
      "rail-arr",
      t("rail:form.arrivalStation"),
      t("rail:form.missing.arrName")
    ),
    ...(arrBad === null
      ? []
      : [{ field: `rail-arr-${arrBad}`, label: t("rail:form.missing.arrCoordinates") }]),
    ...(draft.departureLocal === ""
      ? [{ field: TIME_ID.departureLocal, label: t("rail:form.missing.departureTime") }]
      : []),
  ];
  const shown = failure.failureKey !== null ? refusal : null;
  const errorText =
    shown === null
      ? null
      : t(shown.key, shown.fieldLabelKey ? { field: t(shown.fieldLabelKey) } : undefined);
  /** A refusal naming a plain field, at that field (forgejo#246). */
  const fieldError = (field: RailFormErrorField): string | null =>
    shown?.field === field ? errorText : null;
  const depError = fieldError("departureLocal");
  const arrError = fieldError("arrivalLocal");
  const bannerText = shown !== null && shown.field === null ? errorText : null;

  const previousId = typeof connectsFrom === "string" ? connectsFrom : connectsFrom?.id;
  const previousStation =
    typeof connectsFrom === "object" ? connectsFrom.arrStationName : draft.departure.name;

  /** The leg after `saved`, opened in place — the dialog moves on rather than closing. */
  const continueAfter = (saved: RailJourney): void => {
    setJourney(null);
    setConnectsFrom(saved);
    const nextLeg = onward ? onwardDraftFrom(saved, onward) : connectionDraftFrom(saved);
    setDraft(nextLeg);
    setOpened(nextLeg);
    resetDirty(nextLeg);
    setAutoTripId(null);
    saving.reset();
    setOnward(null);
    // The pickers remount so they show the new leg's stations.
    setFormKey((k) => k + 1);
  };

  const submit = async (thenConnect = false): Promise<void> => {
    if (!ready) return;
    failure.clear();
    setRetryConnect(thenConnect);
    setProgressRefreshFailed(false);
    const input = toRailInput(draft);
    // The request and what follows are two steps (forgejo#247): a list that
    // fails to reload must not turn a stored ride into "nicht gespeichert" —
    // the next click would have created it twice.
    const outcome = await saving.save(
      async () => {
        const result = journey
          ? await railApi.update(journey.id, input)
          : await railApi.create(previousId ? { ...input, connectsFrom: previousId } : input);
        const notice = geometryNotice(result.geometry);
        if (notice) {
          addToast(notice.level, t(notice.key, { reason: t(notice.reasonKey) }), NOTICE_MS);
        }
        return result.journey;
      },
      async (saved) => {
        markSaved();
        if (!thenConnect) {
          await onSaved(saved);
          return;
        }
        // The next leg opens either way: the ride IS stored, only the list
        // behind the dialog is stale — said, not treated as a refusal.
        try {
          await onProgress?.(saved);
        } catch (err: unknown) {
          logger.error("RailFormModal: list not refreshed after a leg", err);
          setProgressRefreshFailed(true);
        }
      }
    );
    if (outcome.status === "failed") {
      logger.error("RailFormModal: save failed", outcome.error);
      const refused = saveErrorFrom(outcome.error);
      setRefusal(refused);
      failure.fail(refused.key);
      return;
    }
    if (thenConnect && outcome.status === "saved") continueAfter(outcome.value);
  };

  const blocked = saving.saving || saving.saved !== null || !ready;
  const anyDayOnly = hasDayOnlyEnd(draft);

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      closeLabel={t("common:buttons.close")}
      title={journey ? t("rail:form.editTitle") : t("rail:form.createTitle")}
      maxWidth={672}
      footer={(requestClose) =>
        // Stored, but the follow-up failed: closing is the only honest action
        // left — another "Speichern" would send nothing (`useSaveOnce`).
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
              {t("rail:form.cancel")}
            </button>
            <button
              type="button"
              onClick={(): void => void submit(true)}
              disabled={blocked}
              aria-describedby={HINT_ID}
              data-testid="rail-save-and-connect"
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-(--bg-surface) disabled:opacity-50"
            >
              {t("rail:connection.saveAndAdd")}
            </button>
            <button
              type="button"
              onClick={(): void => void submit()}
              disabled={blocked}
              aria-describedby={HINT_ID}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
            >
              {saving.saving ? t("rail:form.saving") : t("rail:form.save")}
            </button>
          </>
        )
      }
    >
      <div key={formKey} ref={failure.rootRef}>
        {progressRefreshFailed && (
          <p role="status" className="mb-3 text-sm text-(--text-muted)">
            {t("common:form.savedButRefreshFailed")}
          </p>
        )}
        {previousId && (
          <p
            className="mb-3 rounded-md border border-border px-3 py-2 text-sm"
            data-testid="rail-connection-banner"
          >
            {t("rail:connection.banner", { station: previousStation })}
          </p>
        )}
        <Section title={t("rail:form.train")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <LabelledInput
                label={t("rail:form.operator")}
                field="operator"
                error={fieldError("operator")}
                placeholder={t("rail:form.operatorPlaceholder")}
                value={draft.operator}
                onChange={(e): void => set("operator", e.target.value)}
              />
              <SuggestionChips
                value={draft.operator}
                suggestions={suggestions.operators}
                onPick={(value): void => set("operator", value)}
                fieldLabel={t("rail:form.operator")}
              />
            </div>
            <LabelledInput
              label={t("rail:form.category")}
              field="trainCategory"
              error={fieldError("trainCategory")}
              placeholder={t("rail:form.categoryPlaceholder")}
              value={draft.trainCategory}
              onChange={(e): void => set("trainCategory", e.target.value)}
            />
            <LabelledInput
              label={t("rail:form.number")}
              field="trainNumber"
              error={fieldError("trainNumber")}
              placeholder={t("rail:form.numberPlaceholder")}
              value={draft.trainNumber}
              onChange={(e): void => set("trainNumber", e.target.value)}
            />
          </div>
          <SuggestionChips
            value={typedTrain}
            suggestions={trainChips}
            onPick={pickTrain}
            fieldLabel={t("rail:form.train")}
          />
          {suggestionsFailed && (
            <p className="t-caption mt-1" data-testid="rail-suggestions-failed">
              {t("rail:form.suggestionsFailed")}
            </p>
          )}
        </Section>

        <RailLookupPanel
          draft={draft}
          onApply={(next, destination): void => {
            setDraft(next);
            setOnward(destination);
          }}
          onClearLookup={(): void => set("lookup", null)}
          inputClassName={INPUT_CLASS}
        />

        {onward && (
          <div
            className="mb-3 rounded-md border border-border px-3 py-2 text-sm"
            data-testid="rail-onward-banner"
          >
            <p>{t("rail:connection.onward", { station: onward.name })}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-md bg-(--accent) px-3 py-1.5 text-sm font-medium text-(--bg-base) disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)"
                disabled={blocked}
                aria-describedby={HINT_ID}
                onClick={(): void => void submit(true)}
              >
                {t("rail:connection.saveAndContinue", { station: onward.name })}
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
                onClick={(): void => setOnward(null)}
              >
                {t("rail:connection.dismissOnward")}
              </button>
            </div>
          </div>
        )}

        <Section title={t("rail:form.route")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StationPicker
              label={t("rail:form.departureStation")}
              idPrefix="rail-dep"
              required
              value={draft.departure}
              onChange={(next): void => setStation("departure", next)}
              onValidityChange={(valid, field): void => setDepBad(valid ? null : (field ?? "lat"))}
              inputClassName={INPUT_CLASS}
            />
            <StationPicker
              label={t("rail:form.arrivalStation")}
              idPrefix="rail-arr"
              required
              value={draft.arrival}
              onChange={(next): void => setStation("arrival", next)}
              onValidityChange={(valid, field): void => setArrBad(valid ? null : (field ?? "lat"))}
              inputClassName={INPUT_CLASS}
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              {/* The error sits OUTSIDE the label, or it would become part of
                  the field's name. */}
              <label className="block text-sm">
                {t("rail:form.departureTime")} <RequiredMark />
                <input
                  id={TIME_ID.departureLocal}
                  type={draft.departureDayOnly ? "date" : "datetime-local"}
                  className={`mt-1 ${INPUT_CLASS}`}
                  style={DARK_PICKER_STYLE}
                  aria-required="true"
                  value={draft.departureLocal}
                  onChange={(e): void => setTime("departure", e.target.value)}
                  {...fieldErrorProps(TIME_ID.departureLocal, depError)}
                />
              </label>
              <FieldError id={TIME_ID.departureLocal} error={depError} />
              {/* A day has no clock to be repeated. */}
              <ClockChangeNotice
                local={draft.departureDayOnly ? "" : draft.departureLocal}
                fold={draft.departureFold ?? undefined}
                onFoldChange={(fold): void => set("departureFold", fold ?? "earlier")}
                zone={knownStationZone(journey, "dep", draft.departure)}
              />
              <label className={`mt-2 ${CHECK_ROW}`}>
                <input
                  type="checkbox"
                  checked={draft.departureDayOnly}
                  aria-label={`${t("rail:form.departureTime")}: ${t("rail:form.dayOnly")}`}
                  onChange={(e): void => toggleDayOnly("departure", e.target.checked)}
                />
                {t("rail:form.dayOnly")}
              </label>
            </div>
            <div>
              <label className="block text-sm">
                {t("rail:form.arrivalTime")}
                <input
                  id={TIME_ID.arrivalLocal}
                  type={draft.arrivalDayOnly ? "date" : "datetime-local"}
                  className={`mt-1 ${INPUT_CLASS}`}
                  style={DARK_PICKER_STYLE}
                  value={draft.arrivalLocal}
                  onChange={(e): void => setTime("arrival", e.target.value)}
                  {...fieldErrorProps(TIME_ID.arrivalLocal, arrError)}
                />
              </label>
              <FieldError id={TIME_ID.arrivalLocal} error={arrError} />
              <ClockChangeNotice
                local={draft.arrivalDayOnly ? "" : draft.arrivalLocal}
                fold={draft.arrivalFold ?? undefined}
                onFoldChange={(fold): void => set("arrivalFold", fold ?? "earlier")}
                zone={knownStationZone(journey, "arr", draft.arrival)}
              />
              <label className={`mt-2 ${CHECK_ROW}`}>
                <input
                  type="checkbox"
                  checked={draft.arrivalDayOnly}
                  aria-label={`${t("rail:form.arrivalTime")}: ${t("rail:form.dayOnly")}`}
                  onChange={(e): void => toggleDayOnly("arrival", e.target.checked)}
                />
                {t("rail:form.dayOnly")}
              </label>
              {/* Beside the arrival it qualifies, with a label that stays
                  visible once typed into (forgejo#202) — it used to sit in
                  the seat section with only a placeholder. */}
              <label className="mt-3 block text-sm">
                {t("rail:form.delay")}
                <input
                  id={railFieldId("delayMinutes")}
                  type="number"
                  className={`mt-1 ${INPUT_CLASS}`}
                  aria-label={t("rail:form.delay")}
                  value={draft.delayMinutes}
                  disabled={anyDayOnly}
                  {...fieldErrorProps(
                    railFieldId("delayMinutes"),
                    fieldError("delayMinutes"),
                    anyDayOnly ? "rail-delay-hint" : undefined
                  )}
                  onChange={(e): void => set("delayMinutes", e.target.value)}
                />
              </label>
              <FieldError id={railFieldId("delayMinutes")} error={fieldError("delayMinutes")} />
              {anyDayOnly && (
                <p id="rail-delay-hint" className="mt-1 text-xs text-(--text-muted)">
                  {t("rail:form.delayNeedsClock")}
                </p>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-(--text-muted)">{t("rail:form.timeHint")}</p>
          <div className="mt-3">
            <LabelledInput
              label={t("rail:form.distance")}
              field="distanceKm"
              error={fieldError("distanceKm")}
              type="number"
              min={0}
              step="0.1"
              value={draft.distanceKm}
              onChange={(e): void => set("distanceKm", e.target.value)}
            />
          </div>
          <p className="mt-1 text-xs text-(--text-muted)">{t("rail:form.distanceHint")}</p>
          <label className={`mt-3 ${CHECK_ROW}`}>
            <input
              type="checkbox"
              checked={draft.cancelled}
              onChange={(e): void => set("cancelled", e.target.checked)}
            />
            {t("rail:status.cancelledCheckbox")}
          </label>
        </Section>

        <RailFormDetails
          draft={draft}
          set={set}
          suggestions={suggestions}
          trips={trips}
          pickTrip={pickTrip}
          errorFor={fieldError}
        />

        {!(isStationComplete(draft.departure) && isStationComplete(draft.arrival)) && (
          <p className="mb-3 text-sm text-(--text-muted)">{t("rail:form.stationMissing")}</p>
        )}
        <FormErrorBanner
          message={bannerText}
          onRetry={
            failure.failureKey !== null && isTransientSaveError(failure.failureKey)
              ? (): void => void submit(retryConnect)
              : undefined
          }
          retryDisabled={saving.saving}
        />
        <RequiredLegend className="mt-3" />
      </div>
    </Modal>
  );
}

/**
 * What a station still lacks, as a "still missing" item: the whole station
 * (no position yet — the search), or only its name (a map click or a pasted
 * coordinate leaves it empty — the name field of the geocoder mode).
 */
function stationGap(
  station: RailStationDraft,
  idPrefix: string,
  stationLabel: string,
  nameLabel: string
): MissingStep[] {
  if (isStationComplete(station)) return [];
  if (station.lat !== null && station.lon !== null && station.name.trim() === "") {
    return [{ field: `${idPrefix}-name`, label: nameLabel }];
  }
  return [{ field: `${idPrefix}-search`, label: stationLabel }];
}
