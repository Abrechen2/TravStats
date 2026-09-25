import { api } from "./client";

/**
 * Trip photos an entry shows by when and where they were taken
 * (`GET /{lodging|flights|cruises|rail}/:id/trip-photos`). Read-only: the photos
 * belong to their trip, and the entry only looks at them.
 */

export type PhotoWindowEntry = "lodging" | "flights" | "cruises" | "rail";

export interface WindowPhoto {
  id: string;
  /** Server-built — use verbatim. */
  url: string;
  caption: string | null;
  takenAt: string | null;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function getTripPhotoWindow(
  entry: PhotoWindowEntry,
  id: string
): Promise<WindowPhoto[]> {
  const res = await api.get<Envelope<{ photos: WindowPhoto[] }>>(`/${entry}/${id}/trip-photos`);
  return res.data.data.photos;
}
