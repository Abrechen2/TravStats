import { useRef } from "react";
import type { JSX, KeyboardEvent, ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** The spoken name, when the pill shows a symbol: "km" reads "Kilometer". */
  name?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Names the choice for a screen reader: "Sprache", "Datumsformat". */
  label: string;
  disabled?: boolean;
}

/**
 * A choice among two to four options, drawn as pills.
 *
 * Round-4 settings ("Einstellungen v3"): language, date format, time format and
 * distance are each a handful of fixed options, and a dropdown hides all but
 * one of them. A pill row shows every option and which one holds.
 *
 * A radio group, not a row of buttons: arrow keys move the choice, and only
 * the chosen pill is a tab stop — which is what a screen reader announces as
 * "1 of 3, selected". More than four options belong in a select.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: SegmentedProps<T>): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className="flex flex-wrap"
      style={{ gap: "var(--ts-space-sm)" }}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.name}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className="ts-chip"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 36,
              padding: "0 var(--ts-space-lg)",
              borderRadius: "var(--ts-radius-pill)",
              background: checked ? "var(--ts-accent)" : "transparent",
              color: checked ? "var(--ts-accent-text)" : "var(--ts-text)",
              border: `1px solid ${checked ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
