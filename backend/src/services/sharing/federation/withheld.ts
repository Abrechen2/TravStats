/**
 * Changes a spoke did not apply because its person had not said yes to the author (spec
 * 2026-10-20 F-S4e roster; Q4 catch-up, 2026-10-21). Only the facts and the value the copy held
 * when the change was withheld are kept — what a later resync needs to tell "this difference is
 * exactly the change you were not asked about yet" from "you changed this yourself".
 *
 * Bounded by what the copy holds: one row per (person, entry, fact, author), the first value kept.
 */
import type { DbTransaction } from "../../../db";
import type { Prisma } from "../../../prisma";
import { fromJsonFact, toJsonFact, type FactRecord } from "../factValues";

type Client = Pick<DbTransaction, "tripShareWithheld">;

export interface WithheldChange {
  groupId: string;
  userId: string;
  shareKey: string;
  /** The author's roster ref, the one the person has not said yes to. */
  ref: string;
  /** Local fact names the change touched. */
  keys: readonly string[];
  /** The copy's facts when the change was withheld. */
  held: FactRecord;
}

/** Remember a withheld change; a fact already remembered for that author keeps its first value. */
export async function recordWithheld(c: Client, w: WithheldChange): Promise<void> {
  for (const field of new Set(w.keys)) {
    if (field === "status") continue;
    await c.tripShareWithheld.upsert({
      where: {
        groupId_userId_shareKey_field_ref: {
          groupId: w.groupId,
          userId: w.userId,
          shareKey: w.shareKey,
          field,
          ref: w.ref,
        },
      },
      create: {
        groupId: w.groupId,
        userId: w.userId,
        shareKey: w.shareKey,
        field,
        ref: w.ref,
        // Wrapped, so a null value is a JSON value like any other.
        held: { value: toJsonFact(w.held[field] ?? null) } as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
}

/** The value a withheld row kept, revived as a fact (dates as dates). */
export const heldValue = (held: Prisma.JsonValue): unknown =>
  fromJsonFact((held as { value?: unknown } | null)?.value ?? null);

/** The withheld changes of one entry for one person. */
export function withheldOf(c: Client, groupId: string, userId: string, shareKey: string) {
  return c.tripShareWithheld.findMany({ where: { groupId, userId, shareKey } });
}

/** Forget the withheld changes of the given facts of one entry (decided by a resync). */
export async function forgetWithheld(
  c: Client,
  groupId: string,
  userId: string,
  shareKey: string,
  fields: readonly string[]
): Promise<void> {
  if (fields.length === 0) return;
  await c.tripShareWithheld.deleteMany({
    where: { groupId, userId, shareKey, field: { in: [...fields] } },
  });
}
