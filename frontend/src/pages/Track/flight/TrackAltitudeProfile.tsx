import { useId, useMemo, useState } from "react";
import type { JSX, KeyboardEvent, PointerEvent } from "react";
import { token } from "../../../components/ui/tokens";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import type { FlightSample, TravTrackPhoto } from "../../../lib/api/travtrackViews";
import { formatDate, formatTime } from "../../../lib/displayFormat";
import { TRACK_COLOR } from "../map/trackMapLayers";
import { altitudeAt, flightLevel, profileFrame, profilePaths, xAt, yAt } from "./altitudeProfile";
import {
  areaPaths,
  gapBands,
  nearestIndex,
  niceTicks,
  samplesOf,
  speedPaths,
  timeTicks,
  topSpeedKmh,
} from "./profileAxes";

const W = 720;
const H = 240;
const M = { left: 56, right: 56, top: 18, bottom: 42 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;
const SPEED_COLOR = token("accent");
const AXIS = { fontSize: 11, fill: "var(--ts-muted)" } as const;

/**
 * The altitude over the whole flight (owner 2026-10-26, "den Graphen besser
 * machen"): altitude with its area and an axis in metres, the speed as a
 * lighter line on its own axis in km/h, clock times in the departure zone
 * with each local midnight marked, a hatched band where the recording breaks
 * (never a line across it), take-off and landing, the replay's cursor and a
 * pin per photo. A crosshair follows the pointer; the arrow keys step it from
 * sample to sample, and the readout below says the same in words.
 */
export default function TrackAltitudeProfile({
  series,
  zone,
  takeoffMs = null,
  landingMs = null,
  cursor,
  photos,
  onPhoto,
}: {
  series: FlightSample[][];
  /** The departure zone the clock is read in. */
  zone: string;
  takeoffMs?: number | null;
  landingMs?: number | null;
  /** The replay's moment, or null. */
  cursor: number | null;
  photos: readonly TravTrackPhoto[];
  onPhoto: (photo: TravTrackPhoto) => void;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const [active, setActive] = useState<number | null>(null);
  const ids = useId();
  const readoutId = `${ids}-readout`;
  const hatchId = `${ids}-hatch`;
  const samples = useMemo(() => samplesOf(series), [series]);
  const base = profileFrame(series, PW, PH);
  if (!base) return null;
  const altTicks = niceTicks(base.top);
  const frame = { ...base, top: altTicks[altTicks.length - 1] };
  const speedTop = topSpeedKmh(series);
  const speedTicks = speedTop === null ? [] : niceTicks(speedTop);
  const speedMax = speedTicks[speedTicks.length - 1] ?? 1;
  const time = timeTicks(frame.t0, frame.t1, zone);
  const bands = gapBands(series);
  const number = (v: number) => new Intl.NumberFormat(i18n.language).format(Math.round(v));
  const clock = (ms: number) => formatTime(ms, { timeZone: zone });
  const inside = (ms: number | null): ms is number =>
    ms !== null && ms >= frame.t0 && ms <= frame.t1;
  const apex = samples.reduce<FlightSample | null>(
    (best, s) => (s[1] !== null && (best === null || s[1] > (best[1] as number)) ? s : best),
    null
  );
  const picked = active === null ? null : samples[active];

  const readout = (s: FlightSample) =>
    [
      clock(s[0]),
      s[1] === null
        ? "—"
        : t("track:flight.altitudeValue", { fl: flightLevel(s[1]), m: number(s[1]) }),
      s[2] === null ? "—" : t("track:flight.kmh", { kmh: number(s[2] * 3.6) }),
    ].join(" · ");

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!(box.width > 0)) return;
    const ms = frame.t0 + ((e.clientX - box.left) / box.width) * (frame.t1 - frame.t0);
    setActive(nearestIndex(samples, ms));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = samples.length - 1;
    const step = e.shiftKey ? 10 : 1;
    const at = active ?? 0;
    const next =
      e.key === "ArrowRight"
        ? Math.min(last, at + step)
        : e.key === "ArrowLeft"
          ? Math.max(0, at - step)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const summary = t("track:flight.profileSummary", {
    from: clock(frame.t0),
    to: clock(frame.t1),
    top: apex?.[1] == null ? "—" : number(apex[1]),
  });

  return (
    <figure
      className="flex flex-col gap-1"
      style={{ margin: 0 }}
      data-testid="track-altitude-profile"
    >
      <div
        tabIndex={0}
        role="group"
        aria-label={summary}
        aria-describedby={readoutId}
        onKeyDown={onKey}
        onFocus={() =>
          setActive((a) => a ?? Math.max(0, nearestIndex(samples, takeoffMs ?? frame.t0)))
        }
        style={{ outlineOffset: 2 }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ width: "100%", height: "auto" }}>
          <defs>
            <pattern
              id={hatchId}
              width={8}
              height={8}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={8}
                stroke="var(--ts-muted)"
                strokeWidth={1.5}
                opacity={0.5}
              />
            </pattern>
          </defs>
          <g transform={`translate(${M.left},${M.top})`}>
            {altTicks.map((v) => (
              <g key={`a${v}`} data-testid="track-altitude-tick">
                <line
                  x1={0}
                  x2={PW}
                  y1={yAt(frame, v)}
                  y2={yAt(frame, v)}
                  stroke={token("border")}
                  strokeDasharray={v === 0 ? undefined : "2 4"}
                />
                <text x={-8} y={yAt(frame, v) + 4} textAnchor="end" {...AXIS}>
                  {number(v)}
                </text>
              </g>
            ))}
            <text x={-8} y={-6} textAnchor="end" {...AXIS}>
              m
            </text>
            {speedTicks.map((v) => (
              <text
                key={`s${v}`}
                x={PW + 8}
                y={PH - (v / speedMax) * PH + 4}
                {...AXIS}
                style={{ fill: SPEED_COLOR }}
              >
                {number(v)}
              </text>
            ))}
            {speedTicks.length > 0 && (
              <text x={PW + 8} y={-6} {...AXIS} style={{ fill: SPEED_COLOR }}>
                km/h
              </text>
            )}
            {bands.map(([from, to]) => {
              const x = xAt(frame, from);
              const w = Math.max(2, xAt(frame, to) - x);
              return (
                <g key={`g${from}`} data-testid="track-altitude-gap">
                  <rect x={x} y={0} width={w} height={PH} fill={`url(#${hatchId})`} />
                  {w > 90 && (
                    <text x={x + w / 2} y={PH / 2} textAnchor="middle" {...AXIS}>
                      {t("track:flight.noRecordingBand")}
                    </text>
                  )}
                </g>
              );
            })}
            {areaPaths(series, frame).map((d, i) => (
              <path key={`f${i}`} d={d} fill={TRACK_COLOR} opacity={0.18} />
            ))}
            {speedPaths(series, frame, speedMax).map((d, i) => (
              <path
                key={`v${i}`}
                d={d}
                fill="none"
                stroke={SPEED_COLOR}
                strokeWidth={1.25}
                opacity={0.75}
                data-testid="track-speed-line"
              />
            ))}
            {profilePaths(series, frame).map((d, i) => (
              <path
                data-testid="track-altitude-line"
                key={`p${i}`}
                d={d}
                fill="none"
                stroke={TRACK_COLOR}
                strokeWidth={2.25}
              />
            ))}
            {apex && apex[1] !== null && (
              <text
                x={Math.min(PW - 40, xAt(frame, apex[0]))}
                y={yAt(frame, apex[1]) - 6}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="var(--ts-text)"
              >
                FL{flightLevel(apex[1])}
              </text>
            )}
            {(
              [
                [takeoffMs, "track:flight.takeoff"],
                [landingMs, "track:flight.landing"],
              ] as const
            )
              .filter(([ms]) => inside(ms))
              .map(([ms, key]) => (
                <g key={key} data-testid="track-altitude-mark">
                  <line
                    x1={xAt(frame, ms as number)}
                    x2={xAt(frame, ms as number)}
                    y1={0}
                    y2={PH}
                    stroke="var(--ts-text)"
                    opacity={0.45}
                  />
                  <text x={xAt(frame, ms as number) + 4} y={10} fontSize={11} fill="var(--ts-text)">
                    {t(key)}
                  </text>
                </g>
              ))}
            {time.midnights.map((ms) => (
              <g key={`d${ms}`} data-testid="track-altitude-midnight">
                <line
                  x1={xAt(frame, ms)}
                  x2={xAt(frame, ms)}
                  y1={0}
                  y2={PH + 26}
                  stroke="var(--ts-muted)"
                  strokeDasharray="4 3"
                />
                <text x={xAt(frame, ms) + 4} y={PH + 36} {...AXIS} fontWeight={600}>
                  {formatDate(ms, { timeZone: zone })}
                </text>
              </g>
            ))}
            {time.ticks.map((ms) => (
              <text
                key={`t${ms}`}
                x={xAt(frame, ms)}
                y={PH + 16}
                textAnchor="middle"
                {...AXIS}
                data-testid="track-altitude-time"
              >
                {clock(ms)}
              </text>
            ))}
            {inside(cursor) && (
              <line
                data-testid="track-altitude-cursor"
                x1={xAt(frame, cursor)}
                x2={xAt(frame, cursor)}
                y1={0}
                y2={PH}
                stroke={token("text")}
                strokeDasharray="3 3"
              />
            )}
            {picked && (
              <g data-testid="track-altitude-crosshair" pointerEvents="none">
                <line
                  x1={xAt(frame, picked[0])}
                  x2={xAt(frame, picked[0])}
                  y1={0}
                  y2={PH}
                  stroke="var(--ts-text)"
                />
                {picked[1] !== null && (
                  <circle
                    cx={xAt(frame, picked[0])}
                    cy={yAt(frame, picked[1])}
                    r={4}
                    fill={TRACK_COLOR}
                  />
                )}
              </g>
            )}
            <rect
              x={0}
              y={0}
              width={PW}
              height={PH}
              fill="transparent"
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={() => setActive(null)}
            />
            {photos
              .filter((p) => inside(Date.parse(p.takenAt)))
              .map((p) => {
                const ms = Date.parse(p.takenAt);
                const alt = altitudeAt(series, ms);
                return (
                  <circle
                    key={p.assetId}
                    data-testid="track-altitude-pin"
                    cx={xAt(frame, ms)}
                    cy={alt === null ? 0 : yAt(frame, alt)}
                    r={coarse ? 10 : 6}
                    fill={token("surface")}
                    stroke={TRACK_COLOR}
                    strokeWidth={2}
                    style={{ cursor: "pointer" }}
                    onClick={() => onPhoto(p)}
                  />
                );
              })}
          </g>
        </svg>
      </div>
      {photos.some((p) => inside(Date.parse(p.takenAt))) && (
        <div className="flex flex-wrap gap-1">
          {photos
            .filter((p) => inside(Date.parse(p.takenAt)))
            .map((p) => (
              <button
                key={p.assetId}
                type="button"
                className="t-caption underline"
                onClick={() => onPhoto(p)}
              >
                {t("track:photos.alt", { time: clock(Date.parse(p.takenAt)) })}
              </button>
            ))}
        </div>
      )}
      <p
        id={readoutId}
        className="t-caption tabular-nums"
        aria-live="polite"
        data-testid="track-altitude-readout"
      >
        {picked ? readout(picked) : t("track:flight.profileHint")}
      </p>
    </figure>
  );
}
