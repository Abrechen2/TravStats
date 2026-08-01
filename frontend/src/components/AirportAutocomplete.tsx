import { useState, useEffect, useRef } from "react";
import { airportsApi, Airport, setupApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useTranslation } from "../hooks/useTranslation";

interface AirportAutocompleteProps {
  value?: Airport | null;
  onChange: (airport: Airport | null) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
  /** Fires on the input's native focus event, IN ADDITION to (not instead
   *  of) the component's own dropdown-open behavior. Opt-in — existing
   *  callers that don't pass it see no change. */
  onFocus?: () => void;
  /** Fires on the input's native blur event. Opt-in, same as `onFocus`.
   *  Neither this nor `onFocus` existed before a caller (RouteFields)
   *  needed to tell "the user left this field without landing on a valid
   *  selection" apart from "still actively typing/searching" — the
   *  component otherwise exposes no such signal (no "search settled"
   *  event, no ref). */
  onBlur?: () => void;
}

export default function AirportAutocomplete({
  value,
  onChange,
  label,
  placeholder,
  required = false,
  onFocus,
  onBlur,
}: AirportAutocompleteProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Airport[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const defaultPlaceholder = placeholder || t("flights:airportAutocomplete.placeholder");

  // Check if airport seeding is in progress
  useEffect(() => {
    const checkSeedingStatus = async () => {
      try {
        const status = await setupApi.getAirportSeedingStatus();
        setIsSeeding(status.status === "running" || status.status === "pending");
      } catch (error) {
        logger.warn("Failed to check airport seeding status", { error });
        setIsSeeding(false);
      }
    };

    checkSeedingStatus();
    // Check periodically while component is mounted
    const interval = setInterval(checkSeedingStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Update display when value changes
  useEffect(() => {
    if (value) {
      const display = value.iata || value.icao || value.name;
      setQuery(display);
    } else {
      // Only clear query if input is NOT focused (to avoid clearing while user is typing)
      const input = wrapperRef.current?.querySelector("input");
      if (document.activeElement !== input) {
        setQuery("");
      }
    }
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    if (isSeeding || query.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setLoading(true);

        // First try regular search
        const airports = await airportsApi.search(query);

        // If no results and query looks like an airport code (3-4 uppercase letters)
        // try direct lookup which will fetch from external API if needed
        if (airports.length === 0 && /^[A-Z]{3,4}$/i.test(query.trim())) {
          logger.debug(`No results for "${query}", trying external search...`);
          try {
            const airport = await airportsApi.getByCode(query.trim().toUpperCase());
            setResults([airport]);
          } catch (error) {
            logger.warn("Airport search failed", { error });
            setResults([]);
          }
        } else {
          setResults(airports);
        }

        // Only auto-open the dropdown when the field is actually focused (the
        // user is typing/interacting). Otherwise a programmatic query sync —
        // e.g. a pre-filled value when a modal first mounts — would pop every
        // autocomplete open on open. Focus-driven opening still covers the
        // type-to-search and onFocus paths.
        const input = wrapperRef.current?.querySelector("input");
        if (document.activeElement === input) {
          setIsOpen(true);
        }
      } catch (error) {
        logger.error("Airport search failed:", error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (airport: Airport) => {
    onChange(airport);
    const display = airport.iata || airport.icao || airport.name;
    setQuery(display);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);

    // Clear selection if user types
    if (value && newQuery !== (value.iata || value.icao || value.name)) {
      onChange(null);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label className="label">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => {
          if (!isSeeding && query.length >= 2) setIsOpen(true);
          onFocus?.();
        }}
        onBlur={() => onBlur?.()}
        placeholder={isSeeding ? t("flights:airportAutocomplete.seeding") : defaultPlaceholder}
        className="input"
        required={required}
        autoComplete="off"
        disabled={isSeeding}
        title={isSeeding ? t("flights:airportAutocomplete.seedingTitle") : undefined}
      />

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute z-10 w-full mt-1 rounded-lg shadow-lg max-h-60 overflow-auto"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
        >
          {loading && (
            <div className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
              {/^[A-Z]{3,4}$/i.test(query.trim())
                ? t("flights:airportAutocomplete.searchingWorldwide")
                : t("flights:airportAutocomplete.searching")}
            </div>
          )}

          {!loading && results.length === 0 && query.length >= 2 && (
            <div className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
              {/^[A-Z]{3,4}$/i.test(query.trim())
                ? t("flights:airportAutocomplete.notFound", { code: query.toUpperCase() })
                : t("flights:airportAutocomplete.noResults")}
            </div>
          )}

          {!loading &&
            results.map((airport) => (
              <button
                key={airport.id}
                type="button"
                // Prevents the browser's default mousedown action (shifting
                // focus to this button), which would otherwise blur the
                // text input a beat BEFORE this button's own click fires
                // handleSelect. That ordering made a caller listening for
                // blur (RouteFields' unresolved-airport hint) see the field
                // as abandoned for one render, for a selection that was
                // about to succeed. Keeping focus on the input means the
                // click completes with no intervening blur at all — for a
                // mouse pick specifically; keyboard selection (Tab focuses
                // this button directly, no mousedown involved) and the
                // click-outside-close handler are untouched by this.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(airport)}
                className="w-full px-4 py-2 text-left focus:outline-hidden border-b last:border-0"
                style={{ borderColor: "var(--color-border)" }}
                title={
                  airport.isClosed ? t("flights:airportAutocomplete.closedTooltip") : undefined
                }
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {airport.iata && (
                        <span className="font-semibold" style={{ color: "var(--accent)" }}>
                          {airport.iata}
                        </span>
                      )}
                      {airport.iata && airport.icao && (
                        <span className="mx-1" style={{ color: "var(--text-muted)" }}>
                          /
                        </span>
                      )}
                      {airport.icao && (
                        <span className="" style={{ color: "var(--text-muted)" }}>
                          {airport.icao}
                        </span>
                      )}
                      <span className="ml-2">{airport.name}</span>
                      {airport.isClosed && (
                        <span
                          className="ml-2 px-1.5 py-0.5 text-xs rounded-sm"
                          style={{
                            background: "rgba(220, 38, 38, 0.15)",
                            color: "var(--text-muted)",
                            border: "1px solid rgba(220, 38, 38, 0.35)",
                          }}
                        >
                          {t("flights:airportAutocomplete.closedBadge")}
                        </span>
                      )}
                    </div>
                    <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {airport.city && airport.country && `${airport.city}, ${airport.country}`}
                      {airport.city && !airport.country && airport.city}
                      {!airport.city && airport.country && airport.country}
                    </div>
                  </div>
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
