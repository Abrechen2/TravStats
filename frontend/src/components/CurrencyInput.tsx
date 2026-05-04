import { useId } from "react";
import { CURRENCY_OPTIONS, getCurrencyDisplayName } from "../lib/units";

interface CurrencyInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  /** id of the form control, useful when paired with an external `<label>`. */
  id?: string;
  /** Force the picker open on focus even when the field already has a value. */
  autoFocus?: boolean;
}

/**
 * Currency picker — combobox over an HTML5 `<datalist>` so the curated
 * CURRENCY_OPTIONS list is suggested but ANY ISO 4217 alpha-3 code can be
 * typed. Backend validates the same shape (`^[A-Z]{3}$`).
 *
 * The native `<datalist>` element gives us:
 *   - dropdown of suggestions (typeahead-filtered as the user types)
 *   - freedom to enter a code outside the curated list (e.g. KGS, LKR)
 *   - browser-native UX without an external combobox library
 */
export default function CurrencyInput({
  value,
  onChange,
  className = "input",
  required = false,
  id,
  autoFocus,
}: CurrencyInputProps): JSX.Element {
  const reactId = useId();
  const listId = `currency-codes-${reactId}`;
  // If the current value sits outside the curated list (legacy / API
  // direct submit) prepend it so the picker still recognises it.
  const options = CURRENCY_OPTIONS.includes(value)
    ? CURRENCY_OPTIONS
    : value
      ? [value, ...CURRENCY_OPTIONS]
      : CURRENCY_OPTIONS;

  return (
    <>
      <input
        id={id}
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className={className}
        maxLength={3}
        pattern="[A-Za-z]{3}"
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        // Show the title attribute as a tooltip with the localized name —
        // useful when the user hovers over a code they don't recognise.
        title={value ? `${value} — ${getCurrencyDisplayName(value)}` : undefined}
      />
      <datalist id={listId}>
        {options.map((code) => (
          <option key={code} value={code} label={getCurrencyDisplayName(code)} />
        ))}
      </datalist>
    </>
  );
}
