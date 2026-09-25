/**
 * `replace` mode: delete the rows of one model that the file did not account
 * for.
 *
 * Only in `replace` mode, only for the calling user, and only ever counted in
 * a dry run — the count is the whole point of previewing a destructive
 * import, because those rows are invisible in the sheet the user is looking
 * at. They are about to lose data they cannot see.
 *
 * A row the file mentioned but FAILED on is in `seen` and therefore safe: a
 * refused row is not permission to delete the record it named.
 *
 * Cruise stops and lodging stays are deliberately NOT pruned: they go with
 * their parent (the cascade), and a stays sheet that is merely shorter than
 * the database — someone filtered it in Excel — must not cost stays whose
 * hotel is still there.
 */

import { prisma } from "../../db";
import logger from "../../utils/logger";
import {
  collectLodgingPhotoFilenames,
  removeLodgingPhotoFiles,
} from "../lodging/deleteLodgingPhotoFiles";
import type { Ctx } from "./context";

export type PrunableModel = "place" | "cruise" | "lodging" | "flight" | "placeVisit";

export async function pruneMissing(
  model: PrunableModel,
  seen: Set<string>,
  ctx: Ctx
): Promise<number> {
  if (ctx.mode !== "replace") return 0;

  const where = { userId: ctx.userId, id: { notIn: [...seen] } };

  // Written out per model rather than through a lookup: Prisma's delegates do
  // not share a callable signature, and a union of them is not invocable.
  const count = async (): Promise<number> => {
    if (model === "place") return prisma.place.count({ where });
    if (model === "cruise") return prisma.cruise.count({ where });
    if (model === "flight") return prisma.flight.count({ where });
    if (model === "placeVisit") return prisma.placeVisit.count({ where });
    return prisma.lodging.count({ where });
  };
  const removeAll = async (): Promise<void> => {
    if (model === "place") await prisma.place.deleteMany({ where });
    else if (model === "cruise") await prisma.cruise.deleteMany({ where });
    else if (model === "flight") await prisma.flight.deleteMany({ where });
    else if (model === "placeVisit") await prisma.placeVisit.deleteMany({ where });
    else {
      // The cascade takes the photo rows and with them the only record of
      // their filenames, so they are read first (AUD-042).
      const photoFiles = await collectLodgingPhotoFilenames(where);
      await prisma.lodging.deleteMany({ where });
      removeLodgingPhotoFiles(photoFiles);
    }
  };

  const doomed = await count();
  if (doomed === 0) return 0;

  if (!ctx.dryRun) {
    await removeAll();
    logger.warn(
      { operation: "xlsx_import_replace_deleted", model, userId: ctx.userId, deleted: doomed },
      "Spreadsheet import in replace mode deleted rows absent from the file"
    );
  }
  return doomed;
}
