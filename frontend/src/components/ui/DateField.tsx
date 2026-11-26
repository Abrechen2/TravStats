import type { InputHTMLAttributes, JSX } from "react";
import { formatLocalDate } from "../../lib/format";
import { Input } from "./Field";

export type DateFieldKind = "date" | "datetime-local" | "time" | "month" | "year";

export interface DateFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /**
   * `date` (default), `datetime-local`, `time`, or — where one control
   * follows a stay's date precision — `month` (`YYYY-MM`) and `year`
   * (a four-digit number). The value is always the wire form the native
   * control speaks — `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `HH:mm` — whatever the
   * reader's date format is; only what is SHOWN (the `title` reading) follows
   * Settings → Display.
   */
  kind?: DateFieldKind;
  /** Natural width instead of filling the row — for a field inside a toolbar. */
  inline?: boolean;
  invalid?: boolean;
}

/**
 * The one date, date-time and time input (rc.47). Every `type="date"` /
 * `datetime-local` / `time` in the app goes through here, so the control looks
 * the same on every page, keeps the 44 px touch target (`.ts-control` + the
 * shared control style) and a screen reader gets a label rather than a bare
 * "date" role. A source scan (`__tests__/lint/noRawDateInput.test.ts`) refuses
 * a raw one.
 *
 * It stays a NATIVE input on purpose: the iPad's date wheel is the best picker
 * this app could ship, and the value stays the plain string every caller
 * already stores. Day arithmetic ("today", ranges) is in the profile zone, in
 * `DateRangeField` — never the browser's.
 */
export default function DateField({
  kind = "date",
  inline = false,
  style,
  value,
  title,
  ...rest
}: DateFieldProps): JSX.Element {
  const shown =
    title ??
    (kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? formatLocalDate(value)
      : undefined);
  return (
    <Input
      type={kind === "year" ? "number" : kind}
      value={value}
      title={shown}
      style={{ ...(inline ? { width: "auto" } : null), ...style }}
      {...rest}
    />
  );
}
