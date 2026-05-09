/**
 * EventLocationPicker — hybrid geocoding + mini-map widget.
 *
 * Used by the Event sub-type of SpecialFlightModal to replace the former
 * bare lat/lon number pair. Three synchronized surfaces share one position:
 *
 *   1. Top search input — debounced (400 ms) Nominatim query; dropdown with
 *      up to five hits. Selecting a hit sets lat/lon + centers the map.
 *   2. Mini-map (MapLibre GL) — draggable marker + click-to-move. Matches
 *      the light/dark palette used by the main DeckGL map so the widget
 *      visually belongs to the rest of the app.
 *   3. Collapsible "Erweitert" panel — raw `Breite` / `Länge` number inputs
 *      for power users with copy-pasted coordinates. Validated to the
 *      normal decimal-degree ranges.
 *
 * Controlled interface: parent owns the `{ lat, lon }` state and receives
 * updates via `onChange`. The picker keeps no position state of its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { NominatimError, searchPlaces, type NominatimPlace } from "../../lib/nominatim";

/** MapLibre styles — reuse the same CartoCDN basemaps as DeckGLMap so the
 *  mini-map blends visually with the main map. */
const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Fallback view when no position is set — Europe-centered, continent-scale. */
const DEFAULT_VIEW = { longitude: 10, latitude: 50, zoom: 3 };

/** Zoom level applied when a new position is picked — city/landmark scale. */
const PICKED_ZOOM = 9;

const SEARCH_DEBOUNCE_MS = 400;
const MIN_QUERY_CHARS = 2;

export interface EventLocationValue {
  lat: number | null;
  lon: number | null;
}

interface EventLocationPickerProps {
  value: EventLocationValue;
  onChange: (next: EventLocationValue) => void;
  /** Optional id prefix so multiple pickers on the same page don't collide. */
  idPrefix?: string;
}

function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

function isValidLon(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function numToInput(n: number | null): string {
  return n === null ? "" : String(n);
}

function inputToNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function EventLocationPicker({
  value,
  onChange,
  idPrefix = "event-location",
}: EventLocationPickerProps): JSX.Element {
  const { t } = useTranslation(["specialFlights"]);

  const mapRef = useRef<MapRef | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<NominatimPlace[]>([]);
  const [isDropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [isSearching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  const hasPosition = value.lat !== null && value.lon !== null;

  // ---- Nominatim search (debounced + abortable) --------------------------
  const runSearch = useCallback(async (q: string): Promise<void> => {
    // Cancel any in-flight request before starting a new one — respects the
    // "no parallel requests" clause of the Nominatim usage policy.
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    setSearchError(null);
    try {
      const hits = await searchPlaces(q, controller.signal);
      // Late-arriving responses — ignore if a newer request has superseded us.
      if (controller.signal.aborted) return;
      setResults(hits);
      setDropdownOpen(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (err instanceof NominatimError) {
        setSearchError(err.message);
      } else {
        logger.warn("Unexpected error from Nominatim search:", err);
        setSearchError("Unknown error");
      }
      setResults([]);
      setDropdownOpen(true);
    } finally {
      if (!controller.signal.aborted) {
        setSearching(false);
      }
    }
  }, []);

  // Debounce keystrokes before querying Nominatim. The timer is torn down on
  // every keystroke and on unmount so we never stack multiple timers.
  useEffect(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_CHARS) {
      setResults([]);
      setDropdownOpen(false);
      setSearchError(null);
      return;
    }

    debounceRef.current = window.setTimeout(() => {
      void runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [query, runSearch]);

  // Abort any pending request when the picker unmounts.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  // ---- Handlers ----------------------------------------------------------
  const handleSelectResult = useCallback(
    (hit: NominatimPlace): void => {
      onChange({ lat: hit.lat, lon: hit.lon });
      setQuery("");
      setResults([]);
      setDropdownOpen(false);
      setSearchError(null);
      const map = mapRef.current;
      // `flyTo` is provided by MapLibre — guard its presence so test harnesses
      // that stub the Map component don't blow up here.
      if (map && typeof map.flyTo === "function") {
        map.flyTo({ center: [hit.lon, hit.lat], zoom: PICKED_ZOOM, duration: 600 });
      }
    },
    [onChange]
  );

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent): void => {
      const { lng, lat } = e.lngLat;
      if (!isValidLat(lat) || !isValidLon(lng)) return;
      onChange({ lat, lon: lng });
    },
    [onChange]
  );

  const handleMarkerDragEnd = useCallback(
    (e: { lngLat: { lng: number; lat: number } }): void => {
      const { lng, lat } = e.lngLat;
      if (!isValidLat(lat) || !isValidLon(lng)) return;
      onChange({ lat, lon: lng });
    },
    [onChange]
  );

  const handleClear = useCallback((): void => {
    onChange({ lat: null, lon: null });
    setQuery("");
    setResults([]);
    setDropdownOpen(false);
    setSearchError(null);
  }, [onChange]);

  const handleLatInput = useCallback(
    (raw: string): void => {
      const n = inputToNum(raw);
      if (n === null) {
        onChange({ lat: null, lon: value.lon });
        return;
      }
      if (!isValidLat(n)) return;
      onChange({ lat: n, lon: value.lon });
    },
    [onChange, value.lon]
  );

  const handleLonInput = useCallback(
    (raw: string): void => {
      const n = inputToNum(raw);
      if (n === null) {
        onChange({ lat: value.lat, lon: null });
        return;
      }
      if (!isValidLon(n)) return;
      onChange({ lat: value.lat, lon: n });
    },
    [onChange, value.lat]
  );

  // ---- Derived view state ------------------------------------------------
  const initialViewState = useMemo(() => {
    if (hasPosition && value.lat !== null && value.lon !== null) {
      return { longitude: value.lon, latitude: value.lat, zoom: PICKED_ZOOM };
    }
    return DEFAULT_VIEW;
  }, [hasPosition, value.lat, value.lon]);

  const mapStyle = DARK_MAP_STYLE;

  // ---- Render ------------------------------------------------------------
  return (
    <div className="space-y-3">
      {/* Search input + dropdown */}
      <div className="relative">
        <label className="label" htmlFor={`${idPrefix}-search`}>
          {t("specialFlights:location.searchLabel")}
        </label>
        <input
          id={`${idPrefix}-search`}
          type="text"
          autoComplete="off"
          className="input"
          placeholder={t("specialFlights:location.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0 || searchError) setDropdownOpen(true);
          }}
        />
        {!hasPosition && (
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("specialFlights:location.searchHint")}
          </p>
        )}

        {isDropdownOpen && (
          <div
            className="absolute left-0 right-0 z-20 mt-1 rounded-md border shadow-lg overflow-hidden"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--color-border)",
            }}
            role="listbox"
          >
            {isSearching && (
              <div className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
                …
              </div>
            )}
            {!isSearching && searchError && (
              <div
                className="px-3 py-2 text-sm"
                style={{ color: "var(--text-muted)" }}
                role="alert"
              >
                {t("specialFlights:location.searchError")}
              </div>
            )}
            {!isSearching && !searchError && results.length === 0 && (
              <div className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
                {t("specialFlights:location.noResults")}
              </div>
            )}
            {!isSearching &&
              !searchError &&
              results.map((hit) => (
                <button
                  key={`${hit.lat}-${hit.lon}-${hit.displayName}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleSelectResult(hit)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-elevated)] transition-colors"
                  style={{ color: "var(--text-primary)" }}
                >
                  {hit.displayName}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Mini-map */}
      <div
        className="relative rounded-md overflow-hidden border"
        style={{
          height: 320,
          borderColor: "var(--color-border)",
          background: "var(--bg-elevated)",
        }}
        aria-label={t("specialFlights:location.mapAriaLabel")}
      >
        <Map
          ref={(r) => {
            mapRef.current = r;
          }}
          initialViewState={initialViewState}
          mapStyle={mapStyle}
          style={{ position: "absolute", inset: 0 }}
          onClick={handleMapClick}
          attributionControl={false}
        >
          {hasPosition && value.lat !== null && value.lon !== null && (
            <Marker
              longitude={value.lon}
              latitude={value.lat}
              draggable
              onDragEnd={handleMarkerDragEnd}
              anchor="bottom"
            >
              <div
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50% 50% 50% 0",
                  background: "var(--accent, #ffc107)",
                  border: "2px solid white",
                  transform: "rotate(-45deg)",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
                }}
              />
            </Marker>
          )}
        </Map>
      </div>

      {/* Attribution + clear link */}
      <div className="flex items-center justify-between text-xs">
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--text-muted)", textDecoration: "underline" }}
        >
          {t("specialFlights:location.attribution")}
        </a>
        {hasPosition && (
          <button
            type="button"
            onClick={handleClear}
            className="hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            {t("specialFlights:location.clear")}
          </button>
        )}
      </div>

      {/* Advanced (raw lat/lon) — collapsible */}
      <details
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary
          className="cursor-pointer text-sm select-none"
          style={{ color: "var(--text-muted)" }}
        >
          {t("specialFlights:location.advanced")}
        </summary>
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div>
            <label className="label" htmlFor={`${idPrefix}-lat`}>
              {t("specialFlights:field.event_lat")}
            </label>
            <input
              id={`${idPrefix}-lat`}
              type="number"
              step="any"
              min={-90}
              max={90}
              className="input"
              style={{ colorScheme: "dark" }}
              value={numToInput(value.lat)}
              onChange={(e) => handleLatInput(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${idPrefix}-lon`}>
              {t("specialFlights:field.event_lon")}
            </label>
            <input
              id={`${idPrefix}-lon`}
              type="number"
              step="any"
              min={-180}
              max={180}
              className="input"
              style={{ colorScheme: "dark" }}
              value={numToInput(value.lon)}
              onChange={(e) => handleLonInput(e.target.value)}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

export default EventLocationPicker;
