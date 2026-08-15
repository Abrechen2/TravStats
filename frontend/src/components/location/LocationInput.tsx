/**
 * LocationInput — shared place-search + coordinate-paste + map-pin widget.
 *
 * One text field does double duty:
 *   1. Debounced Photon search-as-you-type (`useLocationSearch`) — an ARIA
 *      combobox dropdown of hits; selecting one reports every field.
 *   2. Coordinate-pair detection (`parseCoordinateInput`) on every keystroke
 *      /paste — when the current text IS a coordinate pair, the search is
 *      skipped entirely, the pin is set from the pair, and a translated
 *      "Koordinaten erkannt" hint replaces the dropdown.
 *
 * Below the field: a collapsible MapLibre mini-map (draggable `<Marker>` +
 * click-to-move — NOT deck.gl, per the plan) and a collapsible "Erweitert"
 * raw lat/lon panel. Both mirror `EventLocationPicker`'s UX (that component
 * is left untouched — this is a new, shared, from-scratch implementation).
 *
 * Controlled interface: the parent owns `{lat, lon} | null` and receives
 * every position change (search selection, paste, map, advanced panel) via
 * `onChange`. No map is mounted until the user opens it — the default render
 * (value=null, collapsed) never touches `react-map-gl`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";
import { useTranslation } from "../../hooks/useTranslation";
import { parseCoordinateInput } from "../../lib/coordinateParse";
import type { PlaceSearchResult } from "../../lib/api/geo";
import { useLocationSearch } from "./useLocationSearch";
import { LocationSuggestions } from "./LocationSuggestions";
import { LocationMiniMap } from "./LocationMiniMap";

const DEFAULT_VIEW = { longitude: 10, latitude: 50, zoom: 3 };
const PICKED_ZOOM = 9;

export interface LocationCoordinates {
  lat: number;
  lon: number;
}

/**
 * What a selection reports back to the parent. `name`/`address`/`city`/
 * `country`/`countryCode` are only populated by a search-result selection —
 * a coordinate paste, map click/drag, or advanced-panel edit reports just
 * `{lat, lon}` (the parent keeps whatever name/address it already has).
 */
export interface LocationSelection {
  lat: number;
  lon: number;
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  countryCode?: string;
}

export interface LocationInputProps {
  value: LocationCoordinates | null;
  onChange: (selection: LocationSelection) => void;
  /** Reduced chrome (shorter map, no search hint) for denser embeds — e.g.
   * the cruise PortPicker's "add custom port" panel (Task 7). */
  compact?: boolean;
  /** Overrides the search field's label; defaults to the shared translation. */
  label?: string;
  /** id prefix so multiple instances on one page never collide. */
  idPrefix?: string;
}

function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}
function isValidLon(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}
function numToInput(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}
function inputToNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
function placeToSelection(hit: PlaceSearchResult): LocationSelection {
  return {
    lat: hit.lat,
    lon: hit.lon,
    name: hit.name,
    address: hit.address,
    city: hit.city,
    country: hit.country,
    countryCode: hit.countryCode,
  };
}

export function LocationInput({
  value,
  onChange,
  compact = false,
  label,
  idPrefix = "location-input",
}: LocationInputProps): JSX.Element {
  const { t, i18n } = useTranslation(["location"]);

  const [query, setQuery] = useState("");
  const [coordsDetected, setCoordsDetected] = useState(false);
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [mapOpen, setMapOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [latInput, setLatInput] = useState<string>(numToInput(value?.lat));
  const [lonInput, setLonInput] = useState<string>(numToInput(value?.lon));

  const lang = i18n.language?.split("-")[0];
  // A detected coordinate pair skips the search entirely — passing "" is the
  // hook's own "too short, don't search" branch, so nothing fires.
  const { results, isSearching, searchError, reset } = useLocationSearch(
    coordsDetected ? "" : query,
    lang
  );

  // Keep the advanced raw inputs in sync when the parent changes `value`
  // externally (e.g. seeding the pin when editing an existing lodging).
  useEffect(() => {
    setLatInput(numToInput(value?.lat));
    setLonInput(numToInput(value?.lon));
  }, [value?.lat, value?.lon]);

  useEffect(() => {
    setDropdownOpen(!coordsDetected && (results.length > 0 || searchError));
    setActiveIndex(-1);
  }, [results, searchError, coordsDetected]);

  const hasPosition = value !== null;

  /**
   * Counts the coordinates that arrived from somewhere other than the map, so
   * the picker can fly to those and only those. The map must follow a search
   * hit; it must NOT follow a marker drag, which would pull the map out from
   * under the cursor mid-gesture.
   */
  const [focusNonce, setFocusNonce] = useState(0);
  const focusMap = useCallback((): void => setFocusNonce((n) => n + 1), []);

  const handleQueryChange = useCallback(
    (raw: string): void => {
      setQuery(raw);
      const parsed = parseCoordinateInput(raw);
      if (parsed) {
        setCoordsDetected(true);
        setDropdownOpen(false);
        onChange({ lat: parsed.lat, lon: parsed.lon });
        focusMap();
      } else {
        setCoordsDetected(false);
      }
    },
    [onChange, focusMap]
  );

  const handleSelectResult = useCallback(
    (hit: PlaceSearchResult): void => {
      onChange(placeToSelection(hit));
      setQuery("");
      setCoordsDetected(false);
      setDropdownOpen(false);
      reset();
      focusMap();
    },
    [onChange, reset, focusMap]
  );

  const handlePositionPick = useCallback(
    (lat: number, lon: number): void => {
      if (!isValidLat(lat) || !isValidLon(lon)) return;
      onChange({ lat, lon });
    },
    [onChange]
  );

  /** A coordinate typed or pasted into the advanced fields — the map follows it. */
  const handleTypedPick = useCallback(
    (lat: number, lon: number): void => {
      if (!isValidLat(lat) || !isValidLon(lon)) return;
      onChange({ lat, lon });
      focusMap();
    },
    [onChange, focusMap]
  );

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent): void => {
      handlePositionPick(e.lngLat.lat, e.lngLat.lng);
    },
    [handlePositionPick]
  );

  const handleMarkerDragEnd = useCallback(
    (e: { lngLat: { lng: number; lat: number } }): void => {
      handlePositionPick(e.lngLat.lat, e.lngLat.lng);
    },
    [handlePositionPick]
  );

  const handleAdvancedLatChange = useCallback(
    (raw: string): void => {
      setLatInput(raw);
      const lat = inputToNum(raw);
      const lon = inputToNum(lonInput);
      if (lat === null || lon === null) return;
      handleTypedPick(lat, lon);
    },
    [handleTypedPick, lonInput]
  );

  const handleAdvancedLonChange = useCallback(
    (raw: string): void => {
      setLonInput(raw);
      const lon = inputToNum(raw);
      const lat = inputToNum(latInput);
      if (lat === null || lon === null) return;
      handleTypedPick(lat, lon);
    },
    [handleTypedPick, latInput]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (!isDropdownOpen || results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
      } else if (e.key === "Enter") {
        if (activeIndex >= 0 && activeIndex < results.length) {
          e.preventDefault();
          handleSelectResult(results[activeIndex]);
        }
      } else if (e.key === "Escape") {
        setDropdownOpen(false);
        setActiveIndex(-1);
      }
    },
    [isDropdownOpen, results, activeIndex, handleSelectResult]
  );

  const initialViewState = useMemo(() => {
    if (hasPosition && value) {
      return { longitude: value.lon, latitude: value.lat, zoom: PICKED_ZOOM };
    }
    return DEFAULT_VIEW;
  }, [hasPosition, value]);

  const listboxId = `${idPrefix}-listbox`;

  return (
    <div className="space-y-2">
      <div className="relative">
        <label className="label" htmlFor={`${idPrefix}-search`}>
          {label ?? t("location:searchLabel")}
        </label>
        <input
          id={`${idPrefix}-search`}
          role="combobox"
          aria-expanded={isDropdownOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${idPrefix}-option-${activeIndex}` : undefined}
          type="text"
          autoComplete="off"
          className="input"
          placeholder={t("location:searchPlaceholder")}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!coordsDetected && (results.length > 0 || searchError)) setDropdownOpen(true);
          }}
        />

        {!compact && !coordsDetected && !hasPosition && (
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("location:searchHint")}
          </p>
        )}

        {coordsDetected && (
          <p
            data-testid={`${idPrefix}-coords-detected`}
            className="text-xs mt-1"
            style={{ color: "var(--accent, #ffc107)" }}
          >
            {t("location:coordinatesDetected")}
          </p>
        )}

        {!coordsDetected && hasPosition && value && (
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("location:currentPosition", { lat: value.lat, lon: value.lon })}
          </p>
        )}

        {isDropdownOpen && (
          <LocationSuggestions
            listboxId={listboxId}
            idPrefix={idPrefix}
            isSearching={isSearching}
            searchError={searchError}
            results={results}
            activeIndex={activeIndex}
            onSelect={handleSelectResult}
            searchingLabel={t("location:searching")}
            errorLabel={t("location:searchError")}
            noResultsLabel={t("location:noResults")}
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => setMapOpen((open) => !open)}
        className="text-xs hover:underline"
        style={{ color: "var(--text-muted)" }}
      >
        {mapOpen ? t("location:mapHide") : t("location:mapShow")}
      </button>

      {mapOpen && (
        <LocationMiniMap
          value={value}
          initialViewState={initialViewState}
          focusNonce={focusNonce}
          compact={compact}
          ariaLabel={t("location:mapAriaLabel")}
          attributionLabel={t("location:attribution")}
          onMapClick={handleMapClick}
          onMarkerDragEnd={handleMarkerDragEnd}
        />
      )}

      <details
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary
          className="cursor-pointer text-sm select-none"
          style={{ color: "var(--text-muted)" }}
        >
          {t("location:advanced")}
        </summary>
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div>
            <label className="label" htmlFor={`${idPrefix}-lat`}>
              {t("location:field.lat")}
            </label>
            <input
              id={`${idPrefix}-lat`}
              type="number"
              step="any"
              min={-90}
              max={90}
              className="input"
              value={latInput}
              onChange={(e) => handleAdvancedLatChange(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${idPrefix}-lon`}>
              {t("location:field.lon")}
            </label>
            <input
              id={`${idPrefix}-lon`}
              type="number"
              step="any"
              min={-180}
              max={180}
              className="input"
              value={lonInput}
              onChange={(e) => handleAdvancedLonChange(e.target.value)}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

export default LocationInput;
