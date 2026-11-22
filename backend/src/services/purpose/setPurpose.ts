import { prisma } from "../../db";
import type { PurposeEntryType } from "../../schemas/purpose";
import type { Purpose } from "../../shared/purpose";

type Delegate = {
  findFirst(args: { where: { id: string; userId: string }; select: { id: true } }): Promise<{
    id: string;
  } | null>;
  update(args: {
    where: { id: string };
    data: { purpose: Purpose | null };
    select: { purpose: true };
  }): Promise<{ purpose: string | null }>;
};

/** The Prisma delegate behind each kind; all eight share the `purpose` column. */
const delegateOf = (type: PurposeEntryType): Delegate =>
  (prisma as unknown as Record<PurposeEntryType, Delegate>)[type];

/**
 * Sets (or clears, with null) the purpose of one of the caller's entries. Returns the stored
 * value, or undefined when the entry is not the caller's.
 */
export async function setEntryPurpose(
  userId: string,
  type: PurposeEntryType,
  id: string,
  purpose: Purpose | null
): Promise<string | null | undefined> {
  const delegate = delegateOf(type);
  if (!(await delegate.findFirst({ where: { id, userId }, select: { id: true } })))
    return undefined;
  // Purpose is the member's own view, never a share fact: nothing to propagate.
  const row = await delegate.update({
    where: { id },
    data: { purpose },
    select: { purpose: true },
  });
  return row.purpose;
}
