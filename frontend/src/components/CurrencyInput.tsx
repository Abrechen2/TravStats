import { useEffect, useRef, useState } from "react";
import { CURRENCY_OPTIONS, getCurrencyDisplayName } from "../lib/units";

interface CurrencyInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  id?: string;
}

/**
 * Currency picker — styled combobox over CURRENCY_OPTIONS that also accepts
 * any ISO 4217 alpha-3 code typed by the user (full Option A from #100).
 * Built on the same layout pattern as AirportAutocomplete (anchored
 * dropdown, click-outside to close) so the look matches the rest of the
 * app instead of relying on the browser-native `<datalist>` popup.
 */
export default function CurrencyInput({
  value,
  onChange,
  className = "input",
  required = false,
  id,
}: CurrencyInputProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);

  // Sync query when the parent value changes (e.g. after form reset).
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter the curated list by the user's input — substring match on both
  // the ISO code ("INR") and the localized display name ("Indische Rupie").
  const upperQuery = query.toUpperCase();
  const filtered = CURRENCY_OPTIONS.filter((code) => {
    if (!query) return true;
    if (code.includes(upperQuery)) return true;
    const name = getCurrencyDisplayName(code).toLowerCase();
    return name.includes(query.toLowerCase());
  });

  // If the user typed a 3-letter code that's not in the curated list,
  // surface it as a "use this code" option so freeform entries (KGS, LKR,
  // NGN, …) feel intentional rather than accidental.
  const isFreeformCode = /^[A-Z]{3}$/.test(upperQuery) && !CURRENCY_OPTIONS.includes(upperQuery);

  const commit = (code: string): void => {
    const upper = code.toUpperCase();
    onChange(upper);
    setQuery(upper);
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id={id}
        type="text"
        value={query}
        onChange={(e) => {
          const next = e.target.value.toUpperCase().slice(0, 3);
          setQuery(next);
          setIsOpen(true);
          // Mirror the typed value upstream as soon as it parses as a valid
          // ISO 4217 code, so a user typing "KGS" → tab away commits the
          // value without needing to click a dropdown row.
          if (/^[A-Z]{3}$/.test(next)) {
            onChange(next);
          }
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const trimmed = upperQuery;
            if (/^[A-Z]{3}$/.test(trimmed)) commit(trimmed);
          } else if (e.key === "Escape") {
            setIsOpen(false);
          }
        }}
        className={className}
        maxLength={3}
        pattern="[A-Za-z]{3}"
        required={required}
        autoComplete="off"
        spellCheck={false}
        title={value ? `${value} — ${getCurrencyDisplayName(value)}` : undefined}
      />

      {isOpen && (
        <div
          className="absolute z-10 w-full mt-1 rounded-lg shadow-lg max-h-60 overflow-auto"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--color-border)",
          }}
        >
          {isFreeformCode && (
            <button
              type="button"
              onClick={() => commit(upperQuery)}
              className="w-full px-4 py-2 text-left focus:outline-hidden border-b"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="font-medium">
                <span className="font-semibold" style={{ color: "var(--accent)" }}>
                  {upperQuery}
                </span>
                <span className="ml-2">{getCurrencyDisplayName(upperQuery)}</span>
              </div>
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                ISO 4217 — direkt verwenden
              </div>
            </button>
          )}

          {filtered.length === 0 && !isFreeformCode && (
            <div className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
              Keine Treffer — gib einen 3-Buchstaben-Code ein (z. B. INR, JPY, KGS).
            </div>
          )}

          {filtered.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => commit(code)}
              className="w-full px-4 py-2 text-left focus:outline-hidden border-b last:border-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="font-medium">
                <span
                  className={code === value ? "font-semibold" : "font-semibold"}
                  style={{ color: code === value ? "var(--accent)" : "var(--text-primary)" }}
                >
                  {code}
                </span>
                <span className="ml-2" style={{ color: "var(--text-muted)" }}>
                  {getCurrencyDisplayName(code)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
