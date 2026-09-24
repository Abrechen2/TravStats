import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import type { TourTrack, TourTrackMeta } from "../../types/tour";

const PROFILE_W = 400;
const PROFILE_H = 90;

/** "3:25 h" from seconds. */
function hoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")} h`;
}

/**
 * What a day tour is read by (design 2026-09-24, planning page "Entwurf 2"):
 * distance, climb, time out and time moving, with the elevation profile
 * beside them. A hike is read in metres of height, not in kilometres.
 *
 * Every figure comes from the recordings — summed over them where there are
 * several — and a figure no recording carries is left out rather than shown
 * as zero: a track with no elevation did not climb nothing.
 *
 * The profile is drawn from the FIRST recording's detail call, the only one
 * that carries elevations; a tour of several recordings is rare, and drawing
 * one profile honestly beats stitching several with gaps between them.
 */
export default function TourRecordingSummary({
  tracks,
  tripId,
  routeId,
  accent,
}: {
  tracks: TourTrackMeta[];
  tripId: string | undefined;
  routeId: string;
  /** Line colour — the tour hue on a tour, the roadtrip hue on a roadtrip. */
  accent: string;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["roadtrips", "trips"]);
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const [detail, setDetail] = useState<TourTrack | null>(null);
  const firstId = tracks[0]?.id ?? null;

  useEffect(() => {
    if (!firstId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    toursApi.tracks
      .get(tripId, routeId, firstId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err: unknown) => logger.warn("Loading the recording for its profile failed", err));
    return () => {
      cancelled = true;
    };
  }, [tripId, routeId, firstId]);

  const profile = useMemo(() => {
    const x = detail?.cumulativeKm;
    const y = detail?.elevations;
    if (!x || !y || x.length !== y.length) return null;
    const points = x.flatMap((km, i) => (y[i] === null ? [] : [[km, y[i] as number] as const]));
    if (points.length < 2) return null;
    const maxKm = points[points.length - 1][0] || 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, e] of points) {
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    const span = Math.max(hi - lo, 1);
    const path = points
      .map(
        ([km, e], i) =>
          `${i === 0 ? "M" : "L"}${((km / maxKm) * PROFILE_W).toFixed(1)} ${(
            PROFILE_H -
            6 -
            ((e - lo) / span) * (PROFILE_H - 12)
          ).toFixed(1)}`
      )
      .join(" ");
    return { path, lo, hi, maxKm };
  }, [detail]);

  if (tracks.length === 0) return null;

  const sum = (pick: (t: TourTrackMeta) => number | null): number | null => {
    const known = tracks.map(pick).filter((v): v is number => v !== null);
    return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
  };
  const km = tracks.reduce((s, tr) => s + tr.distanceKm, 0);
  const ascent = sum((tr) => tr.ascentM);
  const descent = sum((tr) => tr.descentM);
  const moving = sum((tr) => tr.movingSeconds);
  const elapsed = tracks.reduce(
    (s, tr) => s + (Date.parse(tr.endedAt) - Date.parse(tr.startedAt)) / 1000,
    0
  );

  const figures = [
    { label: t("roadtrips:recording.distance"), value: `${nf.format(km)} km` },
    ascent !== null && {
      label: t("roadtrips:recording.ascent"),
      value: `↑ ${nf0.format(ascent)} m`,
    },
    descent !== null && {
      label: t("roadtrips:recording.descent"),
      value: `↓ ${nf0.format(descent)} m`,
    },
    elapsed > 0 && { label: t("roadtrips:recording.duration"), value: hoursMinutes(elapsed) },
    moving !== null && { label: t("roadtrips:recording.moving"), value: hoursMinutes(moving) },
  ].filter((f): f is { label: string; value: string } => Boolean(f));

  return (
    <section className="rounded-lg border border-(--color-border) p-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {figures.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-(--text-muted)">{f.label}</dt>
            <dd className="t-stat-number">{f.value}</dd>
          </div>
        ))}
      </dl>
      {profile && (
        <figure className="mt-3">
          <svg
            viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`}
            preserveAspectRatio="none"
            className="h-24 w-full"
            role="img"
            aria-label={t("roadtrips:recording.profileLabel", {
              low: nf0.format(profile.lo),
              high: nf0.format(profile.hi),
            })}
          >
            <path
              d={`${profile.path} L${PROFILE_W} ${PROFILE_H} L0 ${PROFILE_H} Z`}
              fill={accent}
              fillOpacity={0.15}
            />
            <path d={profile.path} fill="none" stroke={accent} strokeWidth={2} />
          </svg>
          <figcaption className="t-meta-mono flex justify-between text-(--text-muted)">
            <span>{nf0.format(profile.lo)} m</span>
            <span>{nf0.format(profile.hi)} m</span>
            <span>{nf.format(profile.maxKm)} km</span>
          </figcaption>
        </figure>
      )}
    </section>
  );
}
