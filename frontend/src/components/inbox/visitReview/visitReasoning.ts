import { formatNumber } from "../../../lib/units";
import type { PhotoJourney } from "../../../types/photoJourney";
import { photoJourneyDwellMinutes } from "../photoJourneySpan";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A distance as a reader says it: metres below a kilometre, one decimal above. */
export function formatShortDistance(km: number, language?: string): string {
  return km < 1
    ? `${formatNumber(Math.round(km * 1000), undefined, language)} m`
    : `${formatNumber(km, { maximumFractionDigits: 1 }, language)} km`;
}

/**
 * Why this stop is a question, in the order a reader weighs it (forgejo#211,
 * O5): how many photographs, over how long, in which trip, and how far the
 * nearest visit already logged is — "Yongsan Station, 1.3 km" is what made
 * the War Memorial a question at all. Nothing is rounded up: located photos
 * are shown beside the total when they differ.
 */
export function visitReasoning(journey: PhotoJourney, t: Translate, language?: string): string[] {
  const base = "dataQuality:inbox.photoJourneys";
  const dwell = photoJourneyDwellMinutes(journey);
  const nearest = journey.nearestVisit;
  return [
    t(`${base}.facts.photos`, { photos: journey.photoCount }),
    journey.locatedCount !== journey.photoCount
      ? t(`${base}.facts.located`, { located: journey.locatedCount })
      : null,
    dwell !== null ? t(`${base}.review.reason.dwell`, { minutes: dwell }) : null,
    journey.tripName ? t(`${base}.facts.trip`, { name: journey.tripName }) : null,
    nearest
      ? t(`${base}.review.reason.nearest`, {
          name: nearest.placeName,
          distance: formatShortDistance(nearest.distanceKm, language),
        })
      : // Absent field = an older server that does not say; null = nothing logged.
        nearest === null
        ? t(`${base}.review.reason.noNearest`)
        : null,
  ].filter((fact): fact is string => fact !== null);
}
