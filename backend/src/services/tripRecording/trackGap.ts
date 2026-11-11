import { prisma } from "../../db";
import { trackGapMsOf } from "./trackGapBounds";

/** The user's gap in milliseconds; the default for an account without a settings row. */
export async function trackGapMsFor(userId: string): Promise<number> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { trackGapMinutes: true },
  });
  return trackGapMsOf(row?.trackGapMinutes);
}
