import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTripPreselection } from "../../hooks/useTripPreselection";
import { useTranslation } from "../../hooks/useTranslation";
import { isOutcomeUnknownSaveError, isTransientSaveError } from "../../lib/saveErrorMessage";
import {
  FormErrorBanner,
  RequiredLegend,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { RailJourney } from "../../types/rail";
import {
  RailFormFooter,
  RailOnwardBanner,
  RailRouteSection,
  RailTrainSection,
  TIME_ID,
} from "./RailFormSections";
import { missingSteps, withDayOnly, withStation, withTime } from "./railFormEdits";
import { useRailSubmit } from "./useRailSubmit";
import { useRailTrainSuggestions, useRailTripList } from "./useRailFormLookups";
import { RailLookupPanel } from "./RailLookupPanel";
import { RailFormDetails } from "./RailFormDetails";
import { INPUT_CLASS } from "./railFormFields";
import type { RailStationDraft } from "./RailStationField";
import {
  canSubmit,
  connectionDraftFrom,
  draftFrom,
  hasDayOnlyEnd,
  isStationComplete,
  onwardDraftFrom,
  type RailFormDraft,
  type RailFormErrorField,
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
  /**
   * Re-reads the caller's list WITHOUT closing this form — offered when a
   * create's answer was lost (`isOutcomeUnknownSaveError`), so the user can
   * look before sending again. Omitted where the caller cannot do that.
   */
  onReload?: () => void;
}

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
  onReload,
}: Props): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
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
  const trips = useRailTripList();
  /** Which typed coordinate of each station `LocationInput` refused, if any. */
  const [depBad, setDepBad] = useState<"lat" | "lon" | null>(null);
  const [arrBad, setArrBad] = useState<"lat" | "lon" | null>(null);
  const depValid = depBad === null;
  const arrValid = arrBad === null;
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

  const { suggestions, suggestionsFailed, typedTrain, trainChips, pickTrain } =
    useRailTrainSuggestions(draft, setDraft);
  const setStation = (end: "departure" | "arrival", next: RailStationDraft): void =>
    setDraft((prev) => withStation(prev, end, next));
  const setTime = (end: "departure" | "arrival", value: string): void =>
    setDraft((prev) => withTime(prev, opened, end, value));
  const toggleDayOnly = (end: "departure" | "arrival", dayOnly: boolean): void =>
    setDraft((prev) => withDayOnly(prev, end, dayOnly));

  const ready = canSubmit(draft) && depValid && arrValid;
  // What keeps both save buttons greyed out, said beside them (forgejo#245);
  // the same conditions as `ready`, one item per gap, each focusing its field.
  const missing = missingSteps(draft, depBad, arrBad, TIME_ID.departureLocal, t);
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

  const { submit, refusal, retryConnect, progressRefreshFailed } = useRailSubmit({
    draft,
    journey,
    previousId,
    ready,
    failure,
    saving,
    markSaved,
    onSaved,
    onProgress,
    continueAfter,
  });

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
      footer={(requestClose) => (
        <RailFormFooter
          saving={saving}
          missing={missing}
          blocked={blocked}
          submit={submit}
          onClose={onClose}
          requestClose={requestClose}
        />
      )}
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
        <RailTrainSection
          draft={draft}
          set={set}
          suggestions={suggestions}
          suggestionsFailed={suggestionsFailed}
          typedTrain={typedTrain}
          trainChips={trainChips}
          pickTrain={pickTrain}
          fieldError={fieldError}
        />

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
          <RailOnwardBanner
            onward={onward}
            blocked={blocked}
            submit={submit}
            dismiss={(): void => setOnward(null)}
          />
        )}

        <RailRouteSection
          draft={draft}
          journey={journey}
          set={set}
          setStation={setStation}
          setTime={setTime}
          toggleDayOnly={toggleDayOnly}
          setDepBad={setDepBad}
          setArrBad={setArrBad}
          depError={depError}
          arrError={arrError}
          fieldError={fieldError}
          anyDayOnly={anyDayOnly}
        />

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
          onReload={
            failure.failureKey !== null && isOutcomeUnknownSaveError(failure.failureKey)
              ? onReload
              : undefined
          }
        />
        <RequiredLegend className="mt-3" />
      </div>
    </Modal>
  );
}
