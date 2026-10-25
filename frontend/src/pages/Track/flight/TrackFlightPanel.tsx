import { useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import type { TravTrackFlightPanel, TravTrackPhoto } from "../../../lib/api/travtrackViews";
import { panelStyle, pillStyle } from "../map/trackMapStyle";
import TrackPhotoNotice from "../photos/TrackPhotoNotice";
import TrackPhotoThumb from "../photos/TrackPhotoThumb";
import { photoWindowOf } from "../photos/trackPhotos";
import { useTrackPhotos } from "../photos/useTrackPhotos";
import TrackAltitudeProfile from "./TrackAltitudeProfile";
import { flightLevel } from "./altitudeProfile";
import { useFlightPanel } from "./useFlightPanel";

export interface SelectedFlight {
  id: string;
  label: string;
  href: string | null;
}

/** The series' instants as track points, for the photo window (only `t` is read). */
const instantsOf = (panel: TravTrackFlightPanel) =>
  panel.series.map((run) => run.map(([t]) => [t, 0, 0, null] as [number, number, number, null]));

/**
 * The flight panel (board „Track-Karte", TravTrack plan T5.3): a logbook flight
 * picked in the day's timeline, with the key figures of its own recording,
 * the altitude profile (cursor follows the replay), and the photos taken
 * during it, placed on the track by the server. A figure that cannot be
 * derived reads "—", never 0.
 */
export default function TrackFlightPanel({
  flight,
  zone,
  cursor,
  generation = 0,
  onClose,
}: {
  flight: SelectedFlight;
  zone: string;
  cursor: number | null;
  /** The map's reload generation: a deletion reads the panel and its photos again. */
  generation?: number;
  onClose: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const state = useFlightPanel(flight.id, generation);
  const panel = state.kind === "loaded" ? state.panel : null;
  const window = useMemo(() => (panel ? photoWindowOf(instantsOf(panel)) : null), [panel]);
  const photos = useTrackPhotos(window?.kind === "window" ? window.window : null, generation);
  const [picked, setPicked] = useState<TravTrackPhoto | null>(null);
  const list = photos.kind === "loaded" ? photos.photos : [];
  const number = (v: number) => new Intl.NumberFormat(i18n.language).format(Math.round(v));
  const s = panel?.summary;

  const figures: Array<[string, string]> = [
    [
      "altitude",
      s?.maxAltitudeM == null
        ? "—"
        : t("track:flight.altitudeValue", {
            fl: flightLevel(s.maxAltitudeM),
            m: number(s.maxAltitudeM),
          }),
    ],
    [
      "speed",
      s?.maxSpeedMps == null ? "—" : t("track:flight.kmh", { kmh: number(s.maxSpeedMps * 3.6) }),
    ],
    [
      "climb",
      s?.climbToCruiseMinutes == null
        ? "—"
        : t("track:flight.minutes", { m: number(s.climbToCruiseMinutes) }),
    ],
    ["photos", photos.kind === "loaded" ? number(list.length) : "—"],
  ];

  return (
    <section
      style={{ ...panelStyle, borderColor: token("live") }}
      className="flex flex-col gap-3"
      aria-label={t("track:flight.title", { label: flight.label })}
      data-testid="track-flight-panel"
    >
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="t-card-title" style={{ flex: "1 1 auto" }}>
          {t("track:flight.title", { label: flight.label })}
        </h2>
        {flight.href && <Link to={flight.href}>{t("track:flight.open")}</Link>}
        <button type="button" onClick={onClose} style={pillStyle(false)}>
          {t("track:map.point.close")}
        </button>
      </div>
      {state.kind === "loading" && <p className="t-caption">{t("track:flight.loading")}</p>}
      {state.kind === "failed" && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(state.key)}
        </p>
      )}
      {panel && (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="track-flight-figures">
            {figures.map(([key, value]) => (
              <div
                key={key}
                data-figure={key}
                style={{ background: token("surface2"), borderRadius: 10, padding: 10 }}
              >
                <dt className="t-caption">{t(`track:flight.figure.${key}`)}</dt>
                <dd style={{ fontSize: 18, fontWeight: 700 }} className="tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {panel.pointCount === 0 ? (
            <p className="t-body" data-testid="track-flight-empty">
              {t("track:flight.noRecording")}
            </p>
          ) : (
            <TrackAltitudeProfile
              series={panel.series}
              zone={zone}
              cursor={cursor}
              photos={list}
              onPhoto={setPicked}
            />
          )}
          {panel.truncated && (
            <p className="t-caption" role="status" style={{ color: token("warn") }}>
              {t("track:flight.truncated")}
            </p>
          )}
          <h3 className="t-card-title">{t("track:flight.photosTitle")}</h3>
          <TrackPhotoNotice state={photos} />
          {window?.kind === "tooLong" && (
            <p className="t-caption">{t("track:photos.needsShorter")}</p>
          )}
          {photos.kind === "loaded" && list.length === 0 && (
            <p className="t-caption">{t("track:flight.noPhotos")}</p>
          )}
          {photos.kind === "loaded" && list.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="track-flight-photos">
              {(picked ? [picked] : list).map((p) => (
                <TrackPhotoThumb key={p.assetId} photo={p} window={photos.window} zone={zone} />
              ))}
              {picked && (
                <button type="button" onClick={() => setPicked(null)} style={pillStyle(false)}>
                  {t("track:flight.allPhotos")}
                </button>
              )}
            </div>
          )}
          <p className="t-caption">{t("track:flight.photosNote")}</p>
        </>
      )}
    </section>
  );
}
