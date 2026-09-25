import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";

/** The caller's roadtrip, or 404 — also for a tour id, which is not a roadtrip. */
export async function resolveRoadtrip(userId: string, id: string): Promise<string> {
  const row = await prisma.tripRoute.findFirst({
    where: { id, userId, kind: "roadtrip" },
    select: { id: true },
  });
  if (!row) throw new AppError("Roadtrip not found", 404);
  return row.id;
}
