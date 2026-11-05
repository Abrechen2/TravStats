import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  travTrackApi,
  type TravTrackFixedPlace,
  type TravTrackPlaces,
} from "../../../lib/api/travtrack";
import { logger } from "../../../lib/logger";
import { SettingItem } from "../../ui/settings";
import { RowFailure } from "./useRowAction";

const NS = "settings:location.tt.places";

type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; data: TravTrackPlaces };

/**
 * Settings → Standort → TravTrack: the fixed places, read-only this round
 * (spec 2026-11-05-travtrack-fixed-places, S3; the editor is the app's B4).
 * Home first (its point is the home setting's), then work and own places, and
 * the "lodging while booked" switch with the bookings that cannot fold.
 *
 * A failed load says so with a retry; it never draws "no fixed places".
 */
export default function TravTrackPlacesRow(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const read = useCallback(async (): Promise<void> => {
    try {
      setLoad({ state: "ready", data: await travTrackApi.places() });
    } catch (err) {
      logger.warn("TravTrack fixed places: could not load", err);
      setLoad({ state: "failed" });
    }
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  const describe = (place: TravTrackFixedPlace): string => {
    const window = place.window
      ? t(`${NS}.window`, {
          days: place.window.days.map((d) => t(`${NS}.days.${d}`)).join(", "),
          from: place.window.from,
          until: place.window.until,
        })
      : t(`${NS}.always`);
    return `${t(`${NS}.kind.${place.kind}`)} · ${t(`${NS}.radius`, { metres: place.radiusM })} · ${window}`;
  };

  return (
    <SettingItem title={t(`${NS}.name`)} sub={t(`${NS}.sub`)} help={t(`${NS}.help`)}>
      {load.state === "failed" ? (
        <RowFailure error={t(`${NS}.loadError`)} onRetry={() => void read()} />
      ) : load.state === "ready" ? (
        <>
          <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }} data-testid="places">
            {load.data.places.map((place) => (
              <li key={place.id} data-testid="place-row">
                <div className="t-body" style={{ fontWeight: 600 }}>
                  {place.kind === "home" && place.lat === null
                    ? t(`${NS}.homeUnknown`)
                    : place.name || t(`${NS}.home`)}
                </div>
                <div className="t-caption">{describe(place)}</div>
              </li>
            ))}
          </ul>
          <p className="t-caption" style={{ margin: 0 }} data-testid="places-lodging">
            {t(`${NS}.lodging`, {
              state: t(`${NS}.${load.data.lodgingAsPlace.enabled ? "lodgingOn" : "lodgingOff"}`),
              metres: load.data.lodgingAsPlace.radiusM,
            })}
          </p>
          {load.data.lodgingAsPlace.enabled && (load.data.lodgingSkipped ?? 0) > 0 ? (
            <p className="t-caption" role="status" style={{ margin: 0 }}>
              {t(`${NS}.lodgingSkipped`, { count: load.data.lodgingSkipped })}
            </p>
          ) : null}
        </>
      ) : null}
    </SettingItem>
  );
}
