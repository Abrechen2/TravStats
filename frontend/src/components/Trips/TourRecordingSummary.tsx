import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import type { TourTrack, TourTrackMeta } from "../../types/tour";
import ElevationProfileChart from "./ElevationProfileChart";

/** "3:25 h" from seconds. */
function hoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")} h`;
}

/**
 * One profile over several recordings: each one's `[km, m]` pairs shifted by
 * the distance of the recordings before it. Null unless every recording has
 * loaded and carries a profile.
 */
export function stitchProfiles(
  ordered: readonly TourTrackMeta[],
  details: readonly TourTrack[] | null
): Array<[number, number]> | null {
  if (!details || ordered.length === 0) return null;
  const byId = new Map(details.map((d) => [d.id, d]));
  const out: Array<[number, number]> = [];
  let offset = 0;
  for (const meta of ordered) {
    const profile = byId.get(meta.id)?.elevationProfile;
    if (!profile || profile.length === 0) return null;
    for (const [km, m] of profile) out.push([offset + km, m]);
    offset += meta.distanceKm;
  }
  return out;
}

/**
 * What a day tour is read by (design 2026-09-24, planning page "Entwurf 2"):
 * distance, climb, time out and time moving, with the elevation profile
 * beside them. A hike is read in metres of height, not in kilometres.
 *
 * Every figure comes from the recordings — summed over them where there are
 * several — and a figure is left out unless EVERY recording carries it: a
 * track with no elevation did not climb nothing, and a sum over the ones that
 * do would pass a part off as the whole day.
 *
 * The profile runs over EVERY recording, in the order they were made, each
 * one's kilometres continuing where the one before ended — so its axis ends
 * where the distance figure beside it does. It used to be the first
 * recording's only: the four-day Mosel tour read "200,6 km" above a profile
 * ending at "61,7 km" (acceptance run, 2026-09-26). A recording without a
 * profile leaves the whole profile out, as a missing figure does.
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
  const [details, setDetails] = useState<TourTrack[] | null>(null);
  const ordered = [...tracks].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const idsKey = ordered.map((tr) => tr.id).join(",");

  useEffect(() => {
    const ids = idsKey === "" ? [] : idsKey.split(",");
    if (ids.length === 0) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    Promise.all(ids.map((id) => toursApi.tracks.get(tripId, routeId, id)))
      .then((all) => !cancelled && setDetails(all))
      .catch((err: unknown) => logger.warn("Loading the recordings for their profile failed", err));
    return () => {
      cancelled = true;
    };
  }, [tripId, routeId, idsKey]);

  if (tracks.length === 0) return null;

  const sum = (pick: (t: TourTrackMeta) => number | null): number | null => {
    const values = tracks.map(pick);
    if (values.some((v) => v === null)) return null;
    return (values as number[]).reduce((a, b) => a + b, 0);
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
      <ElevationProfileChart points={stitchProfiles(ordered, details)} accent={accent} />
    </section>
  );
}
