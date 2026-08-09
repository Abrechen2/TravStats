import { useState, useEffect, useRef } from "react";
import { airlinesApi, aircraftApi } from "../../../lib/api/catalogue";
import { logger } from "../../../lib/logger";

/** One row in the dropdown. `codes` carries whatever identifiers the
 *  catalogue has for the entry (IATA/ICAO for airlines, ICAO for aircraft),
 *  already filtered down to the ones that exist. */
export interface CatalogueOption {
  id: number;
  name: string;
  codes: string[];
}

interface CatalogueComboboxProps {
  value: string;
  onChange: (value: string) => void;
  search: (q: string) => Promise<CatalogueOption[]>;
  placeholder?: string;
  /** Extra class appended to the input — the create form passes its
   *  density-sized input class through here. */
  inputClassName?: string;
}

/** Stable adapter references (module-level on purpose): the debounce effect
 *  depends on `search`, so an inline arrow in a form would re-arm the timer
 *  on every parent render. */
export async function searchAirlineOptions(q: string): Promise<CatalogueOption[]> {
  const airlines = await airlinesApi.search(q);
  return airlines.map((a) => ({
    id: a.id,
    name: a.name,
    codes: [a.iata, a.icao].filter((c): c is string => Boolean(c)),
  }));
}

export async function searchAircraftOptions(q: string): Promise<CatalogueOption[]> {
  const aircraft = await aircraftApi.search(q);
  return aircraft.map((a) => ({
    id: a.id,
    name: a.name,
    codes: [a.icao].filter((c): c is string => Boolean(c)),
  }));
}

/** A plain string input with catalogue suggestions — the shared airline /
 *  operating-airline / aircraft control for both flight forms (#189/#191
 *  built the catalogues; this is how they reach the forms).
 *
 *  The VALUE IS THE QUERY: every keystroke propagates through `onChange`
 *  exactly like the text inputs this replaces, and a dropdown pick merely
 *  replaces the value with the catalogue entry's name. That keeps free text
 *  valid by construction — an airline the catalogue doesn't know stays
 *  enterable, because refusing it would break manual entry for exactly the
 *  flights that need it most. For the same reason an empty result set
 *  renders NO dropdown and no "not found" notice: not matching the
 *  catalogue is a normal way to use this field, not an error.
 *
 *  Interaction details follow AirportAutocomplete, the house pattern for
 *  this shape: 300ms debounce, outside-click close, auto-open only while
 *  the input is focused, and `onMouseDown` preventDefault on the option
 *  buttons so a mouse pick never blurs the input mid-click. One addition:
 *  a pick suppresses the follow-up search its own value change would
 *  schedule — the mousedown fix keeps the input focused through the pick,
 *  so without the suppression the dropdown would reopen under the user's
 *  cursor 300ms after every selection. */
export default function CatalogueCombobox({
  value,
  onChange,
  search,
  placeholder,
  inputClassName = "",
}: CatalogueComboboxProps): JSX.Element {
  const [results, setResults] = useState<CatalogueOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pickedRef = useRef<string | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (value.trim().length < 2 || pickedRef.current === value) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const options = await search(value);
        setResults(options);
        // Only auto-open while the user is actually in the field — a
        // programmatic value sync (e.g. a modal seeding its form state)
        // must not pop the dropdown open.
        const input = wrapperRef.current?.querySelector("input");
        if (options.length > 0 && document.activeElement === input) {
          setIsOpen(true);
        }
      } catch (error) {
        // Non-critical: the field keeps working as plain text without
        // suggestions, same as the datalist inputs it replaced.
        logger.warn("Catalogue search failed", { error });
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [value, search]);

  const handleSelect = (option: CatalogueOption): void => {
    pickedRef.current = option.name;
    onChange(option.name);
    setResults([]);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    pickedRef.current = null;
    onChange(e.target.value);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        className={`input ${inputClassName}`.trim()}
        autoComplete="off"
      />

      {isOpen && results.length > 0 && (
        <div
          className="absolute z-10 w-full mt-1 rounded-lg shadow-lg max-h-60 overflow-auto"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
        >
          {results.map((option) => (
            <button
              key={option.id}
              type="button"
              // Same fix as AirportAutocomplete: the browser's default
              // mousedown would move focus to this button and blur the
              // input a beat before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(option)}
              className="w-full px-4 py-2 text-left focus:outline-hidden border-b last:border-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              {option.codes.length > 0 && (
                <span className="font-semibold mr-2" style={{ color: "var(--accent)" }}>
                  {option.codes.join(" / ")}
                </span>
              )}
              <span>{option.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
