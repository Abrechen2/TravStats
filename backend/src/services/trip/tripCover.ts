import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";

/**
 * Who chose a trip's cover, and how it is framed.
 *
 * Owner rule (2026-11-22): an automatic cover never overwrites one a person set,
 * and an automatic choice can always be replaced. Every route a person drives
 * (upload, album, trip photo, entry photo, suggestion, PATCH) goes through
 * `manualCoverData`; automatic code goes through `fillEmptyCover` only.
 */
export type CoverSource = "manual" | "auto";

/** The columns a manual cover change writes. A new image starts uncropped. */
export function manualCoverData(
  coverImageUrl: string | null,
  coverCrop?: Prisma.InputJsonValue | null
): Pick<Prisma.TripUncheckedUpdateInput, "coverImageUrl" | "coverCrop" | "coverSource"> {
  if (coverImageUrl === null) {
    return { coverImageUrl: null, coverCrop: Prisma.JsonNull, coverSource: null };
  }
  return {
    coverImageUrl,
    coverCrop: coverCrop ?? Prisma.JsonNull,
    coverSource: "manual",
  };
}

/**
 * Automatic cover (import, album link, first photo …): fills an EMPTY cover only,
 * atomically — the `coverImageUrl: null` condition is in the UPDATE itself, so a
 * person's choice made a moment earlier cannot be overwritten. Returns whether
 * it was applied.
 */
export async function fillEmptyCover(tripId: string, coverImageUrl: string): Promise<boolean> {
  const { count } = await prisma.trip.updateMany({
    where: { id: tripId, coverImageUrl: null },
    data: { coverImageUrl, coverCrop: Prisma.JsonNull, coverSource: "auto" },
  });
  return count === 1;
}

/**
 * The cover columns of a PATCH. A new URL resets the crop (unless one comes with
 * it); the same URL resent by a client that echoes the whole trip keeps the
 * crop; a crop alone re-frames the existing cover; `null` clears both.
 */
export function coverPatchData(
  body: { coverImageUrl?: string | null; coverCrop?: Prisma.InputJsonValue | null },
  existing: { coverImageUrl: string | null }
): Prisma.TripUncheckedUpdateInput {
  const { coverImageUrl, coverCrop } = body;
  if (coverImageUrl !== undefined) {
    if (
      coverImageUrl !== null &&
      coverImageUrl === existing.coverImageUrl &&
      coverCrop === undefined
    ) {
      return {};
    }
    return manualCoverData(coverImageUrl, coverCrop);
  }
  if (coverCrop === undefined) return {};
  if (!existing.coverImageUrl) throw new AppError("coverCropWithoutCover", 400);
  return { coverCrop: coverCrop ?? Prisma.JsonNull, coverSource: "manual" };
}
