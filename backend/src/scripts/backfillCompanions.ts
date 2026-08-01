import { prisma } from "../db";
import { linkRowsFor, resolveCompanions } from "../services/companionService";
import { canonicalizeCompanionName } from "../utils/companionName";
import logger from "../utils/logger";

const USER_PAGE_SIZE = 100;
const RECORD_PAGE_SIZE = 200;

/** canonicalName -> (trimmed spelling -> occurrence count), scoped to one user's pass. */
type SpellingFrequency = Map<string, Map<string, number>>;

/** The shape every domain's candidate query selects for its `companionLinks`. */
interface LinkedCanonicalName {
  companion: { canonicalName: string };
}

/**
 * The canonical identity sequence `resolveCompanions()` would produce for
 * this array: blanks dropped, deduped by canonical name, each identity
 * positioned at its LAST occurrence. Pure (no DB access) so it is cheap
 * enough to run as a read-only mismatch check on every candidate, every run.
 */
function expectedCanonicalOrder(companions: string[]): string[] {
  const order = new Map<string, true>();
  for (const raw of companions) {
    const canonical = canonicalizeCompanionName(raw.trim());
    if (!canonical) continue;
    order.delete(canonical);
    order.set(canonical, true);
  }
  return Array.from(order.keys());
}

/**
 * True when a record's current `companionLinks` already match what its
 * legacy `companions` array would resolve to -- same identities, same
 * order. False for a never-linked record, a record whose array grew/shrunk/
 * changed since it was last linked (the rollback round-trip case), or one
 * whose link `position` values drifted out of the array's order.
 */
function isAlreadyReconciled(companions: string[], companionLinks: LinkedCanonicalName[]): boolean {
  const expected = expectedCanonicalOrder(companions);
  const actual = companionLinks.map((link) => link.companion.canonicalName);
  return (
    expected.length === actual.length && expected.every((name, index) => name === actual[index])
  );
}

/**
 * Genuinely one-shot, idempotent backfill: converts the legacy free-text
 * `companions` arrays on flights, trips and cruises into `Companion`
 * entities plus ordered `{Flight,Trip,Cruise}Companion` link rows.
 * Blank/whitespace-only entries are dropped; every other name -- however
 * odd, e.g. "MUELLER/ANNA MS" -- is preserved verbatim, never "cleaned".
 *
 * Identity resolution goes through the same `resolveCompanions()` the live
 * write paths use, so the backfill and runtime agree on what counts as "the
 * same person". Where several distinct spellings collapse onto one
 * canonical identity (e.g. "Anna" and "anna"), the most frequent trimmed
 * spelling wins as the final `displayName` and the other spellings are
 * logged as aliases at info level.
 *
 * Reconciliation, not just first-fill: every domain query selects every
 * record with a non-empty `companions` array (not just unlinked ones) plus
 * its current `companionLinks` (companion canonical names, in position
 * order). A record is only touched -- `resolveCompanions()` called,
 * existing links deleted and recreated -- when the *expected* canonical
 * order (deduped from `companions`, same last-occurrence-wins rule
 * `resolveCompanions()` itself uses) differs from the *actual* linked
 * order. This catches not only never-linked records but also ones where the
 * two stores drifted back apart after the initial link -- e.g. a user
 * upgrades (links get written), rolls back to the previous image and edits
 * companions there (only the array is written), then re-upgrades: the old
 * `companionLinks: { none: {} } }` filter would skip that record forever
 * because it already had (now-stale) links, silently losing the rollback
 * edit once the legacy column is eventually dropped. It also subsumes a
 * previously parked finding that link `position` drift (same identities,
 * wrong order) could never self-heal under the old filter -- a full rebuild
 * recomputes position from the array every time a mismatch is found, order
 * included.
 *
 * Still terminates: the comparison above is pure (string canonicalization
 * only, no writes) and a record that already matches is left untouched, so
 * once every record's links agree with its array the scan changes nothing
 * on any later run -- `resolveCompanions()` (the only call that can bump
 * `Companion.updatedAt`) is never invoked for an already-consistent record.
 *
 * Paged in two dimensions -- users, then records per user, per domain -- so
 * at most one page of one domain's `{id, companions}` rows is ever held in
 * memory. The one per-user structure that lives for the whole pass is the
 * spelling-frequency map, which holds only the (typically small) set of
 * distinct companion name strings that user has ever written -- not the
 * records themselves -- so it stays bounded even for a user with a large
 * flight history.
 */
export async function backfillCompanions(): Promise<number> {
  let totalLinks = 0;
  let userCursor: string | undefined;

  for (;;) {
    const users = await prisma.user.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: USER_PAGE_SIZE,
      ...(userCursor ? { cursor: { id: userCursor }, skip: 1 } : {}),
    });
    if (users.length === 0) break;

    for (const user of users) {
      totalLinks += await backfillUser(user.id);
    }

    userCursor = users[users.length - 1].id;
    if (users.length < USER_PAGE_SIZE) break;
  }

  return totalLinks;
}

async function backfillUser(userId: string): Promise<number> {
  const spellingCounts: SpellingFrequency = new Map();
  const recordSpelling = (raw: string): void => {
    const trimmed = raw.trim();
    const canonical = canonicalizeCompanionName(trimmed);
    if (!canonical) return; // blank/whitespace-only, matches resolveCompanions' own filter
    const spellings = spellingCounts.get(canonical) ?? new Map<string, number>();
    spellings.set(trimmed, (spellings.get(trimmed) ?? 0) + 1);
    spellingCounts.set(canonical, spellings);
  };

  let links = 0;
  links += await backfillFlights(userId, recordSpelling);
  links += await backfillTrips(userId, recordSpelling);
  links += await backfillCruises(userId, recordSpelling);

  await reconcileDisplayNames(userId, spellingCounts);

  return links;
}

async function backfillFlights(
  userId: string,
  recordSpelling: (raw: string) => void
): Promise<number> {
  let links = 0;
  let cursor: string | undefined;

  for (;;) {
    const flights = await prisma.flight.findMany({
      where: { userId, companions: { isEmpty: false } },
      select: {
        id: true,
        companions: true,
        companionLinks: {
          orderBy: { position: "asc" },
          select: { companion: { select: { canonicalName: true } } },
        },
      },
      orderBy: { id: "asc" },
      take: RECORD_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (flights.length === 0) break;

    for (const flight of flights) {
      if (isAlreadyReconciled(flight.companions, flight.companionLinks)) continue;

      flight.companions.forEach(recordSpelling);
      const resolved = await resolveCompanions(userId, flight.companions);
      await prisma.flightCompanion.deleteMany({ where: { flightId: flight.id } });
      if (resolved.length > 0) {
        const result = await prisma.flightCompanion.createMany({
          data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
            flightId: flight.id,
            companionId: row.companionId,
            position: row.position,
          })),
          skipDuplicates: true,
        });
        links += result.count;
      }
    }

    cursor = flights[flights.length - 1].id;
    if (flights.length < RECORD_PAGE_SIZE) break;
  }

  return links;
}

async function backfillTrips(
  userId: string,
  recordSpelling: (raw: string) => void
): Promise<number> {
  let links = 0;
  let cursor: string | undefined;

  for (;;) {
    const trips = await prisma.trip.findMany({
      where: { userId, companions: { isEmpty: false } },
      select: {
        id: true,
        companions: true,
        companionLinks: {
          orderBy: { position: "asc" },
          select: { companion: { select: { canonicalName: true } } },
        },
      },
      orderBy: { id: "asc" },
      take: RECORD_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (trips.length === 0) break;

    for (const trip of trips) {
      if (isAlreadyReconciled(trip.companions, trip.companionLinks)) continue;

      trip.companions.forEach(recordSpelling);
      const resolved = await resolveCompanions(userId, trip.companions);
      await prisma.tripCompanion.deleteMany({ where: { tripId: trip.id } });
      if (resolved.length > 0) {
        const result = await prisma.tripCompanion.createMany({
          data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
            tripId: trip.id,
            companionId: row.companionId,
            position: row.position,
          })),
          skipDuplicates: true,
        });
        links += result.count;
      }
    }

    cursor = trips[trips.length - 1].id;
    if (trips.length < RECORD_PAGE_SIZE) break;
  }

  return links;
}

async function backfillCruises(
  userId: string,
  recordSpelling: (raw: string) => void
): Promise<number> {
  let links = 0;
  let cursor: string | undefined;

  for (;;) {
    const cruises = await prisma.cruise.findMany({
      where: { userId, companions: { isEmpty: false } },
      select: {
        id: true,
        companions: true,
        companionLinks: {
          orderBy: { position: "asc" },
          select: { companion: { select: { canonicalName: true } } },
        },
      },
      orderBy: { id: "asc" },
      take: RECORD_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (cruises.length === 0) break;

    for (const cruise of cruises) {
      if (isAlreadyReconciled(cruise.companions, cruise.companionLinks)) continue;

      cruise.companions.forEach(recordSpelling);
      const resolved = await resolveCompanions(userId, cruise.companions);
      await prisma.cruiseCompanion.deleteMany({ where: { cruiseId: cruise.id } });
      if (resolved.length > 0) {
        const result = await prisma.cruiseCompanion.createMany({
          data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
            cruiseId: cruise.id,
            companionId: row.companionId,
            position: row.position,
          })),
          skipDuplicates: true,
        });
        links += result.count;
      }
    }

    cursor = cruises[cruises.length - 1].id;
    if (cruises.length < RECORD_PAGE_SIZE) break;
  }

  return links;
}

/**
 * `resolveCompanions()` sets `displayName` to whichever spelling it saw
 * LAST, which -- across many records processed in an arbitrary domain order
 * -- is not necessarily the most common one. This corrective pass runs once
 * per user after all their flights/trips/cruises are linked: for every
 * canonical identity that was written under more than one distinct
 * spelling, it re-resolves with the most frequent trimmed spelling so the
 * final `displayName` reflects usage rather than processing order, and logs
 * the collapsed aliases.
 */
async function reconcileDisplayNames(
  userId: string,
  spellingCounts: SpellingFrequency
): Promise<void> {
  for (const [canonicalName, spellings] of spellingCounts) {
    if (spellings.size <= 1) continue; // only ever written one way, nothing to reconcile

    let winner = "";
    let winnerCount = -1;
    for (const [spelling, count] of spellings) {
      if (count > winnerCount || (count === winnerCount && spelling < winner)) {
        winner = spelling;
        winnerCount = count;
      }
    }

    const aliases = Array.from(spellings.keys()).filter((spelling) => spelling !== winner);
    const [resolved] = await resolveCompanions(userId, [winner]);
    if (resolved) {
      logger.info({
        operation: "backfill_companions_collapsed_spelling",
        userId,
        canonicalName,
        displayName: resolved.displayName,
        aliases,
      });
    }
  }
}
