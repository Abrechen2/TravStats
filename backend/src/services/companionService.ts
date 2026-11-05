import { prisma } from "../db";
import { canonicalizeCompanionName, searchableCompanionName } from "../utils/companionName";

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
/** A companion name read, not yet stored: what the upsert will write. */
export interface PlannedCompanion {
  canonicalName: string;
  displayName: string;
  searchName: string;
}

/**
 * The read-only half of `resolveCompanions`: blank names dropped, unique by
 * identity (canonical form), positioned at the LAST occurrence and carrying
 * that occurrence's spelling. Touches nothing, so a caller that prepares a
 * write outside its transaction can plan here and upsert inside it.
 */
export function planCompanions(names: string[]): PlannedCompanion[] {
  const byLastOccurrence = new Map<string, PlannedCompanion>();
  for (const raw of names.map((n) => n.trim())) {
    const canonicalName = canonicalizeCompanionName(raw);
    if (canonicalName.length === 0) continue;
    byLastOccurrence.delete(canonicalName);
    byLastOccurrence.set(canonicalName, {
      canonicalName,
      displayName: raw,
      searchName: searchableCompanionName(raw),
    });
  }
  return Array.from(byLastOccurrence.values());
}

/** The write half: finds or creates each planned companion, on `db` (a transaction or the client). */
export async function upsertPlannedCompanions(
  db: Pick<typeof prisma, "companion">,
  userId: string,
  planned: PlannedCompanion[]
): Promise<ResolvedCompanion[]> {
  const resolved: ResolvedCompanion[] = [];
  for (const { canonicalName, displayName, searchName } of planned) {
    // An upsert, expressed as one: a companion the user already has must not
    // travel through an exception (#244). The newest spelling wins as the
    // display name; identity is the canonical form and never changes.
    const companion = await db.companion.upsert({
      where: { userId_canonicalName: { userId, canonicalName } },
      create: { userId, canonicalName, displayName, searchName },
      update: { displayName, searchName },
    });
    resolved.push({ id: companion.id, displayName: companion.displayName });
  }
  return resolved;
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
  return upsertPlannedCompanions(prisma, userId, planCompanions(names));
}

/** Turns an ordered list of companion ids into join rows carrying their order. */
export function linkRowsFor(companionIds: string[]): { companionId: string; position: number }[] {
  return companionIds.map((companionId, position) => ({ companionId, position }));
}
