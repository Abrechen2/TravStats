/** Ferry crossings (dennis/TravStats forgejo#293). */
import { useCallback, useState } from "react";
import type { JSX } from "react";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import { RequiredMark } from "../form";
import { useTranslation } from "../../hooks/useTranslation";

export interface FerryStationDraft {
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
}

export const EMPTY_TERMINAL: FerryStationDraft = {
  name: "",
  address: "",
  lat: null,
  lon: null,
  country: null,
};

interface Props {
  label: string;
  idPrefix: string;
  value: FerryStationDraft;
  onChange: (next: FerryStationDraft) => void;
  onValidityChange?: (valid: boolean, field?: "lat" | "lon") => void;
  required?: boolean;
  inputClassName: string;
}

export function FerryStationField({
  label,
  idPrefix,
  value,
  onChange,
  onValidityChange,
  required = false,
  inputClassName,
}: Props): JSX.Element {
  const { t } = useTranslation(["ferry"]);
  const [allPlaces, setAllPlaces] = useState(false);

  const handlePick = useCallback(
    (selection: LocationSelection): void => {
      const moved = selection.lat !== value.lat || selection.lon !== value.lon;
      const pickedCountry = selection.countryCode ? selection.countryCode.toUpperCase() : null;
      onChange({
        // A name is the user's, a country is a fact about the point: when the
        // point moves and the pick brings no country, the old terminal's
        // country is not this one's (null, never guessed — spec §3.1).
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

  // Visible labels (forgejo#249): with only a placeholder, a filled-in name
  // field no longer said what it was. The accessible name keeps the terminal
  // in front, because the two terminals' fields read the same on screen.
  const nameId = `${idPrefix}-name`;
  const addressId = `${idPrefix}-address`;
  return (
    <div className="space-y-2">
      <LocationInput
        searchKind={allPlaces ? undefined : "ferry_terminal"}
        label={label}
        idPrefix={idPrefix}
        value={position}
        onChange={handlePick}
        onValidityChange={onValidityChange}
        required={required}
        compact
      />
      <p className="t-caption">{t("ferry:portSearch.attribution")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allPlaces}
          onChange={(e) => setAllPlaces(e.target.checked)}
        />
        {t("ferry:portSearch.allPlaces")}
      </label>
      <div>
        <label htmlFor={nameId} className="block text-sm">
          {t("ferry:form.stationName")}
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
          aria-label={`${label}: ${t("ferry:form.stationName")}`}
          {...(required ? { "aria-required": true } : {})}
          value={value.name}
          onChange={(e): void => onChange({ ...value, name: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={addressId} className="block text-sm">
          {t("ferry:form.stationAddress")}
        </label>
        <input
          id={addressId}
          className={`mt-1 ${inputClassName}`}
          aria-label={`${label}: ${t("ferry:form.stationAddress")}`}
          value={value.address}
          onChange={(e): void => onChange({ ...value, address: e.target.value })}
        />
      </div>
    </div>
  );
}
