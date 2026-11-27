import Chip from "./ui/Chip";
import { EntityPicker } from "./ui/EntityPicker";
import { useEffect, useMemo, useState } from "react";
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

  // A typed name must survive the user clicking Save without pressing Enter:
  // the click's mousedown blurs the input first, and the commit lands (a
  // discrete event, flushed synchronously) before the click handler runs.
  // Pressing a suggestion must not blur the input (the picker keeps focus in
  // the box on mousedown), or the half-typed query would be committed as a
  // stray chip next to the picked name.
  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((name) => (
            <Chip
              key={name}
              onRemove={(): void => handleRemove(name)}
              removeLabel={t("picker.remove", { name })}
              // The Vitest-global react-i18next mock is an identity function
              // that ignores interpolation options, so every chip's aria-label
              // resolves to the same literal string ("picker.remove") under
              // test regardless of `name` — a per-name test id is what lets
              // tests target one specific chip's remove button.
              removeTestId={`companion-remove-${name}`}
            >
              {name}
            </Chip>
          ))}
        </div>
      )}
      <EntityPicker
        popover
        hideLabel
        label={t("picker.label")}
        placeholder={t("picker.placeholder")}
        query={query}
        onQueryChange={setQuery}
        options={filtered.map((companion) => ({ id: String(companion.id), label: companion.name }))}
        onPick={(option): void => commit(String(option.label))}
        onSubmitText={commit}
        onBlur={(): void => commit(query)}
        showEmpty={false}
      />
    </div>
  );
}
