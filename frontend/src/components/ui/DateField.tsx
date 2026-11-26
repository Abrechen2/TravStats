import { useCallback, useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes, JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { todayIn } from "../../shared/time/clock";
import CalendarGrid from "./CalendarGrid";
import CalendarPopover from "./CalendarPopover";
import DateTextBox, { useDisplayPrefs } from "./DateTextBox";
import { Input } from "./Field";

export type DateFieldKind = "date" | "datetime-local" | "time" | "month" | "year";

/** What `onChange` receives: the part of a change event every caller reads. */
export interface DateFieldChange {
  target: { value: string; id: string; name: string };
}

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max"
>;

export interface DateFieldProps extends NativeProps {
  /**
   * `date` (default), `datetime-local`, `time`, or — where one control follows
   * a stay's date precision — `month` and `year`. The value is always the wire
   * form: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `HH:mm`, `YYYY-MM`, `YYYY`.
   */
  kind?: DateFieldKind;
  value: string;
  onChange?: (event: DateFieldChange) => void;
  min?: string;
  max?: string;
  /** Natural width instead of filling the row — for a field inside a toolbar. */
  inline?: boolean;
  invalid?: boolean;
}

const SPLIT = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?)?$/;

/**
 * The one date, date-time and time field (rc.47). It is NOT the browser's
 * `<input type="date">`, which writes "11/26/2026" in an English browser
 * whatever the reader chose: it shows and accepts the day in the profile's
 * date format ("26.11.2026 ▾"), validates what is typed (2026-02-31 is
 * refused at the field, never turned into 3 March), and opens a calendar —
 * month grid, ‹ › for months, the year through `YearPicker`, arrow-key
 * navigation, Escape — as a popover, or a sheet on a phone-width viewport.
 * `min` / `max` bound the calendar (those days are greyed out); a typed day
 * outside them is still passed on, because the page that set the bound words
 * its own refusal. A time is typed in the clock the profile chose (24 h / 12 h).
 *
 * `onChange` gets `{ target: { value } }` with the wire value, so a caller
 * that read `e.target.value` off the native input keeps working.
 */
export default function DateField({
  kind = "date",
  value,
  onChange,
  min,
  max,
  inline = false,
  invalid = false,
  id,
  name,
  disabled,
  style,
  ...rest
}: DateFieldProps): JSX.Element {
  const emit = (next: string): void =>
    onChange?.({ target: { value: next, id: id ?? "", name: name ?? "" } });
  const common = { id, name, disabled, style, inline, invalid, ...rest };

  if (kind === "year") {
    return (
      <Input
        {...rest}
        id={id}
        name={name}
        disabled={disabled}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        invalid={invalid}
        style={{ ...(inline ? { width: "auto" } : null), ...style }}
        onChange={(e) => emit(e.target.value)}
      />
    );
  }
  if (kind === "time") {
    return <DateTextBox {...common} kind="clock" value={value} onValue={emit} />;
  }
  if (kind === "month") {
    return <DateTextBox {...common} kind="month" value={value} onValue={emit} />;
  }
  if (kind === "datetime-local") {
    return <DateTimeFields {...common} value={value} min={min} max={max} emit={emit} />;
  }
  return <DayField {...common} value={value} min={min} max={max} emit={emit} />;
}

type FieldBase = Omit<DateFieldProps, "kind" | "onChange" | "value"> & {
  value: string;
  emit: (value: string) => void;
  onDateTime?: (day: string, time: string) => void;
};

/** A day with its calendar button. */
function DayField({ value, emit, min, max, ...rest }: FieldBase): JSX.Element {
  const { t, i18n } = useTranslation(["common"]);
  const { dateFormat } = useDisplayPrefs();
  const zone = useTodayZone();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div ref={rowRef} style={{ width: rest.inline ? "auto" : "100%" }}>
      <DateTextBox
        {...rest}
        kind="day"
        value={value}
        onValue={emit}
        inputRef={inputRef}
        trailing={
          <button
            type="button"
            ref={buttonRef}
            disabled={rest.disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={t("common:dateField.open")}
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg border"
            style={{
              minWidth: "var(--ts-size-touch-min)",
              minHeight: "var(--ts-size-touch-min)",
              borderColor: "var(--ts-border-input)",
              background: "var(--ts-surface)",
              color: "var(--ts-text-bright)",
            }}
          >
            ▾
          </button>
        }
      />
      {open ? (
        <CalendarPopover
          anchorRef={rowRef}
          onClose={close}
          returnFocusRef={buttonRef}
          label={t("common:dateField.calendar")}
        >
          <CalendarGrid
            value={value}
            today={todayIn(zone)}
            min={min}
            max={max}
            weekStart={dateFormat === "MM/DD/YYYY" ? 0 : 1}
            language={i18n.language}
            onPick={(day) => {
              emit(day);
              setOpen(false);
              inputRef.current?.focus();
            }}
          />
        </CalendarPopover>
      ) : null}
    </div>
  );
}

/**
 * A day and a clock side by side. The wire value exists only when BOTH are
 * there — the same as the native control, and never a midnight nobody typed.
 * Seconds a stored value carried are kept.
 */
function DateTimeFields({ value, emit, min, max, ...rest }: FieldBase): JSX.Element {
  const { t } = useTranslation(["common"]);
  const split = SPLIT.exec(value);
  const [day, setDay] = useState(split?.[1] ?? "");
  const [time, setTime] = useState(split?.[2] ?? "");
  const seconds = useRef(split?.[3] ?? "");
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const m = SPLIT.exec(value);
    setDay(m?.[1] ?? "");
    setTime(m?.[2] ?? "");
    seconds.current = m?.[3] ?? "";
  }, [value]);

  const push = (nextDay: string, nextTime: string): void => {
    const wire = nextDay && nextTime ? `${nextDay}T${nextTime}${seconds.current}` : "";
    lastEmitted.current = wire;
    emit(wire);
  };

  return (
    <div className="flex flex-wrap items-start" style={{ gap: "var(--ts-space-sm)" }}>
      <div style={{ flex: "1 1 11rem" }}>
        <DayField
          {...rest}
          data-field-kind="datetime-local"
          data-wire-value={value}
          onDateTime={(d, c) => {
            setDay(d);
            setTime(c);
            push(d, c);
          }}
          value={day}
          min={min?.slice(0, 10)}
          max={max?.slice(0, 10)}
          emit={(d) => {
            setDay(d);
            push(d, time);
          }}
        />
      </div>
      <div style={{ flex: "0 1 8rem" }}>
        <DateTextBox
          {...rest}
          id={rest.id ? `${rest.id}-time` : undefined}
          data-field-kind="datetime-local-time"
          aria-label={`${rest["aria-label"] ?? ""} ${t("common:dateField.time")}`.trim()}
          kind="clock"
          value={time}
          onValue={(c) => {
            setTime(c);
            push(day, c);
          }}
        />
      </div>
    </div>
  );
}
