import { useState, type JSX } from "react";
import { Icon, type IconName } from "./Icon";

export interface IconGridOption {
  value: string;
  icon: IconName;
  /** Names the button for assistive tech; the grid itself shows icons only. */
  label: string;
}

/**
 * Pick one icon from a small grid: a trigger showing the current icon opens a popover of icon
 * buttons. Replaces a `<select>` whose options could only be text.
 */
export function IconGridPicker({
  value,
  options,
  onChange,
  label,
  className,
  testId,
}: {
  value: string;
  options: readonly IconGridOption[];
  onChange: (value: string) => void;
  /** The group's name, e.g. "Symbol". */
  label: string;
  className?: string;
  testId?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="relative">
      <button
        type="button"
        className={className}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
      >
        {current ? <Icon name={current.icon} size={16} /> : null}
      </button>
      {open ? (
        <div
          role="group"
          aria-label={label}
          className="absolute z-20 grid grid-cols-4 gap-1 p-2 rounded-lg border"
          style={{ background: "var(--ts-surface)", borderColor: "var(--ts-border-input)" }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-label={o.label}
              aria-pressed={o.value === value}
              className="rounded-md border p-2"
              style={{
                borderColor: o.value === value ? "var(--ts-accent)" : "transparent",
                minWidth: "var(--ts-size-touch-min)",
                minHeight: "var(--ts-size-touch-min)",
              }}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <Icon name={o.icon} size={16} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
