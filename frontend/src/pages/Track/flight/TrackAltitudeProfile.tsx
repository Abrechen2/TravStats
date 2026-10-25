import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import type { FlightSample, TravTrackPhoto } from "../../../lib/api/travtrackViews";
import { formatTime } from "../../../lib/displayFormat";
import { TRACK_COLOR } from "../map/trackMapLayers";
import { altitudeAt, profileFrame, profilePaths, xAt, yAt } from "./altitudeProfile";

const W = 600;
const H = 140;

/**
 * The altitude over the flight's time (board „Track-Karte"): one line per
 * unbroken stretch, a cursor at the replay's moment, and a pin per photo at
 * its time. A pin is a button; the photos list below says the same in words.
 */
export default function TrackAltitudeProfile({
  series,
  zone,
  cursor,
  photos,
  onPhoto,
}: {
  series: FlightSample[][];
  zone: string;
  /** The replay's moment, or null. */
  cursor: number | null;
  photos: readonly TravTrackPhoto[];
  onPhoto: (photo: TravTrackPhoto) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const frame = profileFrame(series, W, H);
  if (!frame) return null;
  const paths = profilePaths(series, frame);
  const inside = (ms: number) => ms >= frame.t0 && ms <= frame.t1;
  return (
    <figure
      className="flex flex-col gap-1"
      style={{ margin: 0 }}
      data-testid="track-altitude-profile"
    >
      <svg
        viewBox={`0 -12 ${W} ${H + 12}`}
        role="img"
        aria-label={t("track:flight.profile")}
        style={{ width: "100%", height: "auto", overflow: "visible" }}
      >
        <line x1={0} x2={W} y1={H} y2={H} stroke={token("border")} />
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={TRACK_COLOR} strokeWidth={2} />
        ))}
        {cursor !== null && inside(cursor) && (
          <line
            data-testid="track-altitude-cursor"
            x1={xAt(frame, cursor)}
            x2={xAt(frame, cursor)}
            y1={0}
            y2={H}
            stroke={token("text")}
            strokeDasharray="3 3"
          />
        )}
        {photos
          .filter((p) => inside(Date.parse(p.takenAt)))
          .map((p) => {
            const ms = Date.parse(p.takenAt);
            const alt = altitudeAt(series, ms);
            const time = formatTime(ms, { timeZone: zone });
            return (
              <g
                key={p.assetId}
                role="button"
                tabIndex={0}
                aria-label={t("track:photos.alt", { time })}
                onClick={() => onPhoto(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onPhoto(p);
                }}
                style={{ cursor: "pointer" }}
                data-testid="track-altitude-pin"
              >
                <circle
                  cx={xAt(frame, ms)}
                  cy={alt === null ? 0 : yAt(frame, alt)}
                  r={6}
                  fill={token("surface")}
                  stroke={TRACK_COLOR}
                  strokeWidth={2}
                />
              </g>
            );
          })}
      </svg>
      <figcaption className="flex justify-between t-caption tabular-nums">
        <span>{formatTime(frame.t0, { timeZone: zone })}</span>
        <span>{t("track:flight.profileHint")}</span>
        <span>{formatTime(frame.t1, { timeZone: zone })}</span>
      </figcaption>
    </figure>
  );
}
