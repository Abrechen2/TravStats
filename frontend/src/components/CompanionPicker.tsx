import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { companionsApi, type Companion } from "../lib/api";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * Shared companion picker: autocompletes over the user's known companions
 * (most-used first, from `GET /companions`) while still allowing free-text
 * entry — a name that never appears in the suggestion list must still be
 * enterable, since not every travel companion is a returning one.
 *
 * The current value renders as removable chips above the input. A failed
 * suggestion fetch degrades to a plain input (empty suggestion list) rather
 * than blocking typing — the picker is not important enough to stop someone
 * entering a flight.
 */
export default function CompanionPicker({ value, onChange }: Props): JSX.Element {
  const { t } = useTranslation("companions");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Companion[]>([]);

  useEffect(() => {
    let cancelled = false;
    companionsApi
      .list()
      .then((result) => {
        if (!cancelled) setSuggestions(result);
      })
      .catch((error: unknown) => {
        logger.warn("Failed to load companion suggestions", { error });
        if (!cancelled) setSuggestions([]);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    return suggestions.filter(
      (companion) =>
        companion.name.toLowerCase().includes(trimmed) &&
        !value.some((v) => v.toLowerCase() === companion.name.toLowerCase())
    );
  }, [query, suggestions, value]);

  const commit = (name: string): void => {
    const trimmed = name.trim();
    setQuery("");
    if (!trimmed) return;
    if (value.some((v) => v.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...value, trimmed]);
  };

  const handleRemove = (name: string): void => {
    onChange(value.filter((v) => v !== name));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(query);
    }
  };

  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-(--bg-elevated) px-2 py-0.5 text-sm text-(--text-primary)"
            >
              {name}
              <button
                type="button"
                // Hardcoded German suffix (not routed through t()) to match the
                // house convention for chip-remove buttons, see
                // BoardingPassAnnotation.tsx / EmailAnnotation.tsx.
                aria-label={`${name} entfernen`}
                onClick={(): void => handleRemove(name)}
                className="text-(--text-muted) hover:text-(--text-primary)"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        role="combobox"
        aria-expanded={filtered.length > 0}
        aria-autocomplete="list"
        aria-label={t("picker.label")}
        className="w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden"
        placeholder={t("picker.placeholder")}
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-(--bg-surface) shadow-lg">
          {filtered.map((companion) => (
            <li key={companion.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-(--text-primary) hover:bg-(--bg-elevated)"
                onClick={(): void => commit(companion.name)}
              >
                {companion.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
