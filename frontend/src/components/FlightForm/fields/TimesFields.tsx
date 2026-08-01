import { useTranslation } from "../../../hooks/useTranslation";
import CopyActionButton from "../CopyActionButton";

/** The four date/time inputs a flight leg needs, always kept in the SAME
 *  timezone basis by the caller — see FlightEditModal's hydration effect for
 *  why that pairing must never split across two state updates. */
export interface TimesFieldsValue {
  depDate: string;
  depTime: string;
  arrDate: string;
  arrTime: string;
}

interface TimesFieldsIds {
  depDate?: string;
  depTime?: string;
  arrDate?: string;
  arrTime?: string;
}

interface TimesFieldsProps {
  value: TimesFieldsValue;
  onChange: (value: TimesFieldsValue) => void;
  /** Estimating the arrival time needs airport coordinates/timezones the
   *  field group doesn't own — the caller wires this in. The calculator
   *  button only renders when a handler is supplied. */
  onEstimateArrival?: () => void;
  canEstimateArrival?: boolean;
  ids?: TimesFieldsIds;
}

/** Departure + arrival date/time as four separate inputs (matches the
 *  create form). Copying the departure date onto the arrival date preserves
 *  the arrival time untouched. */
export default function TimesFields({
  value,
  onChange,
  onEstimateArrival,
  canEstimateArrival = false,
  ids,
}: TimesFieldsProps): JSX.Element {
  const { t } = useTranslation(["flights"]);

  const depDateId = ids?.depDate ?? "timesFieldsDepDate";
  const depTimeId = ids?.depTime ?? "timesFieldsDepTime";
  const arrDateId = ids?.arrDate ?? "timesFieldsArrDate";
  const arrTimeId = ids?.arrTime ?? "timesFieldsArrTime";

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

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="label" htmlFor={depDateId}>
          {t("flights:form.departureDate")}
        </label>
        <input
          id={depDateId}
          type="date"
          className="input"
          value={value.depDate}
          onChange={(e) => onChange({ ...value, depDate: e.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor={depTimeId}>
          {t("flights:form.departureTime")}
        </label>
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
          {onEstimateArrival && (
            <CopyActionButton
              icon="calculator"
              title={
                canEstimateArrival
                  ? t("flights:form.estimateArrivalTime")
                  : t("flights:form.estimateNoDepartureTime")
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
  );
}
