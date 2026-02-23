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
}

export default function AirportAutocomplete({
  value,
  onChange,
  label,
  placeholder,
  required = false,
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
        // If check fails, assume not seeding
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
          } catch (lookupError) {
            logger.debug("External search also found nothing");
            setResults([]);
          }
        } else {
          setResults(airports);
        }

        setIsOpen(true);
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
        onFocus={() => !isSeeding && query.length >= 2 && setIsOpen(true)}
        placeholder={isSeeding ? t("flights:airportAutocomplete.seeding") : defaultPlaceholder}
        className="input"
        required={required}
        autoComplete="off"
        disabled={isSeeding}
        title={isSeeding ? t("flights:airportAutocomplete.seedingTitle") : undefined}
      />

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
          {loading && (
            <div className="px-4 py-3 text-sm text-gray-500">
              {/^[A-Z]{3,4}$/i.test(query.trim())
                ? t("flights:airportAutocomplete.searchingWorldwide")
                : t("flights:airportAutocomplete.searching")}
            </div>
          )}

          {!loading && results.length === 0 && query.length >= 2 && (
            <div className="px-4 py-3 text-sm text-gray-500">
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
                onClick={() => handleSelect(airport)}
                className="w-full px-4 py-2 text-left hover:bg-blue-50 focus:bg-blue-50 focus:outline-none border-b last:border-0"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {airport.iata && <span className="text-blue-600">{airport.iata}</span>}
                      {airport.iata && airport.icao && (
                        <span className="text-gray-400 mx-1">/</span>
                      )}
                      {airport.icao && <span className="text-gray-600">{airport.icao}</span>}
                      <span className="ml-2">{airport.name}</span>
                    </div>
                    <div className="text-sm text-gray-500">
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
