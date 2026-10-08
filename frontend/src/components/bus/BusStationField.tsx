import { useCallback } from "react";
import type { JSX } from "react";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";

/** A terminal as the form holds it; `lat`/`lon` null until one is picked. */
export interface BusStationDraft {
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
}

export const EMPTY_TERMINAL: BusStationDraft = {
  name: "",
  address: "",
  lat: null,
  lon: null,
  country: null,
};

interface Props {
  label: string;
  idPrefix: string;
  value: BusStationDraft;
  onChange: (next: BusStationDraft) => void;
  onValidityChange?: (valid: boolean) => void;
  inputClassName: string;
}

/**
 * One terminal through the shared geocoder search (`LocationInput`) for the
 * position, plus the name as the ticket prints it and an optional address —
 * there is no coach-terminal catalogue (spec §3.2). A new pick REPLACES the
 * name, because picking another point means another terminal and the old name
 * would label the wrong one; the name stays editable afterwards ("Dong Seoul
 * Bus Terminal" rather than whatever the geocoder calls it). The address is
 * left alone: the geocoder does not know the ticket's wording.
 */
export function BusStationField({
  label,
  idPrefix,
  value,
  onChange,
  onValidityChange,
  inputClassName,
}: Props): JSX.Element {
  const { t } = useTranslation(["bus"]);

  const handlePick = useCallback(
    (selection: LocationSelection): void => {
      const moved = selection.lat !== value.lat || selection.lon !== value.lon;
      const pickedCountry = selection.countryCode ? selection.countryCode.toUpperCase() : null;
      onChange({
        // A name is the user's, a country is a fact about the point: when the
        // point moves and the pick brings no country, the old terminal's
        // country is not this one's (null, never guessed — spec §3.1).
        name: selection.name ?? value.name,
        address: value.address,
        lat: selection.lat,
        lon: selection.lon,
        country: moved ? pickedCountry : (pickedCountry ?? value.country),
      });
    },
    [onChange, value.name, value.address, value.lat, value.lon, value.country]
  );

  const position =
    value.lat !== null && value.lon !== null ? { lat: value.lat, lon: value.lon } : null;

  return (
    <div className="space-y-2">
      <LocationInput
        label={label}
        idPrefix={idPrefix}
        value={position}
        onChange={handlePick}
        onValidityChange={onValidityChange}
        compact
      />
      <input
        className={inputClassName}
        aria-label={`${label}: ${t("bus:form.stationName")}`}
        placeholder={t("bus:form.stationName")}
        value={value.name}
        onChange={(e): void => onChange({ ...value, name: e.target.value })}
      />
      <input
        className={inputClassName}
        aria-label={`${label}: ${t("bus:form.stationAddress")}`}
        placeholder={t("bus:form.stationAddress")}
        value={value.address}
        onChange={(e): void => onChange({ ...value, address: e.target.value })}
      />
    </div>
  );
}
