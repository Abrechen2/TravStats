import { prisma } from "../../db";
import type { PurposeEntryType } from "../../schemas/purpose";

type Stored = { purpose: string | null; purposeKey: string | null };

type Delegate = {
  findFirst(args: { where: { id: string; userId: string }; select: { id: true } }): Promise<{
    id: string;
  } | null>;
  update(args: {
    where: { id: string; userId: string };
    data: { purpose: string | null };
    select: { purpose: true; purposeKey: true };
  }): Promise<Stored>;
};

/** The Prisma delegate behind each kind; all share the `purpose` and `purpose_key` columns. */
const delegateOf = (type: PurposeEntryType): Delegate =>
  (prisma as unknown as Record<PurposeEntryType, Delegate>)[type];

/**
 * Sets (or clears, with null) the purpose of one of the caller's entries: a legacy kind or a
 * detailed key (the Prisma hook splits it, services/purpose/purposeKeyWrite.ts). Returns the
 * stored kind and key, or undefined when the entry is not the caller's.
 */
export async function setEntryPurpose(
  userId: string,
  type: PurposeEntryType,
  id: string,
  purpose: string | null
): Promise<Stored | undefined> {
  const delegate = delegateOf(type);
  if (!(await delegate.findFirst({ where: { id, userId }, select: { id: true } })))
    return undefined;
  // Purpose is the member's own view, never a share fact: nothing to propagate.
  return await delegate.update({
    where: { id, userId },
    data: { purpose },
    select: { purpose: true, purposeKey: true },
  });
}
