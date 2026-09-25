import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";

interface SuggestionChipsProps {
  /** The field's current text — chips narrow to what it starts with. */
  value: string;
  suggestions: readonly string[];
  onPick: (value: string) => void;
  /** Names the field in each chip's accessible label ("Sitzplatz 12A"). */
  fieldLabel: string;
}

/**
 * One-click values from the user's own history, under a free-text field.
 *
 * Offered, never written: the field stays free text, and a chip only replaces
 * its value when clicked. While the user types, the chips narrow to the ones
 * that continue what is there, and the one already in the field disappears —
 * a chip that would change nothing is noise.
 */
export default function SuggestionChips({
  value,
  suggestions,
  onPick,
  fieldLabel,
}: SuggestionChipsProps): JSX.Element | null {
  const { t } = useTranslation(["flights"]);
  const typed = value.trim().toUpperCase();
  const visible = suggestions.filter((s) => {
    const candidate = s.toUpperCase();
    return candidate !== typed && candidate.startsWith(typed);
  });
  if (visible.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {visible.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          aria-label={t("flights:form.suggestionChip", { field: fieldLabel, value: s })}
          className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent)"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
