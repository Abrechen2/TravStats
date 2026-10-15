import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";

// Domains control visibility elsewhere; automatic background collection must
// additionally respect a user's decision not to use the Places domain.
export const placesEnabledWhere = {
  user: { settings: { is: { enabledDomains: { has: "poi" } } } },
};

export async function placesEnabled(userId: string): Promise<boolean> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { enabledDomains: true },
  });
  return settings?.enabledDomains.includes("poi") ?? false;
}

export async function requirePlacesEnabled(userId: string): Promise<void> {
  if (!(await placesEnabled(userId)))
    throw new AppError("Places domain is disabled", 409, "DAWARICH_PLACES_DISABLED");
}

/** Same UTC schedule as the scheduler: 00:15, 06:15, 12:15, 18:15. */
export function nextStayScanAt(now = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(Math.floor(now.getUTCHours() / 6) * 6, 15, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 6);
  return next;
}
