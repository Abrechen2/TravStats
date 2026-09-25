import { useCallback } from "react";
import type { JSX } from "react";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";

/** A station as the form holds it; `lat`/`lon` null until one is picked. */
export interface RailStationDraft {
  name: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
  /** UIC code, when the station came from the catalogue or a lookup. */
  code: string | null;
  /** Catalogue row; null for a geocoder pick. */
  stationId: number | null;
}

export const EMPTY_STATION: RailStationDraft = {
  name: "",
  lat: null,
  lon: null,
  country: null,
  code: null,
  stationId: null,
};

interface Props {
  label: string;
  idPrefix: string;
  value: RailStationDraft;
  onChange: (next: RailStationDraft) => void;
  onValidityChange?: (valid: boolean) => void;
  inputClassName: string;
}

/**
 * One station through the shared geocoder search (`LocationInput`) for the
 * position, plus the name as the ticket prints it — the fallback of the
 * `StationPicker` for stations the catalogue does not know (it is thin
 * outside Europe). A geocoder pick carries no catalogue id and no code.
 *
 * A search hit names a station and brings its country; a
 * new pick REPLACES the name, unlike the place form, because picking another
 * point means another station — the old name would label the wrong one. The
 * name stays editable afterwards ("Frankfurt (Main) Hbf" rather than whatever
 * the geocoder calls it).
 */
export function RailStationField({
  label,
  idPrefix,
  value,
  onChange,
  onValidityChange,
  inputClassName,
}: Props): JSX.Element {
  const { t } = useTranslation(["rail"]);

  const handlePick = useCallback(
    (selection: LocationSelection): void => {
      onChange({
        name: selection.name ?? value.name,
        lat: selection.lat,
        lon: selection.lon,
        country: selection.countryCode ? selection.countryCode.toUpperCase() : value.country,
        code: null,
        stationId: null,
      });
    },
    [onChange, value.name, value.country]
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
        aria-label={`${label}: ${t("rail:form.stationName")}`}
        placeholder={t("rail:form.stationName")}
        value={value.name}
        onChange={(e): void => onChange({ ...value, name: e.target.value })}
      />
    </div>
  );
}
