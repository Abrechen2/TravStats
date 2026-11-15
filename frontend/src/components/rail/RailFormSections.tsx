import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { FieldError, RequiredMark, SaveBlockedHint, fieldErrorProps } from "../form";
import type { MissingStep } from "../form";
import SuggestionChips from "../common/SuggestionChips";
import { ClockChangeNotice } from "../common/ClockChangeNotice";
import type { RailJourney } from "../../types/rail";
import { StationPicker } from "./StationPicker";
import { RailTransitModeField } from "./RailTransitModeField";
import { INPUT_CLASS, LabelledInput, Section } from "./railFormFields";
import type { RailStationDraft } from "./RailStationField";
import type { useRailEntrySuggestions } from "../../hooks/useRailEntrySuggestions";
import {
  knownStationZone,
  railFieldId,
  type RailFormDraft,
  type RailFormErrorField,
} from "./railFormModel";

export const HINT_ID = "rail-form-save-blocked";
/** The time inputs' ids — `saveErrorFrom` names a refused time by these fields. */
export const TIME_ID = {
  departureLocal: railFieldId("departureLocal"),
  arrivalLocal: railFieldId("arrivalLocal"),
};
/** A checkbox row a finger can hit on a coarse pointer. */
const CHECK_ROW = "flex items-center gap-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)";

// Native date/time pickers render their mask unreadably dark on our surface
// without it — the same note the cruise form carries.
const DARK_PICKER_STYLE = { colorScheme: "dark" } as const;

type End = "departure" | "arrival";
type Suggestions = ReturnType<typeof useRailEntrySuggestions>["suggestions"];
type SetField = <K extends keyof RailFormDraft>(key: K, value: RailFormDraft[K]) => void;

export interface TrainSectionProps {
  draft: RailFormDraft;
  set: SetField;
  suggestions: Suggestions;
  suggestionsFailed: boolean;
  typedTrain: string;
  trainChips: string[];
  pickTrain: (label: string) => void;
  fieldError: (field: RailFormErrorField) => string | null;
}

export function RailTrainSection({
  draft,
  set,
  suggestions,
  suggestionsFailed,
  typedTrain,
  trainChips,
  pickTrain,
  fieldError,
}: TrainSectionProps): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  return (
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
      <RailTransitModeField
        value={draft.transitMode}
        onChange={(v): void => set("transitMode", v)}
      />
    </Section>
  );
}

export function RailOnwardBanner({
  onward,
  blocked,
  submit,
  dismiss,
}: {
  onward: RailStationDraft;
  blocked: boolean;
  submit: (thenConnect?: boolean) => Promise<void>;
  dismiss: () => void;
}): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  return (
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
          onClick={dismiss}
        >
          {t("rail:connection.dismissOnward")}
        </button>
      </div>
    </div>
  );
}

export interface RouteSectionProps {
  draft: RailFormDraft;
  journey: RailJourney | null;
  set: SetField;
  setStation: (end: End, next: RailStationDraft) => void;
  setTime: (end: End, value: string) => void;
  toggleDayOnly: (end: End, dayOnly: boolean) => void;
  setDepBad: (bad: "lat" | "lon" | null) => void;
  setArrBad: (bad: "lat" | "lon" | null) => void;
  depError: string | null;
  arrError: string | null;
  fieldError: (field: RailFormErrorField) => string | null;
  anyDayOnly: boolean;
}

function StationsRow({
  draft,
  setStation,
  setDepBad,
  setArrBad,
}: Pick<RouteSectionProps, "draft" | "setStation" | "setDepBad" | "setArrBad">): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  return (
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
  );
}

function DepartureTimeField({
  draft,
  journey,
  set,
  setTime,
  toggleDayOnly,
  depError,
}: Pick<
  RouteSectionProps,
  "draft" | "journey" | "set" | "setTime" | "toggleDayOnly" | "depError"
>): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  return (
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
  );
}

function ArrivalTimeField({
  draft,
  journey,
  set,
  setTime,
  toggleDayOnly,
  arrError,
  fieldError,
  anyDayOnly,
}: Pick<
  RouteSectionProps,
  | "draft"
  | "journey"
  | "set"
  | "setTime"
  | "toggleDayOnly"
  | "arrError"
  | "fieldError"
  | "anyDayOnly"
>): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  return (
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
  );
}

function DistanceAndCancel({
  draft,
  set,
  fieldError,
}: Pick<RouteSectionProps, "draft" | "set" | "fieldError">): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  return (
    <>
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
    </>
  );
}

export function RailRouteSection(props: RouteSectionProps): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  return (
    <Section title={t("rail:form.route")}>
      <StationsRow {...props} />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DepartureTimeField {...props} />
        <ArrivalTimeField {...props} />
      </div>
      <DistanceAndCancel {...props} />
    </Section>
  );
}

export interface FooterProps {
  saving: { saving: boolean; afterSaveFailed: boolean; afterSaveFailedKey: string };
  missing: MissingStep[];
  blocked: boolean;
  submit: (thenConnect?: boolean) => Promise<void>;
  onClose: () => void;
  requestClose: () => void;
}

/** The dialog's buttons — or, once stored but the follow-up failed, only "close". */
export function RailFormFooter({
  saving,
  missing,
  blocked,
  submit,
  onClose,
  requestClose,
}: FooterProps): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  return (
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
  );
}
