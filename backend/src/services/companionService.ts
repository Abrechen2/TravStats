import { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { canonicalizeCompanionName, searchableCompanionName } from '../utils/companionName';

export interface ResolvedCompanion {
  id: string;
  displayName: string;
}

/**
 * Finds or creates the user's companions for a list of raw names and returns
 * them UNIQUE BY ID, in input order. Blank entries are dropped. The newest
 * spelling wins as the display name; identity is the canonical form and
 * never changes. When a single call repeats the same identity (e.g.
 * `['Anna', 'anna']` — same person, different casing), only ONE entry is
 * returned for it, positioned where its LAST occurrence appeared in the
 * input, carrying that last occurrence's (newest) display name. Callers
 * that turn the result into join rows (`linkRowsFor`) or a legacy
 * denormalized array depend on this uniqueness to avoid writing duplicate
 * `(flightId, companionId)` rows that would silently disagree with the
 * array's length.
 */
export async function resolveCompanions(
  userId: string,
  names: string[]
): Promise<ResolvedCompanion[]> {
  const wanted = names
    .map((raw) => ({ raw: raw.trim(), canonical: canonicalizeCompanionName(raw) }))
    .filter((n) => n.canonical.length > 0);

  const resolved: ResolvedCompanion[] = [];

  for (const { raw, canonical } of wanted) {
    const data = {
      userId,
      canonicalName: canonical,
      displayName: raw,
      searchName: searchableCompanionName(raw),
    };

    try {
      const created = await prisma.companion.create({ data });
      resolved.push({ id: created.id, displayName: created.displayName });
    } catch (error) {
      // Unique violation: the companion already exists (or a parallel request
      // just created it). Update the display name to the newest spelling.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.companion.update({
          where: { userId_canonicalName: { userId, canonicalName: canonical } },
          data: { displayName: raw, searchName: data.searchName },
        });
        resolved.push({ id: existing.id, displayName: existing.displayName });
      } else {
        throw error;
      }
    }
  }

  // Dedupe by id, keeping the LAST occurrence: deleting-then-setting on a Map
  // moves the re-inserted key to the end, so the final iteration order is
  // exactly "one entry per id, positioned at its last occurrence" — with
  // that occurrence's (newest) displayName already attached.
  const byLastOccurrence = new Map<string, ResolvedCompanion>();
  for (const companion of resolved) {
    byLastOccurrence.delete(companion.id);
    byLastOccurrence.set(companion.id, companion);
  }

  return Array.from(byLastOccurrence.values());
}

/** Turns an ordered list of companion ids into join rows carrying their order. */
export function linkRowsFor(companionIds: string[]): { companionId: string; position: number }[] {
  return companionIds.map((companionId, position) => ({ companionId, position }));
}
