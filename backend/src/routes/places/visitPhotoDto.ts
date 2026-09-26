/**
 * The shape a place-visit photo is sent in, by the photo routes AND by the
 * place detail. The detail used to send the raw rows — no `url`, so every
 * stored photo drew as a broken image after a reload, and `filename` and
 * `checksum` went to the browser for nothing. One mapper, so the two cannot
 * disagree again.
 */
export interface PhotoDto {
  id: string;
  url: string;
  caption: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  immichAssetId: string | null;
  createdAt: string;
  /**
   * When and where it was taken (forgejo#132 item 11). A visit photo stores
   * only its capture time; a photo PICKED from the trip's gallery is that trip
   * photo, so its position — and its time, where the row has none — are the
   * trip photo's. Null when neither holds it; never the upload time.
   */
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

/** What a visit photo query includes so the DTO can read a picked trip photo. */
export const VISIT_PHOTO_INCLUDE = {
  tripPhoto: { select: { lat: true, lon: true, takenAt: true } },
} as const;

export function toPhotoDto(photo: {
  id: string;
  placeVisitId: string;
  caption: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  immichAssetId: string | null;
  createdAt: Date;
  takenAt: Date | null;
  tripPhoto?: { lat: number | null; lon: number | null; takenAt: Date | null } | null;
}): PhotoDto {
  const taken = photo.takenAt ?? photo.tripPhoto?.takenAt ?? null;
  return {
    id: photo.id,
    url: `/api/v1/places/visits/${photo.placeVisitId}/photos/${photo.id}/file`,
    caption: photo.caption,
    sortIdx: photo.sortIdx,
    mimetype: photo.mimetype,
    sizeBytes: photo.sizeBytes,
    immichAssetId: photo.immichAssetId,
    createdAt: photo.createdAt.toISOString(),
    takenAt: taken?.toISOString() ?? null,
    lat: photo.tripPhoto?.lat ?? null,
    lon: photo.tripPhoto?.lon ?? null,
  };
}
