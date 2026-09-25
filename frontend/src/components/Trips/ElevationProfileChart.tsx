import { useMemo } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";

const PROFILE_W = 400;
const PROFILE_H = 90;

/**
 * An elevation profile from `[km, m]` pairs — the recorded one of a walked
 * tour, or the planned one read from the ground along the line. One drawing
 * for both, so the two can be compared at a glance. Nothing is drawn for
 * fewer than two points: no profile, not a flat one.
 */
export default function ElevationProfileChart({
  points,
  accent,
  dashed = false,
}: {
  points: ReadonlyArray<readonly [number, number]> | null | undefined;
  accent: string;
  /** A planned profile is drawn dashed, like a planned line on the map. */
  dashed?: boolean;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  const profile = useMemo(() => {
    if (!points || points.length < 2) return null;
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
  }, [points]);

  if (!profile) return null;
  return (
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
          fillOpacity={dashed ? 0.08 : 0.15}
        />
        <path
          d={profile.path}
          fill="none"
          stroke={accent}
          strokeWidth={2}
          strokeDasharray={dashed ? "6 4" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="t-meta-mono flex justify-between text-(--text-muted)">
        <span>{nf0.format(profile.lo)} m</span>
        <span>{nf0.format(profile.hi)} m</span>
        <span>{nf.format(profile.maxKm)} km</span>
      </figcaption>
    </figure>
  );
}
