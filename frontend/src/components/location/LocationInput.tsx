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
 * Below the field: a button opening the shared `LocationMapModal` (the ONE
 * map way to pick a point — the inline mini-map it replaces was too cramped;
 * owner decision 2026-08-21) and a collapsible "Erweitert" raw lat/lon panel.
 *
 * Controlled interface: the parent owns `{lat, lon} | null` and receives
 * every position change (search selection, paste, modal confirm, advanced
 * panel) via `onChange`. No map is mounted until the modal opens — the
 * default render (value=null) never touches `react-map-gl`.
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseCoordinateInput } from "../../lib/coordinateParse";
import type { PlaceSearchResult } from "../../lib/api/geo";
import { useLocationSearch } from "./useLocationSearch";
import { LocationSuggestions } from "./LocationSuggestions";
import { LocationMapModal } from "./LocationMapModal";
// The module, not the `form` index: that one pulls in `Modal`, which this
// field is rendered inside of.
import { RequiredMark } from "../form/requiredFields";

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
  /**
   * `osm:<type>/<id>` when the coordinates came from a search hit that named
   * one. Absent for a hand-typed or map-picked coordinate, which genuinely has
   * no identity — see `PlaceResult.externalRef` on the backend.
   */
  externalRef?: string;
  name?: string;
  /** The hit's name in the place's own script, when it has a second one. */
  localName?: string;
  address?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  /**
   * The geocoder's OSM value (`attraction`, `museum`, …) for a search hit —
   * what a category guess reads. Never the display name: "Kolosseum" names a
   * place, it does not classify one.
   */
  osmValue?: string;
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
  /**
   * Told whenever the typed coordinates stop being usable, so the surrounding
   * form can refuse to save. Optional: a caller that does not pass it keeps
   * today's behaviour and still gets the inline message.
   */
  /**
   * Whether the typed coordinates are acceptable. On a refusal `field` names
   * the value at fault ("lat" when both are), so a form can take the user to
   * it instead of to the first of the two.
   */
  onValidityChange?: (valid: boolean, field?: "lat" | "lon") => void;
  /**
   * The form cannot be saved without a position (forgejo#245): the label
   * carries the required mark and the search field `aria-required`. A string
   * `label` cannot carry the mark itself, which is why this is a prop.
   */
  required?: boolean;
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
export function placeToSelection(hit: PlaceSearchResult): LocationSelection {
  return {
    lat: hit.lat,
    lon: hit.lon,
    name: hit.name,
    ...(hit.localName ? { localName: hit.localName } : {}),
    externalRef: hit.externalRef,
    address: hit.address,
    city: hit.city,
    country: hit.country,
    countryCode: hit.countryCode,
    osmValue: hit.type,
  };
}

export function LocationInput({
  value,
  onChange,
  compact = false,
  label,
  idPrefix = "location-input",
  onValidityChange,
  required = false,
}: LocationInputProps): JSX.Element {
  const { t, i18n } = useTranslation(["location"]);

  const [query, setQuery] = useState("");
  const [coordsDetected, setCoordsDetected] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [modalOpen, setModalOpen] = useState(false);
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
   * The ONE way a position is accepted.
   *
   * Every successful pick has to clear the range error and report validity
   * upward, and only the advanced number fields did. So after a rejected
   * 999/8, pasting "52.52, 13.405" into the search box — or confirming a pick
   * on the map — filled the numbers in correctly while the error message and
   * the disabled Save button stayed exactly where they were, with nothing left
   * on screen that was actually wrong (AUD-068).
   *
   * Routing all four paths through here is the fix: a new path cannot forget
   * to do it, because there is nothing to forget.
   */
  const applySelection = useCallback(
    (selection: LocationSelection): void => {
      setRangeError(null);
      onValidityChange?.(true);
      onChange(selection);
    },
    [onChange, onValidityChange]
  );

  const handleQueryChange = useCallback(
    (raw: string): void => {
      setQuery(raw);
      const parsed = parseCoordinateInput(raw);
      if (parsed) {
        setCoordsDetected(true);
        setDropdownOpen(false);
        applySelection({ lat: parsed.lat, lon: parsed.lon });
      } else {
        setCoordsDetected(false);
      }
    },
    [applySelection]
  );

  const handleSelectResult = useCallback(
    (hit: PlaceSearchResult): void => {
      applySelection(placeToSelection(hit));
      setQuery("");
      setCoordsDetected(false);
      setDropdownOpen(false);
      reset();
    },
    [applySelection, reset]
  );

  /** A coordinate typed or pasted into the advanced fields. */
  /**
   * An out-of-range pair used to be swallowed by a bare `return`.
   *
   * Forgejo #9: typing 999 / -999 left the numbers sitting in the fields, never
   * called `onChange`, and the form saved a lodging with NO coordinates at all
   * — the user's input discarded without a word, on a dialog whose Save button
   * stayed enabled throughout. The browser marked the inputs invalid; the
   * application never looked.
   *
   * Now it names which value is wrong and reports upward so a form can decline
   * to save. A previously VALID selection is deliberately left in place:
   * clearing it would punish a typo by throwing away a good location.
   */
  const handleTypedPick = useCallback(
    (lat: number, lon: number): void => {
      const latOk = isValidLat(lat);
      const lonOk = isValidLon(lon);
      if (!latOk || !lonOk) {
        setRangeError(
          !latOk && !lonOk
            ? "location:outOfRange"
            : !latOk
              ? "location:latOutOfRange"
              : "location:lonOutOfRange"
        );
        onValidityChange?.(false, latOk ? "lon" : "lat");
        return;
      }
      applySelection({ lat, lon });
    },
    [applySelection]
  );

  const handleModalConfirm = useCallback(
    (selection: LocationSelection): void => {
      applySelection(selection);
      setModalOpen(false);
    },
    [applySelection]
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

  const listboxId = `${idPrefix}-listbox`;
  // The refusal names its value (forgejo#246): the field at fault is marked
  // invalid and reads the message as its description, so a screen reader that
  // lands on it — and `focusFirstError` looking for it — find the complaint.
  const rangeErrorId = `${idPrefix}-range-error`;
  const latRefused =
    rangeError === "location:outOfRange" || rangeError === "location:latOutOfRange";
  const lonRefused =
    rangeError === "location:outOfRange" || rangeError === "location:lonOutOfRange";
  const refusedProps = (
    refused: boolean
  ): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    refused ? { "aria-invalid": true, "aria-describedby": rangeErrorId } : {};

  return (
    <div className="space-y-2">
      <div className="relative">
        <label className="label" htmlFor={`${idPrefix}-search`}>
          {label ?? t("location:searchLabel")}
          {required && (
            <>
              {" "}
              <RequiredMark />
            </>
          )}
        </label>
        <input
          id={`${idPrefix}-search`}
          {...(required ? { "aria-required": true } : {})}
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
        onClick={() => setModalOpen(true)}
        className="text-xs hover:underline pointer-coarse:min-h-(--ts-size-touch-min)"
        style={{ color: "var(--accent, #ffc107)" }}
      >
        {t("location:mapPick")}
      </button>

      <LocationMapModal
        open={modalOpen}
        value={value}
        onClose={() => setModalOpen(false)}
        onConfirm={handleModalConfirm}
        idPrefix={`${idPrefix}-map-modal`}
      />
      {/* `compact` now only trims the search hint; the modal is one size. */}

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
              {...refusedProps(latRefused)}
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
              {...refusedProps(lonRefused)}
              value={lonInput}
              onChange={(e) => handleAdvancedLonChange(e.target.value)}
            />
          </div>
        </div>
        {rangeError && (
          <p
            id={rangeErrorId}
            className="mt-2 text-sm"
            role="alert"
            data-testid="location-range-error"
            style={{ color: "rgb(252, 165, 165)" }}
          >
            {t(rangeError)}
          </p>
        )}
      </details>
    </div>
  );
}

export default LocationInput;
