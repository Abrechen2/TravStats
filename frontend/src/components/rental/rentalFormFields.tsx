import type { InputHTMLAttributes, JSX, ReactNode } from "react";
import { ClockChangeNotice } from "../common/ClockChangeNotice";
import { FieldError, RequiredMark, fieldErrorProps } from "../form";
import { useTranslation } from "../../hooks/useTranslation";
import { dayPart, withClock, type RentalFold } from "./rentalFormTimes";

/**
 * The rental form's field shapes (forgejo#245, #246, #249): a VISIBLE label
 * tied to its control by id, the required mark and `aria-required` together,
 * the error beside the field and in its description, never inside the label
 * (it would become part of the field's name).
 */

export const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent)";
export const DARK_PICKER_STYLE = { colorScheme: "dark" } as const;
/** A checkbox row a finger can hit: the pointer decides, not the width. */
export const CHECK_ROW =
  "flex items-center gap-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)";

interface LabelledProps {
  id: string;
  label: string;
  error?: string | null;
  required?: boolean;
  /** A line under the field that stays visible — help without hover. */
  hint?: string;
  children: (control: {
    id: string;
    "aria-required"?: true;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => ReactNode;
}

/** A label, its one control (rendered by `children` with the wiring), the hint and the error. */
export function Labelled({
  id,
  label,
  error,
  required,
  hint,
  children,
}: LabelledProps): JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={id} className="block">
        {label} {required ? <RequiredMark /> : null}
      </label>
      {children({
        id,
        ...(required ? { "aria-required": true as const } : {}),
        ...fieldErrorProps(id, error, hintId),
      })}
      {hint ? (
        <p id={hintId} className="t-caption">
          {hint}
        </p>
      ) : null}
      <FieldError id={id} error={error} />
    </div>
  );
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "onChange" | "value"> & {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  required?: boolean;
  hint?: string;
};

export function TextInput({
  id,
  label,
  value,
  onChange,
  error,
  required,
  hint,
  className,
  ...rest
}: TextInputProps): JSX.Element {
  return (
    <Labelled id={id} label={label} error={error} required={required} hint={hint}>
      {(wiring) => (
        <input
          {...rest}
          {...wiring}
          className={`${INPUT_CLASS} ${className ?? ""}`.trim()}
          value={value}
          onChange={(e): void => onChange(e.target.value)}
        />
      )}
    </Labelled>
  );
}

interface TimeFieldProps {
  id: string;
  label: string;
  local: string;
  dayOnly: boolean;
  fold: RentalFold | null;
  /** The station's zone when known; without one the server decides the clock change. */
  zone: string | null | undefined;
  required?: boolean;
  error?: string | null;
  onLocal: (value: string) => void;
  onDayOnly: (dayOnly: boolean, value: string) => void;
  onFold: (fold: RentalFold) => void;
}

/**
 * One station clock: a date-and-time, or — "nur Datum" — only its day, which
 * is saved as a day and never as a midnight nobody stated. In the repeated
 * autumn hour the notice beside it says the earlier occurrence is saved and
 * offers the later one.
 */
export function RentalTimeField({
  id,
  label,
  local,
  dayOnly,
  fold,
  zone,
  required,
  error,
  onLocal,
  onDayOnly,
  onFold,
}: TimeFieldProps): JSX.Element {
  const { t } = useTranslation(["rental"]);
  return (
    <div>
      <Labelled id={id} label={label} error={error} required={required}>
        {(wiring) => (
          <input
            {...wiring}
            type={dayOnly ? "date" : "datetime-local"}
            style={DARK_PICKER_STYLE}
            className={INPUT_CLASS}
            value={local}
            onChange={(e): void => onLocal(e.target.value)}
          />
        )}
      </Labelled>
      {/* A day has no clock to be repeated. */}
      <ClockChangeNotice
        local={dayOnly ? "" : local}
        zone={zone}
        fold={fold ?? undefined}
        onFoldChange={(next): void => onFold(next ?? "earlier")}
      />
      <label className={`mt-1 ${CHECK_ROW}`}>
        <input
          type="checkbox"
          checked={dayOnly}
          aria-label={`${label}: ${t("rental:form.dayOnly")}`}
          onChange={(e): void =>
            onDayOnly(e.target.checked, e.target.checked ? dayPart(local) : withClock(local))
          }
        />
        {t("rental:form.dayOnly")}
      </label>
    </div>
  );
}
