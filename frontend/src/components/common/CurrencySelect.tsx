import { useMemo, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { ECB_CURRENCIES, ISO_4217 } from "../../shared/currencies";
import { getCurrencyDisplayName } from "../../lib/units";

interface CurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
  /** The user's own currencies, most-used first — see GET /currencies/recent. */
  recent?: readonly string[];
  /** Narrow the choice, e.g. to the ECB set for the FX base currency. */
  restrictTo?: readonly string[];
  id?: string;
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

/**
 * The one currency picker, for every domain.
 *
 * It replaced six copies of `["EUR","USD","GBP","CHF"]`. 155 codes is too many
 * to scroll, so the control is a filter plus a grouped list: the currencies
 * this user actually books in come first, and an account with no history yet
 * gets the ECB set — the ones that are convertible — rather than an arbitrary
 * four.
 *
 * A native <select> underneath on purpose: keyboard behaviour, mobile pickers
 * and form semantics come for free, and <optgroup> gives each group a real
 * accessible name.
 */
export default function CurrencySelect({
  value,
  onChange,
  recent,
  restrictTo,
  id,
  className,
  "aria-label": ariaLabel,
  disabled,
}: CurrencySelectProps): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const all = useMemo(() => (restrictTo ? [...restrictTo] : Object.keys(ISO_4217)), [restrictTo]);

  const frequent = useMemo(() => {
    const seed = recent && recent.length > 0 ? recent : ECB_CURRENCIES;
    // The current value always belongs in the short list — otherwise a stay in
    // a currency the user has since stopped using would show up blank.
    const withValue = seed.includes(value) ? seed : [value, ...seed];
    return withValue.filter((code) => all.includes(code));
  }, [recent, value, all]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return { frequent, rest: all.filter((c) => !frequent.includes(c)) };
    // Search the localised NAME as well as the code: "dirham" has to find AED,
    // because that is the word a user knows.
    const hit = (code: string): boolean =>
      code.toLowerCase().includes(needle) ||
      getCurrencyDisplayName(code).toLowerCase().includes(needle);
    return {
      frequent: frequent.filter(hit),
      rest: all.filter((c) => !frequent.includes(c) && hit(c)),
    };
  }, [query, frequent, all]);

  const label = (code: string): string => `${code} — ${getCurrencyDisplayName(code)}`;

  return (
    <div className={className}>
      <input
        type="search"
        value={query}
        onChange={(e): void => setQuery(e.target.value)}
        placeholder={t("common:currencySelect.search")}
        aria-label={t("common:currencySelect.search")}
        disabled={disabled}
        className="mb-1 w-full rounded border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)]"
      />
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel ?? t("common:currencySelect.label")}
        onChange={(e): void => onChange(e.target.value)}
        className="w-full rounded border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1 text-sm text-[var(--text-primary)]"
      >
        {matches.frequent.length > 0 && (
          <optgroup label={t("common:currencySelect.frequent")}>
            {matches.frequent.map((code) => (
              <option key={code} value={code}>
                {label(code)}
              </option>
            ))}
          </optgroup>
        )}
        {matches.rest.length > 0 && (
          <optgroup label={t("common:currencySelect.all")}>
            {matches.rest.map((code) => (
              <option key={code} value={code}>
                {label(code)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
