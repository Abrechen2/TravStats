import { useId, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { useTranslation } from "../../hooks/useTranslation";

interface Props {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
  /** Normalises a typed value; null rejects it with `invalidMessage`. */
  accept: (raw: string) => string | null;
  invalidMessage?: string;
  /** Offered in a datalist — values the logbook already uses. */
  options?: string[];
  testId: string;
}

/**
 * A short list of free values — the airline codes or cruise lines a card
 * covers. Enter (or the add button) commits the typed value; each chip
 * removes itself. Duplicates, compared case-insensitively, are not added
 * twice, which is also what the server does.
 */
export default function ValueChips({
  label,
  hint,
  values,
  onChange,
  accept,
  invalidMessage,
  options = [],
  testId,
}: Props): JSX.Element {
  const { t } = useTranslation(["loyalty", "common"]);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const listId = useId();

  const commit = (): void => {
    if (draft.trim() === "") return;
    const value = accept(draft);
    if (value === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft("");
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) return;
    onChange([...values, value]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
  };

  return (
    <fieldset data-testid={testId}>
      <legend className="label">{label}</legend>
      {values.length > 0 && (
        <ul className="mb-1 flex flex-wrap gap-1">
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{ background: "var(--ts-tile)", color: "var(--ts-text)" }}
            >
              {value}
              <button
                type="button"
                aria-label={t("loyalty:field.removeValue", { value })}
                onClick={() => onChange(values.filter((v) => v !== value))}
                style={{ color: "var(--ts-muted)" }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          aria-label={label}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={onKeyDown}
          className="input"
          list={options.length > 0 ? listId : undefined}
        />
        <button type="button" onClick={commit} className="btn-secondary">
          {t("common:buttons.add")}
        </button>
      </div>
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
      <p className="t-caption mt-1" style={invalid ? { color: "var(--ts-bad)" } : undefined}>
        {invalid && invalidMessage ? invalidMessage : hint}
      </p>
    </fieldset>
  );
}
