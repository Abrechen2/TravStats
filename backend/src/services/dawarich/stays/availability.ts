import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { staySuggestionsEnabled } from "../../settings/suggestionSwitches";

/**
 * What every step of a stay scan re-checks. Domains control visibility
 * elsewhere; automatic background collection must additionally respect a
 * user's decision not to use the Places domain — and the account's
 * `staySuggestions.enabled` switch (forgejo#306). The switch sits in the same
 * predicate as the reservation, so switching it off mid-scan stops the scan at
 * its next write exactly as withdrawing the scan consent does.
 */
export const stayScanAllowedWhere = {
  user: { settings: { is: { enabledDomains: { has: "poi" }, staySuggestionsEnabled: true } } },
};

/** Refused before anything is reserved or fetched: off means no Dawarich request. */
export async function requireStaySuggestionsEnabled(userId: string): Promise<void> {
  if (!(await staySuggestionsEnabled(userId)))
    throw new AppError("Stay suggestions are switched off", 409, "STAY_SUGGESTIONS_DISABLED");
}

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
