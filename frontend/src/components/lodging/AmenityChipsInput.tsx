import { useState } from "react";
import type { JSX, KeyboardEvent } from "react";

interface AmenityChipsInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

/**
 * Chip-style array input for `LodgingStay.roomAmenities` — distinct from
 * the plain CSV text input `LodgingFormModal` uses for the lodging-level
 * `amenities` field. Each chip is added on Enter/comma/blur and removable
 * individually; a case-insensitive duplicate is silently ignored rather
 * than added twice.
 */
export function AmenityChipsInput({
  label,
  values,
  onChange,
  placeholder,
}: AmenityChipsInputProps): JSX.Element {
  const [draft, setDraft] = useState<string>("");

  const addChip = (): void => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    const isDuplicate = values.some((v) => v.toLowerCase() === trimmed.toLowerCase());
    if (!isDuplicate) onChange([...values, trimmed]);
    setDraft("");
  };

  const removeChip = (chip: string): void => {
    onChange(values.filter((v) => v !== chip));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addChip();
    }
  };

  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
      {label}
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-2">
        {values.map((chip) => (
          <span
            key={chip}
            data-testid={`amenity-chip-${chip}`}
            className="flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]"
          >
            {chip}
            <button
              type="button"
              aria-label={`remove ${chip}`}
              onClick={() => removeChip(chip)}
              className="text-[var(--text-muted)] hover:text-[var(--danger)]"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addChip}
          placeholder={placeholder}
          aria-label={label}
          className="min-w-[8ch] flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>
    </label>
  );
}
