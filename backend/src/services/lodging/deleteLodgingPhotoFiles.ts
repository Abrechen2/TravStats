import { prisma } from "../../db";
import { deleteLodgingPhotoFile } from "../../middleware/upload";
import logger from "../../utils/logger";

/**
 * The bytes behind a hotel's photographs, when the hotel itself goes.
 *
 * Deleting a single photo removes the row and then the file. Deleting the
 * HOTEL removed the rows by cascade and left every file in
 * `uploads/lodging-photos` behind: still on disk, still in the backup archive,
 * with nothing left that could ever name them again (audit finding AUD-042).
 * Three paths delete lodgings — the route, the import undo and the spreadsheet
 * import's replace mode — and all three had it.
 *
 * The filenames have to be read BEFORE the delete, because the cascade is what
 * removes the only record of them. The files go AFTER, for the reason the
 * single-photo handler already gives: a file deleted before a row that then
 * fails to delete leaves a photo the UI lists and can never show.
 */

/** Read the photo filenames of every lodging matching `where`. */
export async function collectLodgingPhotoFilenames(
  where: { id: { in: string[] } } | Record<string, unknown>,
): Promise<string[]> {
  const photos = await prisma.lodgingPhoto.findMany({
    where: { lodging: where },
    select: { filename: true },
  });
  return photos.map((p) => p.filename);
}

/**
 * Remove the files. Never throws: the rows are already gone, and a byte that
 * could not be reclaimed must not turn a completed delete into an error the
 * user sees. It is logged instead, which is the only way anyone would know.
 */
export function removeLodgingPhotoFiles(filenames: string[]): void {
  for (const filename of filenames) {
    try {
      deleteLodgingPhotoFile(filename);
    } catch (error) {
      logger.warn(
        { operation: "lodging_photo_file_orphaned", filename, err: error },
        "[Lodging] Photo row deleted but its file could not be removed",
      );
    }
  }
}
