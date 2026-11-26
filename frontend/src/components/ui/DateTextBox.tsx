import { useEffect, useId, useState } from "react";
import type { InputHTMLAttributes, JSX, KeyboardEvent, ReactNode, Ref } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { Input } from "./Field";
import type { DateFormatId, TimeFormatId } from "./dateParts";
import {
  readTypedClock,
  readTypedDay,
  readTypedMonth,
  showClock,
  showDay,
  showMonth,
} from "./dateParts";

export type TextBoxKind = "day" | "month" | "clock";

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max" | "step"
>;

export interface DateTextBoxProps extends NativeProps {
  kind: TextBoxKind;
  /** Wire value: `YYYY-MM-DD`, `YYYY-MM` or `HH:mm`; "" for none. */
  value: string;
  /** Called with a wire value, or "" when the field was cleared. Never with an invalid one. */
  onValue: (value: string) => void;
  inline?: boolean;
  invalid?: boolean;
  /** A button or two to the right of the box (the calendar button). */
  trailing?: ReactNode;
  /** A pasted full timestamp ("2026-10-02T14:05") — set by the date-time field, which splits it. */
  onDateTime?: (day: string, time: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}

type BoxError = "invalid" | null;

export function useDisplayPrefs(): { dateFormat: DateFormatId; timeFormat: TimeFormatId } {
  const dateFormat = useSettingsStore((s) => s.display?.dateFormat) ?? "DD.MM.YYYY";
  const timeFormat = useSettingsStore((s) => s.display?.timeFormat) ?? "24h";
  return { dateFormat, timeFormat };
}

/**
 * A typed date, month or clock in the READER's format ("26.11.2026"), not the
 * browser's. What is typed is validated: a day that does not exist
 * (2026-02-31) is refused with a message at the field and is never passed on —
 * the form keeps its last valid value, nothing is normalised into another day.
 * The error shows on blur or Enter, not on every keystroke of a half-typed date.
 */
export default function DateTextBox({
  kind,
  value,
  onValue,
  inline = false,
  invalid = false,
  trailing,
  onDateTime,
  inputRef,
  onBlur,
  onKeyDown,
  style,
  ...rest
}: DateTextBoxProps): JSX.Element {
  const { t } = useTranslation(["common"]);
  const { dateFormat, timeFormat } = useDisplayPrefs();
  const errorId = useId();
  const show = (wire: string): string =>
    kind === "day"
      ? showDay(wire, dateFormat)
      : kind === "month"
        ? showMonth(wire, dateFormat)
        : showClock(wire, timeFormat);
  const [text, setText] = useState(() => show(value));
  const [error, setError] = useState<BoxError>(null);

  // Adopt a value that changed from outside (a calendar pick, a form reset) —
  // but never overwrite text that already reads as this value (a typed "6.1.2026").
  useEffect(() => {
    if (read(text).value !== value) {
      setText(show(value));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `text` is what is being compared
  }, [value, dateFormat, timeFormat]);

  function read(raw: string): { value: string | null } {
    if (kind === "day") {
      const r = readTypedDay(raw, dateFormat);
      return { value: r.kind === "day" ? r.day : r.kind === "empty" ? "" : null };
    }
    if (kind === "month") {
      const r = readTypedMonth(raw);
      return { value: r.kind === "month" ? r.month : r.kind === "empty" ? "" : null };
    }
    const r = readTypedClock(raw);
    return { value: r.kind === "time" ? r.time : r.kind === "empty" ? "" : null };
  }

  const classify = (raw: string): BoxError => {
    const { value: wire } = read(raw);
    if (wire === null) return "invalid";
    if (wire === "") return null;
    return null;
  };

  const onChange = (raw: string): void => {
    const stamp = onDateTime ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw.trim()) : null;
    if (stamp && onDateTime) {
      setText(show(stamp[1]));
      setError(null);
      onDateTime(stamp[1], stamp[2]);
      return;
    }
    setText(raw);
    const { value: wire } = read(raw);
    if (wire !== null && classify(raw) === null) {
      setError(null);
      if (wire !== value) onValue(wire);
    }
  };

  const check = (): boolean => {
    const next = classify(text);
    setError(next);
    return next === null;
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    onKeyDown?.(e);
    if (e.key === "Enter" && !check()) e.preventDefault();
  };

  const message =
    error === "invalid"
      ? t(kind === "clock" ? "common:dateField.invalidTime" : "common:dateField.invalidDate")
      : null;
  const order = dateFormat === "MM/DD/YYYY" ? "mdy" : dateFormat === "YYYY-MM-DD" ? "ymd" : "dmy";
  const placeholder =
    kind === "clock"
      ? t(`common:dateField.placeholder.${timeFormat === "12h" ? "clock12" : "clock24"}`)
      : t(`common:dateField.placeholder.${kind === "month" ? "month_" : ""}${order}`);

  return (
    <div className="flex flex-col" style={{ gap: 4, width: inline ? "auto" : "100%" }}>
      <div className="flex items-center" style={{ gap: 4 }}>
        <Input
          {...rest}
          ref={inputRef}
          type="text"
          inputMode={kind === "clock" ? "text" : "numeric"}
          autoComplete="off"
          data-wire-value={rest["data-wire-value" as keyof typeof rest] ?? value}
          data-field-kind={
            rest["data-field-kind" as keyof typeof rest] ??
            (kind === "clock" ? "time" : kind === "month" ? "month" : "date")
          }
          value={text}
          placeholder={rest.placeholder ?? placeholder}
          invalid={invalid || error !== null}
          aria-invalid={error !== null ? true : rest["aria-invalid"]}
          aria-describedby={
            [rest["aria-describedby"], message ? errorId : undefined].filter(Boolean).join(" ") ||
            undefined
          }
          style={style}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            onBlur?.(e);
            check();
          }}
          onKeyDown={handleKey}
        />
        {trailing}
      </div>
      {message ? (
        <span id={errorId} role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
