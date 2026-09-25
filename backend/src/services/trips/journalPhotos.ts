import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";

/**
 * Which of the trip's photographs a journal entry shows (package 9, item 5).
 *
 * An entry may only point at photos of ITS OWN trip. The join's keys prove the
 * photo exists, not whose it is or which trip holds it, so the check is made
 * here, before anything is written: validating after the entry was created
 * would leave an entry behind for a request that answered 400.
 */

/** A journal entry is a page, not an album. */
export const JOURNAL_PHOTO_CAP = 12;

/** The ids, de-duplicated in the order given, or a 400 naming the problem. */
export async function assertTripPhotos(tripId: string, photoIds: string[]): Promise<string[]> {
  const unique = [...new Set(photoIds)];
  if (unique.length === 0) return unique;
  const found = await prisma.tripPhoto.count({
    where: {
      id: { in: unique },
      tripId,
      OR: [{ caption: null }, { caption: { not: "__cover__" } }],
    },
  });
  if (found !== unique.length) throw new AppError("Photo not found in this trip", 400);
  return unique;
}

/** Replace the entry's photos with `photoIds` (already checked), in that order. */
export async function setJournalPhotos(entryId: string, photoIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.journalEntryPhoto.deleteMany({ where: { entryId } }),
    prisma.journalEntryPhoto.createMany({
      data: photoIds.map((tripPhotoId, sortIdx) => ({ entryId, tripPhotoId, sortIdx })),
    }),
  ]);
}
