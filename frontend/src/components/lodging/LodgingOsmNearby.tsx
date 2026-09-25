import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useTranslation } from "../../hooks/useTranslation";
import { openDataApi, type NearbyLodging } from "../../lib/api/openData";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { lodgingTypeForKind } from "./lodgingFromOsm";

/** A pin from a search hit is the house or next to it; half a kilometre holds its neighbours too. */
const NEARBY_RADIUS_KM = 0.5;

type Lookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; places: NearbyLodging[] }
  | { state: "failed" };

interface LodgingOsmNearbyProps {
  lat: number;
  lon: number;
  onPick: (place: NearbyLodging) => void;
}

/**
 * "Which house is this?" for the lodging form: the named lodgings OpenStreetMap
 * knows around the picked pin, one click each. The form fills its still-empty
 * fields from the pick, so this is also how an unsaved lodging is completed from
 * OSM — the enrich button on the detail page needs a saved record.
 *
 * Behind the same two switches as that button (beta `lodgingEnrichment` and the
 * instance's open data switch): both write OSM's stars and website into the
 * user's record, and that is what the beta is holding back. Asked only on a
 * click — every pin move would otherwise be a request to Overpass.
 */
export function LodgingOsmNearby({ lat, lon, onPick }: LodgingOsmNearbyProps): JSX.Element | null {
  const { t } = useTranslation(["openData", "lodging"]);
  const { isFeatureVisible } = useBetaFeatures();
  const openData = useSettingsStore((s) => s.openDataEnabled) === true;
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });

  // A list for the old pin would offer the wrong street's houses.
  useEffect(() => setLookup({ state: "idle" }), [lat, lon]);

  if (!openData || !isFeatureVisible("lodgingEnrichment")) return null;

  const search = async (): Promise<void> => {
    setLookup({ state: "loading" });
    try {
      setLookup({
        state: "done",
        places: await openDataApi.nearbyLodgings(lat, lon, NEARBY_RADIUS_KM),
      });
    } catch (err) {
      logger.warn("Nearby lodgings from OpenStreetMap failed", err);
      setLookup({ state: "failed" });
    }
  };

  const kindLabel = (kind: string): string => {
    const type = lodgingTypeForKind(kind);
    return type ? t(`lodging:type.${type}`) : kind;
  };

  return (
    <div className="flex flex-col gap-1" data-testid="lodging-osm-nearby">
      <button
        type="button"
        onClick={() => void search()}
        disabled={lookup.state === "loading"}
        className="self-start text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
      >
        {lookup.state === "loading"
          ? t("openData:lodging.nearby.searching")
          : t("openData:lodging.nearby.search")}
      </button>
      {lookup.state === "failed" && (
        <p className="text-xs text-[var(--danger)]">{t("openData:lodging.nearby.failed")}</p>
      )}
      {lookup.state === "done" && lookup.places.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">{t("openData:lodging.nearby.none")}</p>
      )}
      {lookup.state === "done" && lookup.places.length > 0 && (
        <ul
          aria-label={t("openData:lodging.nearby.listLabel")}
          className="flex max-h-48 flex-col overflow-auto rounded-md border border-[var(--color-border)]"
        >
          {lookup.places.map((place) => (
            <li key={place.osmRef}>
              <button
                type="button"
                onClick={() => {
                  onPick(place);
                  setLookup({ state: "idle" });
                }}
                className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              >
                <span>{place.name}</span>
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  {kindLabel(place.kind)} ·{" "}
                  {t("openData:lodging.nearby.distance", { m: place.distanceM })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
