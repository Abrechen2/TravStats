/**
 * Which hotel chains an account can see and use — ONE home for the rule.
 *
 * Owner decision 2026-09-25: the seeded catalogue (`userId` null) stays global
 * and read-only; a chain a user creates, by hand or through an import, belongs
 * to that user. Before that every chain was global, and one tester's import
 * wrote "KOA" into the owner's catalogue (UAT 2026-08-16).
 *
 * So there are exactly two questions, and every chain lookup in the app asks
 * one of them through here rather than writing its own `where`:
 *
 *  - "which chains may this user see?" — catalogue ∪ own (`visibleChainsWhere`);
 *  - "which chain does this NAME mean for this user?" — case-insensitive, and
 *    the catalogue wins over an own row of the same name, so a house matched
 *    to "Hilton" lands on the chain every stats page and membership already
 *    knows (`findVisibleChainByName`).
 *
 * Creating is always an OWN chain (`findOrCreateOwnChain`). There is no route
 * that writes the catalogue; it grows from the CSV seed only.
 */

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";

export function visibleChainsWhere(userId: string): Prisma.LodgingChainWhereInput {
  return { OR: [{ userId: null }, { userId }] };
}

/** The chain a name means for this user, or null. Catalogue first, then own. */
export async function findVisibleChainByName(
  userId: string,
  name: string
): Promise<Prisma.LodgingChainGetPayload<object> | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return prisma.lodgingChain.findFirst({
    where: {
      AND: [visibleChainsWhere(userId), { name: { equals: trimmed, mode: "insensitive" } }],
    },
    // NULLS FIRST: the catalogue row, when both exist.
    orderBy: [{ userId: { sort: "asc", nulls: "first" } }, { id: "asc" }],
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export interface OwnChainFields {
  loyaltyProgram?: string | null;
  brandColor?: string | null;
}

/**
 * The chain this name means for the user — found among catalogue and own
 * rows, or created as the user's own. `created` says which, because the
 * route answers 201 for a new row and 200 for an existing one.
 *
 * The pre-check is case-insensitive; the (user_id, name) unique index is not,
 * so the P2002 catch is the backstop for two concurrent creates of the same
 * spelling. Two concurrent case variants can still both land — the residual
 * gap the global version documented too, now confined to one account.
 */
export async function findOrCreateOwnChain(
  userId: string,
  name: string,
  fields: OwnChainFields = {}
): Promise<{ chain: Prisma.LodgingChainGetPayload<object>; created: boolean }> {
  const trimmed = name.trim();
  const existing = await findVisibleChainByName(userId, trimmed);
  if (existing) return { chain: existing, created: false };
  try {
    const chain = await prisma.lodgingChain.create({
      data: { ...fields, name: trimmed, isUserAdded: true, userId },
    });
    return { chain, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findVisibleChainByName(userId, trimmed);
    if (!raced) throw error; // never swallow silently
    return { chain: raced, created: false };
  }
}

/**
 * Rejects chain ids the user cannot see, BEFORE a write links them. Another
 * account's chain answers exactly like a chain that does not exist — a 400
 * naming the ids — so the response does not confirm that it exists.
 */
export async function assertChainsVisible(userId: string, chainIds: number[]): Promise<number[]> {
  const unique = Array.from(new Set(chainIds));
  if (unique.length === 0) return [];
  const found = await prisma.lodgingChain.findMany({
    where: { AND: [visibleChainsWhere(userId), { id: { in: unique } }] },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    const known = new Set(found.map((c) => c.id));
    const missing = unique.filter((id) => !known.has(id));
    throw new AppError(`Unknown chain id(s): ${missing.join(", ")}`, 400);
  }
  return unique;
}
