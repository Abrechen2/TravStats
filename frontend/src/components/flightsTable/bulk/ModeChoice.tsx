import type { JSX } from "react";

/**
 * A row of radio choices whose whole LABEL is the target — 44 px tall on a
 * coarse pointer (forgejo#249). A native radio is 13 px; the iPad check of the
 * lodging package found exactly that size defect on its native checkbox.
 */
export const CHOICE_TOUCH =
  "inline-flex items-center gap-2 pointer-coarse:min-h-(--ts-size-touch-min) cursor-pointer";

export default function ModeChoice<T extends string>({
  name,
  value,
  options,
  onChange,
  legend,
  firstId,
}: {
  name: string;
  /** Id of the first choice's input, so a hint can take the cursor there. */
  firstId?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  legend: string;
}): JSX.Element {
  return (
    <fieldset className="flex flex-col" style={{ gap: 4 }}>
      <legend className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {legend}
      </legend>
      <div className="flex flex-wrap" style={{ columnGap: 16 }}>
        {options.map((option, i) => (
          <label key={option.value} className={`${CHOICE_TOUCH} text-sm`}>
            <input
              id={i === 0 ? firstId : undefined}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="h-4 w-4"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
