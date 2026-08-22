/**
 * LocationMapModal — the ONE map way to pick a point (owner decision
 * 2026-08-21: the modal replaces the old inline mini-map).
 *
 * Search on top (same Photon search-as-you-type as the input field), a large
 * pin-picker map, and a reverse-geocoded address line under it. Confirm
 * reports a full `LocationSelection`; nothing reaches the parent before that
 * — cancel discards every change made inside the modal.
 *
 * Address precedence on confirm: a search hit picked INSIDE the modal wins
 * (it carries the richer fields, incl. countryCode); otherwise the
 * reverse-geocoded parts of the pin are reported. The resolved address is
 * displayed before it can be confirmed — that display is what makes
 * overwriting a typed address in the parent form an informed act.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";
import { useTranslation } from "../../hooks/useTranslation";
import {
  reverseGeocode,
  reversePlaces,
  type PlaceSearchResult,
  type ReverseGeocodeResult,
} from "../../lib/api/geo";
import { logger } from "../../lib/logger";
import type { LocationCoordinates, LocationSelection } from "./LocationInput";
import { useLocationSearch } from "./useLocationSearch";
import { LocationSuggestions } from "./LocationSuggestions";
import { LocationMiniMap } from "./LocationMiniMap";

const DEFAULT_VIEW = { longitude: 10, latitude: 50, zoom: 3 };
const PICKED_ZOOM = 9;
const REVERSE_DEBOUNCE_MS = 400;

export interface LocationMapModalProps {
  open: boolean;
  /** The parent form's current position — seeds the pin when the modal opens. */
  value: LocationCoordinates | null;
  onClose: () => void;
  onConfirm: (selection: LocationSelection) => void;
  idPrefix?: string;
}

export function LocationMapModal({
  open,
  value,
  onClose,
  onConfirm,
  idPrefix = "location-map-modal",
}: LocationMapModalProps): JSX.Element | null {
  const { t, i18n } = useTranslation(["location"]);

  const [draft, setDraft] = useState<LocationCoordinates | null>(value);
  /** The search hit the pin currently sits on — cleared by any map gesture. */
  const [hit, setHit] = useState<PlaceSearchResult | null>(null);
  const [resolved, setResolved] = useState<ReverseGeocodeResult | null>(null);
  const [resolving, setResolving] = useState(false);
  /** The named places around a MAP-placed pin — the "what is here?" list. */
  const [pois, setPois] = useState<PlaceSearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focusNonce, setFocusNonce] = useState(0);
  const reverseIdRef = useRef(0);
  const poiIdRef = useRef(0);

  // Re-seed the draft each time the modal opens — an earlier session's
  // abandoned pin must not leak into the next one.
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setHit(null);
    setResolved(null);
    setPois([]);
    setQuery("");
    // The parent's value is only read at open — while the modal is up, the
    // draft is the single source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lang = i18n.language?.split("-")[0];
  const { results, isSearching, searchError, reset } = useLocationSearch(open ? query : "", lang);

  // Reverse ADDRESS lookup, only for a pin the MAP placed: a search hit already
  // carries its address, and its fields win on confirm anyway.
  useEffect(() => {
    if (!open || !draft || hit) return;
    const requestId = reverseIdRef.current + 1;
    reverseIdRef.current = requestId;
    setResolving(true);
    const timer = window.setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const parts = await reverseGeocode(draft.lat, draft.lon);
          if (reverseIdRef.current !== requestId) return;
          setResolved(parts);
        } catch (err) {
          if (reverseIdRef.current !== requestId) return;
          logger.warn("LocationMapModal: reverse geocode failed", err);
          setResolved(null);
        } finally {
          if (reverseIdRef.current === requestId) setResolving(false);
        }
      })();
    }, REVERSE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, draft, hit, i18n.language]);

  // The "what is here?" list runs for EVERY pin, including one a search placed.
  // It deliberately does not share the address lookup's `hit` guard: knowing
  // the name of the place you searched for says nothing about what stands
  // around it, and searching first is exactly how one looks for a hotel. The
  // list is an offer — until a place is tapped, the search hit stays the
  // answer, so this never overwrites what the user chose.
  useEffect(() => {
    if (!open || !draft) return;
    const requestId = poiIdRef.current + 1;
    poiIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const lang = i18n.language?.split("-")[0];
          const nearby = await reversePlaces(draft.lat, draft.lon, lang);
          if (poiIdRef.current !== requestId) return;
          setPois(nearby.results);
        } catch (err) {
          if (poiIdRef.current !== requestId) return;
          logger.warn("LocationMapModal: reverse places failed", err);
          setPois([]);
        }
      })();
    }, REVERSE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, draft, i18n.language]);

  const placeFromMap = useCallback((lat: number, lon: number): void => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setDraft({ lat, lon });
    setHit(null);
    setResolved(null);
    setPois([]);
  }, []);

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent): void => placeFromMap(e.lngLat.lat, e.lngLat.lng),
    [placeFromMap]
  );

  const handleMarkerDragEnd = useCallback(
    (e: { lngLat: { lng: number; lat: number } }): void =>
      placeFromMap(e.lngLat.lat, e.lngLat.lng),
    [placeFromMap]
  );

  const handleSelectResult = useCallback(
    (selectedHit: PlaceSearchResult): void => {
      setDraft({ lat: selectedHit.lat, lon: selectedHit.lon });
      setHit(selectedHit);
      setResolved(null);
      setPois([]);
      setQuery("");
      reset();
      setFocusNonce((n) => n + 1);
    },
    [reset]
  );

  /** A place picked from the "what is here?" list: the pin snaps to it and
   *  its fields win on confirm — exactly like a search hit. The list stays,
   *  so a wrong first tap can simply be corrected with a second one. */
  const handlePickPoi = useCallback((poi: PlaceSearchResult): void => {
    setDraft({ lat: poi.lat, lon: poi.lon });
    setHit(poi);
    setFocusNonce((n) => n + 1);
  }, []);

  const handleConfirm = useCallback((): void => {
    if (!draft) return;
    if (hit) {
      onConfirm({
        lat: draft.lat,
        lon: draft.lon,
        name: hit.name,
        address: hit.address,
        city: hit.city,
        country: hit.country,
        countryCode: hit.countryCode,
      });
      return;
    }
    onConfirm({
      lat: draft.lat,
      lon: draft.lon,
      ...(resolved?.name ? { name: resolved.name } : {}),
      ...(resolved?.address ? { address: resolved.address } : {}),
      ...(resolved?.city ? { city: resolved.city } : {}),
      ...(resolved?.country ? { country: resolved.country } : {}),
    });
  }, [draft, hit, resolved, onConfirm]);

  if (!open) return null;

  const dropdownOpen = results.length > 0 || searchError;
  const listboxId = `${idPrefix}-listbox`;
  const addressLine = hit
    ? [hit.name, hit.address, hit.city, hit.country].filter(Boolean).join(", ")
    : resolved
      ? [resolved.name, resolved.address, resolved.city, resolved.country]
          .filter(Boolean)
          .join(", ")
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("location:mapModal.title")}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--bg-elevated)] p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("location:mapModal.title")}
          </h3>
          <button
            type="button"
            aria-label={t("location:mapModal.cancel")}
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>

        <div className="relative mt-3">
          <input
            id={`${idPrefix}-search`}
            role="combobox"
            aria-expanded={dropdownOpen}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={
              activeIndex >= 0 ? `${idPrefix}-option-${activeIndex}` : undefined
            }
            type="text"
            autoComplete="off"
            className="input"
            placeholder={t("location:mapModal.searchPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={(e) => {
              if (!dropdownOpen || results.length === 0) return;
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
              }
            }}
          />
          {dropdownOpen && (
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

        <div className="mt-3">
          <LocationMiniMap
            value={draft}
            // Seeded from the PROP, not from `draft`. The map reads this once,
            // when it mounts — which is the render that opens the modal, and in
            // that render `draft` can still hold the previous session's value:
            // the re-seeding effect below only runs after the commit. Reading
            // `draft` therefore opened the picker on the world view whenever
            // the position arrived while the modal was shut (a stay loaded, an
            // address geocoded), leaving the pin off screen.
            initialViewState={
              value
                ? { longitude: value.lon, latitude: value.lat, zoom: PICKED_ZOOM }
                : DEFAULT_VIEW
            }
            focusNonce={focusNonce}
            compact={false}
            height={420}
            ariaLabel={t("location:mapAriaLabel")}
            attributionLabel={t("location:attribution")}
            onMapClick={handleMapClick}
            onMarkerDragEnd={handleMarkerDragEnd}
          />
        </div>

        {pois.length > 0 && (
          <div className="mt-3" data-testid="map-modal-poi-list">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {t("location:mapModal.nearby")}
            </p>
            <ul className="max-h-40 divide-y divide-[var(--color-border)] overflow-y-auto rounded-lg border border-[var(--color-border)]">
              {pois.map((poi, i) => {
                const selected =
                  hit !== null && hit.lat === poi.lat && hit.lon === poi.lon && hit.name === poi.name;
                return (
                  <li key={`${poi.name}-${i}`}>
                    <button
                      type="button"
                      onClick={() => handlePickPoi(poi)}
                      className={
                        "flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--bg-inset)]" +
                        (selected ? " bg-[var(--bg-inset)]" : "")
                      }
                    >
                      <span className="truncate text-[var(--text-primary)]">
                        {selected ? "✓ " : ""}
                        {poi.name}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">
                        {[poi.city, poi.country].filter(Boolean).join(", ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="min-w-0 text-xs text-[var(--text-muted)]">
            {draft && (
              <p className="truncate">
                {t("location:currentPosition", { lat: draft.lat, lon: draft.lon })}
              </p>
            )}
            {draft && resolving && !hit && <p>{t("location:mapModal.resolving")}</p>}
            {draft && !resolving && addressLine && (
              <p className="truncate text-[var(--text-primary)]">{addressLine}</p>
            )}
            {draft && !resolving && !addressLine && !hit && (
              <p>{t("location:mapModal.noAddress")}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={onClose}>
              {t("location:mapModal.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary px-4 py-2 text-sm"
              disabled={!draft}
              onClick={handleConfirm}
            >
              {t("location:mapModal.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LocationMapModal;
