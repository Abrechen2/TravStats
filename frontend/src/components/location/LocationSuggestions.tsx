/** ARIA-combobox suggestion dropdown for `LocationInput` — extracted to keep
 * the parent under the project's file-size guideline. Purely presentational:
 * all state (open/closed, active index, results) lives in the parent. */
import type { JSX } from "react";
import type { PlaceSearchResult } from "../../lib/api/geo";

export interface LocationSuggestionsProps {
  listboxId: string;
  idPrefix: string;
  isSearching: boolean;
  searchError: boolean;
  results: PlaceSearchResult[];
  activeIndex: number;
  onSelect: (hit: PlaceSearchResult) => void;
  searchingLabel: string;
  errorLabel: string;
  noResultsLabel: string;
}

function formatHitLabel(hit: PlaceSearchResult): string {
  const parts = [hit.name];
  if (hit.city) parts.push(hit.city);
  if (hit.country) parts.push(hit.country);
  return parts.join(", ");
}

export function LocationSuggestions({
  listboxId,
  idPrefix,
  isSearching,
  searchError,
  results,
  activeIndex,
  onSelect,
  searchingLabel,
  errorLabel,
  noResultsLabel,
}: LocationSuggestionsProps): JSX.Element {
  return (
    <div
      id={listboxId}
      role="listbox"
      className="absolute left-0 right-0 z-20 mt-1 rounded-md border shadow-lg overflow-hidden"
      style={{ background: "var(--bg-surface)", borderColor: "var(--color-border)" }}
    >
      {isSearching && (
        <div className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {searchingLabel}
        </div>
      )}
      {!isSearching && searchError && (
        <div className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }} role="alert">
          {errorLabel}
        </div>
      )}
      {!isSearching && !searchError && results.length === 0 && (
        <div className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {noResultsLabel}
        </div>
      )}
      {!isSearching &&
        !searchError &&
        results.map((hit, index) => (
          <button
            key={`${hit.lat}-${hit.lon}-${hit.name}-${index}`}
            id={`${idPrefix}-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => onSelect(hit)}
            className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-elevated)] transition-colors"
            style={{
              color: "var(--text-primary)",
              background: index === activeIndex ? "var(--bg-elevated)" : undefined,
            }}
          >
            {formatHitLabel(hit)}
          </button>
        ))}
    </div>
  );
}

export default LocationSuggestions;
