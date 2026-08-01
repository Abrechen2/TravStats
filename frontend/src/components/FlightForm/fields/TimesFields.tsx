import { useTranslation } from "../../../hooks/useTranslation";
import CopyActionButton from "../CopyActionButton";
import HelpIcon from "../../Help/HelpIcon";

/** The four date/time inputs a flight leg needs, always kept in the SAME
 *  timezone basis by the caller — see FlightEditModal's hydration effect for
 *  why that pairing must never split across two state updates. */
export interface TimesFieldsValue {
  depDate: string;
  depTime: string;
  arrDate: string;
  arrTime: string;
}

/** The actual departure/arrival pair (#200) — same shape as TimesFieldsValue,
 *  same timezone-basis contract (actual departure is airport-local at the
 *  departure airport, actual arrival at the arrival airport, mirroring
 *  depTz/arrTz). Kept as a separate type from TimesFieldsValue rather than
 *  reusing it: the field names differ (actualDepDate vs depDate) so a caller
 *  can never accidentally pass one where the other is expected. */
export interface ActualTimesFieldsValue {
  actualDepDate: string;
  actualDepTime: string;
  actualArrDate: string;
  actualArrTime: string;
}

interface TimesFieldsIds {
  depDate?: string;
  depTime?: string;
  arrDate?: string;
  arrTime?: string;
  actualDepDate?: string;
  actualDepTime?: string;
  actualArrDate?: string;
  actualArrTime?: string;
}

/** A single field's help-tooltip content, already translated by the caller —
 *  TimesFields doesn't own this copy, it just has somewhere to put it. */
interface TimesFieldsFieldHelp {
  content: string;
  expandedContent?: string;
}

interface TimesFieldsHelp {
  depDate?: TimesFieldsFieldHelp;
  depTime?: TimesFieldsFieldHelp;
  arrDate?: TimesFieldsFieldHelp;
  arrTime?: TimesFieldsFieldHelp;
}

interface TimesFieldsProps {
  value: TimesFieldsValue;
  onChange: (value: TimesFieldsValue) => void;
  /** Estimating the arrival time needs airport coordinates/timezones the
   *  field group doesn't own — the caller wires this in. The calculator
   *  button only renders when a handler is supplied. */
  onEstimateArrival?: () => void;
  canEstimateArrival?: boolean;
  /** Already-translated override for the disabled calculator button's
   *  tooltip. The create form can tell "no airports selected" apart from
   *  "no departure time yet" — this component can't (it doesn't own
   *  `departure`/`arrival`), so the caller decides the message and this
   *  just displays it. Falls back to the generic "no departure time"
   *  text when omitted, which is what FlightEditModal gets. */
  estimateDisabledHint?: string;
  ids?: TimesFieldsIds;
  /** Per-field help tooltips (the create form has these, the edit form does
   *  not) — a field only gets a <HelpIcon> when its entry is supplied, so
   *  callers that pass nothing (FlightEditModal) render exactly as before. */
  help?: TimesFieldsHelp;
  /** Actual departure/arrival (#200) — rendered ONLY when both this and
   *  onActualChange are supplied, so a caller that passes neither (none
   *  currently do — both forms wire this in) renders exactly as before.
   *  The delay shown alongside is DERIVED from this vs. the scheduled
   *  `value` and is read-only — there is no delay input, matching how
   *  flight status is a derived pill rather than a picker. */
  actualValue?: ActualTimesFieldsValue;
  onActualChange?: (value: ActualTimesFieldsValue) => void;
}

/** Departure + arrival date/time as four separate inputs (matches the
 *  create form). Copying the departure date onto the arrival date preserves
 *  the arrival time untouched. */
export default function TimesFields({
  value,
  onChange,
  onEstimateArrival,
  canEstimateArrival = false,
  estimateDisabledHint,
  ids,
  help,
  actualValue,
  onActualChange,
}: TimesFieldsProps): JSX.Element {
  const { t } = useTranslation(["flights"]);

  const depDateId = ids?.depDate ?? "timesFieldsDepDate";
  const depTimeId = ids?.depTime ?? "timesFieldsDepTime";
  const arrDateId = ids?.arrDate ?? "timesFieldsArrDate";
  const arrTimeId = ids?.arrTime ?? "timesFieldsArrTime";
  const actualDepDateId = ids?.actualDepDate ?? "timesFieldsActualDepDate";
  const actualDepTimeId = ids?.actualDepTime ?? "timesFieldsActualDepTime";
  const actualArrDateId = ids?.actualArrDate ?? "timesFieldsActualArrDate";
  const actualArrTimeId = ids?.actualArrTime ?? "timesFieldsActualArrTime";
  const showActualTimes = Boolean(actualValue && onActualChange);

  const handleCopyDepartureDate = (): void => {
    if (!value.depDate) return;
    onChange({ ...value, arrDate: value.depDate });
  };

  // "+N day" hint under the arrival date field.
  const arrivalDayOffset = (() => {
    if (!value.depDate || !value.arrDate || value.arrDate <= value.depDate) return 0;
    const [dy, dm, dd] = value.depDate.split("-").map(Number);
    const [ay, am, ad] = value.arrDate.split("-").map(Number);
    if ([dy, dm, dd, ay, am, ad].some((n) => Number.isNaN(n))) return 0;
    const from = Date.UTC(dy, dm - 1, dd);
    const to = Date.UTC(ay, am - 1, ad);
    return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
  })();

  // Derived, read-only delay — actual departure minus scheduled departure,
  // in minutes. Mirrors the backend's own delayMinutes formula
  // (routes/flights.ts: incomingActualDepUtc - scheduledDep) so the number
  // shown here matches what gets stored once this same pair is saved. Both
  // wall-clock strings share the departure airport's timezone (depTz), so
  // diffing them directly is equivalent to diffing the two UTC instants —
  // no conversion needed. This is display-only and is NEVER submitted or
  // rendered as an input, exactly like the flight-status pill above it.
  const delayMinutes = (() => {
    if (!value.depDate || !value.depTime) return null;
    if (!actualValue?.actualDepDate || !actualValue.actualDepTime) return null;
    const scheduled = new Date(`${value.depDate}T${value.depTime}`);
    const actual = new Date(`${actualValue.actualDepDate}T${actualValue.actualDepTime}`);
    if (Number.isNaN(scheduled.getTime()) || Number.isNaN(actual.getTime())) return null;
    return Math.round((actual.getTime() - scheduled.getTime()) / 60000);
  })();

  const delayText =
    delayMinutes == null
      ? null
      : delayMinutes > 0
        ? t("flights:actualTimes.delayMinutes", { minutes: delayMinutes })
        : delayMinutes < 0
          ? t("flights:actualTimes.earlyMinutes", { minutes: Math.abs(delayMinutes) })
          : t("flights:actualTimes.onTimeLabel");

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <label className="label" htmlFor={depDateId}>
              {t("flights:form.departureDate")}
            </label>
            {help?.depDate && (
              <HelpIcon
                content={help.depDate.content}
                expandedContent={help.depDate.expandedContent}
                position="top"
              />
            )}
          </div>
          <input
            id={depDateId}
            type="date"
            className="input"
            value={value.depDate}
            onChange={(e) => onChange({ ...value, depDate: e.target.value })}
          />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <label className="label" htmlFor={depTimeId}>
              {t("flights:form.departureTime")}
            </label>
            {help?.depTime && (
              <HelpIcon
                content={help.depTime.content}
                expandedContent={help.depTime.expandedContent}
                position="top"
              />
            )}
          </div>
          <input
            id={depTimeId}
            type="time"
            className="input"
            value={value.depTime}
            onChange={(e) => onChange({ ...value, depTime: e.target.value })}
          />
        </div>
        <div>
          {/* The copy button is a SIBLING of the label, never nested inside
            it — a labelable element (button) nested inside a <label for>
            gets independently swept up by jsdom's label resolution as its
            own "labelled control", matching on the label's text even
            though `for` points at the date input. That inflated getByLabelText
            counts in TimesFields.test.tsx before this was split out. */}
          <div className="flex items-center gap-2">
            <label className="label" htmlFor={arrDateId}>
              {t("flights:form.arrivalDate")}
            </label>
            {help?.arrDate && (
              <HelpIcon
                content={help.arrDate.content}
                expandedContent={help.arrDate.expandedContent}
                position="top"
              />
            )}
            <CopyActionButton
              icon="arrow-down"
              title={t("flights:form.copyToArrival")}
              disabled={!value.depDate}
              onClick={handleCopyDepartureDate}
            />
          </div>
          <input
            id={arrDateId}
            type="date"
            className="input"
            value={value.arrDate}
            onChange={(e) => onChange({ ...value, arrDate: e.target.value })}
          />
          {arrivalDayOffset > 0 && (
            <p className="text-xs mt-1 text-blue-700 dark:text-blue-300">
              {arrivalDayOffset === 1
                ? t("flights:form.arrivalNextDay")
                : t("flights:form.arrivalDayOffset", { count: arrivalDayOffset })}
            </p>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <label className="label" htmlFor={arrTimeId}>
              {t("flights:form.arrivalTime")}
            </label>
            {help?.arrTime && (
              <HelpIcon
                content={help.arrTime.content}
                expandedContent={help.arrTime.expandedContent}
                position="top"
              />
            )}
            {onEstimateArrival && (
              <CopyActionButton
                icon="calculator"
                title={
                  canEstimateArrival
                    ? t("flights:form.estimateArrivalTime")
                    : (estimateDisabledHint ?? t("flights:form.estimateNoDepartureTime"))
                }
                disabled={!canEstimateArrival}
                onClick={onEstimateArrival}
              />
            )}
          </div>
          <input
            id={arrTimeId}
            type="time"
            className="input"
            value={value.arrTime}
            onChange={(e) => onChange({ ...value, arrTime: e.target.value })}
          />
        </div>
      </div>
      {showActualTimes && actualValue && onActualChange && (
        <div className="mt-4">
          <h4 className="text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
            {t("flights:actualTimes.label")}
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor={actualDepDateId}>
                {t("flights:actualTimes.actualDepartureDate")}
              </label>
              <input
                id={actualDepDateId}
                type="date"
                className="input"
                value={actualValue.actualDepDate}
                onChange={(e) => onActualChange({ ...actualValue, actualDepDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor={actualDepTimeId}>
                {t("flights:actualTimes.actualDepartureTime")}
              </label>
              <input
                id={actualDepTimeId}
                type="time"
                className="input"
                value={actualValue.actualDepTime}
                onChange={(e) => onActualChange({ ...actualValue, actualDepTime: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor={actualArrDateId}>
                {t("flights:actualTimes.actualArrivalDate")}
              </label>
              <input
                id={actualArrDateId}
                type="date"
                className="input"
                value={actualValue.actualArrDate}
                onChange={(e) => onActualChange({ ...actualValue, actualArrDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor={actualArrTimeId}>
                {t("flights:actualTimes.actualArrivalTime")}
              </label>
              <input
                id={actualArrTimeId}
                type="time"
                className="input"
                value={actualValue.actualArrTime}
                onChange={(e) => onActualChange({ ...actualValue, actualArrTime: e.target.value })}
              />
            </div>
          </div>
          {delayText && (
            <p
              data-testid="timesFieldsDelay"
              className="text-xs mt-2"
              style={{ color: "var(--text-muted)" }}
            >
              {t("flights:actualTimes.delayLabel")}: {delayText}
            </p>
          )}
        </div>
      )}
    </>
  );
}
