import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import {
  isOpenDataDisabled,
  openDataApi,
  openDataUpstreamFailure,
  type NearbyLodging,
} from "../../lib/api/openData";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";

/** A campsite search around the station; wide enough for a day's drive to cover a valley. */
export const CAMPSITE_RADIUS_KM = 10;
const CAMPSITE_KINDS = new Set(["camp_site", "caravan_site"]);

type Lookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; places: NearbyLodging[] }
  /** `none` is the only empty answer: the others mean OpenStreetMap could not be asked. */
  | { state: "failed"; reason: "timeout" | "rateLimited" | "unavailable" | "disabled" };

/**
 * "Campingplätze in der Nähe" for a station: the campsites and motorhome
 * pitches OpenStreetMap knows within `CAMPSITE_RADIUS_KM` of the station's
 * point (`GET /nearby/lodging`), nearest first. A pick moves the station onto
 * the campsite. "None found" and "OpenStreetMap did not answer" are told apart.
 */
export default function StationCampsites({
  point,
  onPick,
}: {
  point: { lat: number; lon: number } | null;
  onPick: (place: NearbyLodging) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["roadtrips", "openData"]);
  const openData = useSettingsStore((s) => s.openDataEnabled) === true;
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });

  // A list for the old point would offer the wrong valley's campsites.
  // The lookup still running for it is stale too: its answer is dropped.
  const run = useRef(0);
  useEffect(() => {
    run.current += 1;
    setLookup({ state: "idle" });
  }, [point?.lat, point?.lon]);

  if (!openData) return null;

  const search = async (): Promise<void> => {
    if (!point) return;
    const mine = ++run.current;
    setLookup({ state: "loading" });
    try {
      const places = await openDataApi.nearbyLodgings(point.lat, point.lon, CAMPSITE_RADIUS_KM);
      if (mine !== run.current) return;
      setLookup({ state: "done", places: places.filter((p) => CAMPSITE_KINDS.has(p.kind)) });
    } catch (err) {
      if (mine !== run.current) return;
      logger.warn("Campsites near a roadtrip station failed", err);
      const upstream = openDataUpstreamFailure(err);
      setLookup({
        state: "failed",
        reason: isOpenDataDisabled(err)
          ? "disabled"
          : upstream === "clientTimeout"
            ? "timeout"
            : (upstream ?? "unavailable"),
      });
    }
  };

  return (
    <div className="flex flex-col" style={{ gap: 6 }} data-testid="station-campsites">
      <Button
        variant="secondary"
        disabled={!point || lookup.state === "loading"}
        onClick={() => void search()}
      >
        {lookup.state === "loading"
          ? t("roadtrips:campsites.searching")
          : t("roadtrips:campsites.search", { km: CAMPSITE_RADIUS_KM })}
      </Button>
      {!point && <span className="t-caption">{t("roadtrips:campsites.needPlace")}</span>}
      {lookup.state === "failed" && (
        <p role="alert" style={{ fontSize: 13, color: "var(--ts-bad)" }}>
          {t(
            lookup.reason === "unavailable"
              ? "roadtrips:campsites.failed"
              : lookup.reason === "disabled"
                ? "openData:lodging.disabled"
                : `openData:lodging.upstream.${lookup.reason}`
          )}
        </p>
      )}
      {lookup.state === "done" && lookup.places.length === 0 && (
        <p className="t-caption">{t("roadtrips:campsites.none", { km: CAMPSITE_RADIUS_KM })}</p>
      )}
      {lookup.state === "done" && lookup.places.length > 0 && (
        <ul
          aria-label={t("roadtrips:campsites.listLabel")}
          className="flex max-h-56 flex-col overflow-auto"
          style={{ border: "1px solid var(--ts-border)", borderRadius: "var(--ts-radius-button)" }}
        >
          {lookup.places.map((place) => (
            <li key={place.osmRef}>
              <button
                type="button"
                onClick={() => {
                  onPick(place);
                  setLookup({ state: "idle" });
                }}
                className="flex w-full items-baseline justify-between text-left pointer-coarse:min-h-(--ts-size-touch-min)"
                style={{
                  gap: 8,
                  padding: "6px 12px",
                  background: "none",
                  border: 0,
                  color: "inherit",
                }}
              >
                <span>{place.name}</span>
                <span className="t-caption shrink-0">
                  {t(`roadtrips:campsites.kind.${place.kind}`)} ·{" "}
                  {t("roadtrips:campsites.distance", { km: (place.distanceM / 1000).toFixed(1) })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
