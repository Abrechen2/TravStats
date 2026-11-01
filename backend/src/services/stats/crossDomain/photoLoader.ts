/**
 * The photo facts behind the photo statistics (forgejo#399): one row per trip
 * photo, with its day in the user's profile zone, its country resolved from the
 * stored EXIF coordinates, and the place it is attached to through a visit.
 */
import { prisma } from "../../../db";
import { localDay } from "../../../shared/time/instant";
import type { PhotoFact } from "../../../utils/stats/crossDomain/photoStats";
import { getCountryResolver } from "../../geo/countryFromCoordinates";

export async function loadPhotoFacts(userId: string, zone: string): Promise<PhotoFact[]> {
  const photos = await prisma.tripPhoto.findMany({
    where: { trip: { userId } },
    select: {
      id: true,
      takenAt: true,
      lat: true,
      lon: true,
      trip: { select: { id: true, name: true } },
      visitLinks: {
        take: 1,
        select: { visit: { select: { place: { select: { id: true, name: true } } } } },
      },
    },
  });
  if (photos.length === 0) return [];
  const resolver = await getCountryResolver();
  return photos.map((p) => {
    const place = p.visitLinks[0]?.visit?.place ?? null;
    return {
      tripId: p.trip.id,
      tripName: p.trip.name,
      day: p.takenAt ? localDay(p.takenAt, zone) : null,
      country:
        p.lat !== null && p.lon !== null && Number.isFinite(p.lat) && Number.isFinite(p.lon)
          ? resolver.countryAt(p.lat, p.lon)
          : null,
      placeId: place?.id ?? null,
      placeName: place?.name ?? null,
    };
  });
}
