import { prisma } from "../../db";

/**
 * How many photos one visit or entry holds from the automatic linker (owner,
 * 2026-11-21: "5–10 max pro Aufenthalt"). The user's own picks count toward it,
 * so swapping a choice for another keeps the total instead of making room for
 * the matcher to link a replacement.
 */
export const PHOTO_CAP_MIN = 5;
export const PHOTO_CAP_MAX = 10;
export const PHOTO_CAP_DEFAULT = 6;

export const clampPhotoCap = (n: number): number =>
  Math.min(PHOTO_CAP_MAX, Math.max(PHOTO_CAP_MIN, Math.trunc(n)));

export async function photoCapFor(userId: string): Promise<number> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { photoAutoLinkCap: true },
  });
  return clampPhotoCap(row?.photoAutoLinkCap ?? PHOTO_CAP_DEFAULT);
}
