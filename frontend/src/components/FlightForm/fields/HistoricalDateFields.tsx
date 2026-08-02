import { useTranslation } from "../../../hooks/useTranslation";

/** Year / month / day pickers for a historical flight's date, shared between
 *  the create form (`FlightCompleteStep`) and the edit modal.
 *
 *  Four valid value shapes, in order of completeness:
 *    ""           -> nothing entered yet
 *    "YYYY"       -> year known, month unknown
 *    "YYYY-MM"    -> year + month known, day unknown
 *    "YYYY-MM-DD" -> year + month + real day known
 *
 *  The shape doubles as the precision record: `buildLocalString` expands the
 *  partial shapes on submit ("YYYY" -> Jan 1, "YYYY-MM" -> day 1) and
 *  `historicalDateShape` (below) derives the depTimeSemantics from it —
 *  DATE_ONLY when the day is real, UNKNOWN otherwise. The legacy
 *  "YYYY-MM-01" shape is read as year+month+day=1 and displays Day=1,
 *  which is honest about the data.
 *
 *  Extracted from FlightCompleteStep so the edit modal stops maintaining its
 *  own year+month-only variant — that variant force-rewrote the day to 01 on
 *  any touch, silently destroying the known day of a DATE_ONLY flight. */

export type HistoricalDateShape = "year" | "year_month" | "year_month_day" | "unknown";

/** Derive which date-precision shape a historical date string has. The same
 *  discriminator `useFlightForm` uses to pick the submitted time semantics. */
export function historicalDateShape(date: string): HistoricalDateShape {
  if (/^\d{4}$/.test(date)) return "year";
  if (/^\d{4}-\d{2}$/.test(date)) return "year_month";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return "year_month_day";
  return "unknown";
}

interface HistoricalDateFieldsProps {
  /** Current date in one of the four shapes above. */
  value: string;
  /** Fires with the next shape string on every change. */
  onChange: (next: string) => void;
  labelClassName?: string;
  inputClassName?: string;
  /** Prefixes the input ids (e.g. "edit") so both forms can mount at once. */
  idPrefix?: string;
}

export default function HistoricalDateFields({
  value,
  onChange,
  labelClassName = "",
  inputClassName = "",
  idPrefix = "",
}: HistoricalDateFieldsProps): JSX.Element {
  const { t, i18n } = useTranslation(["flights"]);

  const yearMatch = value.match(/^(\d{1,4})/);
  const monthMatch = value.match(/^\d{4}-(\d{2})/);
  const dayMatch = value.match(/^\d{4}-\d{2}-(\d{2})$/);
  const yearStr = yearMatch?.[1] ?? "";
  const monthPadded = monthMatch?.[1] ?? "";
  const monthValue = monthPadded ? String(parseInt(monthPadded, 10)) : "";
  const dayPadded = dayMatch?.[1] ?? "";
  const dayValue = dayPadded ? String(parseInt(dayPadded, 10)) : "";

  // Returns how many days are in (year, month) where month is 1-12.
  // new Date(year, month, 0) gives the last day of the prior month
  // when month is treated as 1-based (JS idiom).
  const daysInMonth = (year: number, month: number): number =>
    new Date(year, month, 0).getDate();

  const numYear = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
  const numMonth = monthValue ? parseInt(monthValue, 10) : 0;
  const maxDay = numMonth > 0 ? daysInMonth(numYear, numMonth) : 31;

  const yearId = `${idPrefix}HistoricalYear`;
  const monthId = `${idPrefix}HistoricalMonth`;
  const dayId = `${idPrefix}HistoricalDay`;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "1.5fr 2fr 1.2fr" }}>
      <div>
        <label className={`label ${labelClassName}`} htmlFor={yearId}>
          {t("flights:historicalYear")}
        </label>
        <input
          id={yearId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          placeholder={t("flights:historicalYearPlaceholder")}
          value={yearStr}
          onChange={(e) => {
            const y = e.target.value.replace(/\D/g, "").slice(0, 4);
            if (!y) {
              onChange("");
              return;
            }
            if (!monthPadded) {
              // No month selected — store year-only
              onChange(y);
            } else if (!dayPadded) {
              // Month known, no day — store YYYY-MM
              onChange(`${y}-${monthPadded}`);
            } else {
              // Year + month + day: clamp day to the new month's max
              const newMax = daysInMonth(parseInt(y, 10), parseInt(monthPadded, 10));
              const clampedDay = Math.min(parseInt(dayPadded, 10), newMax);
              onChange(`${y}-${monthPadded}-${String(clampedDay).padStart(2, "0")}`);
            }
          }}
          className={`input ${inputClassName}`}
        />
      </div>
      <div>
        <label className={`label ${labelClassName}`} htmlFor={monthId}>
          {t("flights:historicalMonth")}
        </label>
        <select
          id={monthId}
          value={monthValue}
          onChange={(e) => {
            const m = e.target.value;
            const y = yearStr || String(new Date().getFullYear());
            if (!m) {
              // Month cleared — drop back to year-only (also clears day)
              onChange(yearStr ? yearStr : "");
            } else if (!dayPadded) {
              // Month selected, no day — store YYYY-MM (NOT YYYY-MM-01)
              onChange(`${y}-${m.padStart(2, "0")}`);
            } else {
              // Month changed while day is set — clamp day if needed
              const newMax = daysInMonth(parseInt(y, 10), parseInt(m, 10));
              const clampedDay = Math.min(parseInt(dayPadded, 10), newMax);
              onChange(`${y}-${m.padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`);
            }
          }}
          className={`input ${inputClassName}`}
        >
          <option value="">{t("flights:historicalMonthNone")}</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={String(i + 1)}>
              {new Date(2000, i).toLocaleDateString(i18n.language, { month: "long" })}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={`label ${labelClassName}`} htmlFor={dayId}>
          {t("flights:historicalDay")}
        </label>
        <select
          id={dayId}
          value={dayValue}
          disabled={!monthValue}
          onChange={(e) => {
            const d = e.target.value;
            const y = yearStr || String(new Date().getFullYear());
            if (!d) {
              // Day cleared — transition back to YYYY-MM
              onChange(`${y}-${monthPadded}`);
            } else {
              onChange(`${y}-${monthPadded}-${d.padStart(2, "0")}`);
            }
          }}
          className={`input ${inputClassName} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <option value="">{t("flights:historicalDayNone")}</option>
          {Array.from({ length: maxDay }, (_, i) => (
            <option key={i + 1} value={String(i + 1)}>
              {i + 1}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
