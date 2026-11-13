import { useState } from "react";
import type { JSX } from "react";
import { LocationInput, type LocationSelection } from "../../../components/location/LocationInput";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import { pillStyle } from "./trackMapStyle";

/**
 * "Selbst suchen" on a stop: the shared place search (a failed search is
 * shown by `LocationInput` as itself, apart from "no result"), then the pick
 * is named and stored through the same call an accepted suggestion uses. A
 * coordinate paste or a map pin carries no name, so the name is asked for.
 */
export default function TrackStopPlaceSearch({
  busy,
  height,
  anchor,
  onStore,
}: {
  busy: boolean;
  height: number;
  anchor: { lat: number; lon: number };
  onStore: (place: { name: string; lat: number; lon: number }) => void;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<LocationSelection | null>(null);
  const [name, setName] = useState("");

  const choose = (selection: LocationSelection) => {
    setPick(selection);
    setName(selection.name ?? "");
  };
  const trimmed = name.trim();

  return (
    <div className="flex flex-col gap-1" data-testid="track-stop-place-search">
      <button
        type="button"
        className="underline t-caption self-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="track-stop-place-search-toggle"
        style={{ minHeight: height }}
      >
        {t(open ? "track:stop.place.searchClose" : "track:stop.place.search")}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <LocationInput
            compact
            idPrefix="track-stop-place"
            value={pick ? { lat: pick.lat, lon: pick.lon } : anchor}
            onChange={choose}
            label={t("track:stop.place.searchLabel")}
          />
          {pick && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                aria-label={t("track:stop.place.searchName")}
                data-testid="track-stop-place-search-name"
                style={{ minHeight: height, color: token("text") }}
              />
              <button
                type="button"
                disabled={busy || trimmed === ""}
                onClick={() => onStore({ name: trimmed, lat: pick.lat, lon: pick.lon })}
                data-testid="track-stop-place-search-save"
                style={pillStyle(true, height)}
              >
                {t("track:stop.place.searchSave")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
