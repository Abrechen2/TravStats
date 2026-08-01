import { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { canonicalizeCompanionName, searchableCompanionName } from '../utils/companionName';

export interface ResolvedCompanion {
  id: string;
  displayName: string;
}

/**
 * Finds or creates the user's companions for a list of raw names and returns
 * them in input order. Blank entries are dropped. The newest spelling wins as
 * the display name; identity is the canonical form and never changes.
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

  return resolved;
}

/** Turns an ordered list of companion ids into join rows carrying their order. */
export function linkRowsFor(companionIds: string[]): { companionId: string; position: number }[] {
  return companionIds.map((companionId, position) => ({ companionId, position }));
}
