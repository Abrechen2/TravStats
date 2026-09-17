/** The shape a trip photo is sent in — shared by trips.ts (GET /trips/:id) and tripPhotos.ts. */
export interface PhotoDto {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  createdAt: string;
}

export function toPhotoDto(p: {
  id: string;
  tripId: string;
  caption: string | null;
  takenAt: Date | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  createdAt: Date;
}): PhotoDto {
  return {
    id: p.id,
    url: `/api/v1/trips/${p.tripId}/photos/${p.id}/file`,
    caption: p.caption,
    takenAt: p.takenAt?.toISOString() ?? null,
    sortIdx: p.sortIdx,
    mimetype: p.mimetype,
    sizeBytes: p.sizeBytes,
    createdAt: p.createdAt.toISOString(),
  };
}
