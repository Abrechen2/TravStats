import type { JSX } from "react";

const STAR_COUNT = 5;
const STAR_VALUES = Array.from({ length: STAR_COUNT }, (_, i) => i + 1);

interface StarRatingInputProps {
  /** Stable key for this rating field (e.g. "room", "breakfast") — used in data-testid, not shown. */
  fieldKey: string;
  /** Visible label above the stars. */
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

/**
 * A 1–5 star picker with half-star support (step 0.5), matching the ratings
 * the backend accepts (`schemas/lodging.ts`'s `rating` = `z.number().min(1).max(5)`
 * — no integer constraint, so 4.5 is a perfectly valid value already).
 *
 * Each star is really two stacked half-width buttons (left = X.5, right = X)
 * rather than a single click target whose half is resolved from pointer
 * position — jsdom doesn't lay out real geometry, so a position-based split
 * would be untestable. Each half carries a stable `data-testid`
 * (`star-{fieldKey}-{value}`) so tests can pick an exact rating deterministically.
 */
export function StarRatingInput({
  fieldKey,
  label,
  value,
  onChange,
  disabled,
}: StarRatingInputProps): JSX.Element {
  const current = value ?? 0;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <div className="flex items-center gap-1" role="group" aria-label={label}>
        {STAR_VALUES.map((starIndex) => {
          const fillRatio = Math.max(0, Math.min(1, current - (starIndex - 1)));
          const halfValue = starIndex - 0.5;
          return (
            <span key={starIndex} className="relative inline-block h-5 w-5 text-lg leading-none">
              <span aria-hidden className="absolute inset-0 text-[var(--color-border)]">
                ★
              </span>
              <span
                aria-hidden
                className="absolute inset-0 overflow-hidden text-[var(--star)]"
                style={{ width: `${fillRatio * 100}%` }}
              >
                ★
              </span>
              <button
                type="button"
                disabled={disabled}
                data-testid={`star-${fieldKey}-${halfValue}`}
                aria-label={`${halfValue} — ${label}`}
                className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                onClick={() => onChange(halfValue)}
              />
              <button
                type="button"
                disabled={disabled}
                data-testid={`star-${fieldKey}-${starIndex}`}
                aria-label={`${starIndex} — ${label}`}
                className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                onClick={() => onChange(starIndex)}
              />
            </span>
          );
        })}
        {value !== null && (
          <button
            type="button"
            disabled={disabled}
            data-testid={`star-${fieldKey}-clear`}
            onClick={() => onChange(null)}
            className="ml-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
