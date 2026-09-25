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
}

export function toPhotoDto(photo: {
  id: string;
  placeVisitId: string;
  caption: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  immichAssetId: string | null;
  createdAt: Date;
}): PhotoDto {
  return {
    id: photo.id,
    url: `/api/v1/places/visits/${photo.placeVisitId}/photos/${photo.id}/file`,
    caption: photo.caption,
    sortIdx: photo.sortIdx,
    mimetype: photo.mimetype,
    sizeBytes: photo.sizeBytes,
    immichAssetId: photo.immichAssetId,
    createdAt: photo.createdAt.toISOString(),
  };
}
