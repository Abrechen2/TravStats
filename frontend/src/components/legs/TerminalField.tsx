import { useCallback, useState } from "react";
import type { JSX } from "react";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import { RequiredMark } from "../form";
import { useTranslation } from "../../hooks/useTranslation";

/** A terminal as the form holds it; `lat`/`lon` null until one is picked. */
export interface TerminalDraft {
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
}

export const EMPTY_TERMINAL: TerminalDraft = {
  name: "",
  address: "",
  lat: null,
  lon: null,
  country: null,
};

/** What differs between the legs that share this field (bus, ferry). */
export interface TerminalDomain {
  /** i18n namespace holding `form.stationName` / `form.stationAddress`. */
  ns: "bus" | "ferry";
  /** Narrows the geocoder to this kind of place first; the user may widen it. */
  portSearch?: boolean;
}

interface Props {
  domain: TerminalDomain;
  label: string;
  idPrefix: string;
  value: TerminalDraft;
  onChange: (next: TerminalDraft) => void;
  /** Reports a refused typed coordinate, and which of the two (`LocationInput`'s second argument). */
  onValidityChange?: (valid: boolean, field?: "lat" | "lon") => void;
  /**
   * The ride cannot be saved without this terminal (forgejo#245): the search
   * and the name carry the shared mark and `aria-required`.
   */
  required?: boolean;
  inputClassName: string;
}

/**
 * One terminal through the shared geocoder search (`LocationInput`) for the
 * position, plus the name as the ticket prints it and an optional address —
 * there is no terminal catalogue for coaches or ferries. A new pick REPLACES
 * the name and the address when it brings them, because picking another point
 * means another terminal; with nothing to bring, what the user typed stays.
 * The bus copy used to drop the geocoder's address while the ferry copy took
 * it (forgejo#386, REF-2): one rule now, the one the name already follows.
 */
export function TerminalField({
  domain,
  label,
  idPrefix,
  value,
  onChange,
  onValidityChange,
  required = false,
  inputClassName,
}: Props): JSX.Element {
  const { ns, portSearch = false } = domain;
  const { t } = useTranslation([ns]);
  const [allPlaces, setAllPlaces] = useState(false);

  const handlePick = useCallback(
    (selection: LocationSelection): void => {
      const moved = selection.lat !== value.lat || selection.lon !== value.lon;
      const pickedCountry = selection.countryCode ? selection.countryCode.toUpperCase() : null;
      onChange({
        // A name is the user's, a country is a fact about the point: when the
        // point moves and the pick brings no country, the old terminal's
        // country is not this one's (null, never guessed).
        name: selection.name ?? value.name,
        address: selection.address ?? value.address,
        lat: selection.lat,
        lon: selection.lon,
        country: moved ? pickedCountry : (pickedCountry ?? value.country),
      });
    },
    [onChange, value.name, value.address, value.lat, value.lon, value.country]
  );

  const position =
    value.lat !== null && value.lon !== null ? { lat: value.lat, lon: value.lon } : null;

  // Visible labels (forgejo#249): the accessible name keeps the terminal in
  // front, because the two terminals' fields read the same on screen.
  const nameId = `${idPrefix}-name`;
  const addressId = `${idPrefix}-address`;
  return (
    <div className="space-y-2">
      <LocationInput
        label={label}
        idPrefix={idPrefix}
        value={position}
        onChange={handlePick}
        onValidityChange={onValidityChange}
        required={required}
        searchKind={portSearch && !allPlaces ? "ferry_terminal" : undefined}
        compact
      />
      {portSearch && (
        <>
          <p className="t-caption">{t(`${ns}:portSearch.attribution`)}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allPlaces}
              onChange={(e) => setAllPlaces(e.target.checked)}
            />
            {t(`${ns}:portSearch.allPlaces`)}
          </label>
        </>
      )}
      <div>
        <label htmlFor={nameId} className="block text-sm">
          {t(`${ns}:form.stationName`)}
          {required && (
            <>
              {" "}
              <RequiredMark />
            </>
          )}
        </label>
        <input
          id={nameId}
          className={`mt-1 ${inputClassName}`}
          aria-label={`${label}: ${t(`${ns}:form.stationName`)}`}
          {...(required ? { "aria-required": true } : {})}
          value={value.name}
          onChange={(e): void => onChange({ ...value, name: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={addressId} className="block text-sm">
          {t(`${ns}:form.stationAddress`)}
        </label>
        <input
          id={addressId}
          className={`mt-1 ${inputClassName}`}
          aria-label={`${label}: ${t(`${ns}:form.stationAddress`)}`}
          value={value.address}
          onChange={(e): void => onChange({ ...value, address: e.target.value })}
        />
      </div>
    </div>
  );
}
