import type { DbTransaction } from "../../db";
import type { Prisma } from "../../prisma";
import {
  proposalWithEdits,
  sameStoredValue,
  type ChangeEntry,
  type FlightDataSnapshot,
} from "../pendingUpdates/snapshot";

/**
 * One provider change, one inbox item (spec 2026-10-16, D7). Two members of a
 * shared trip each get the provider's suggestion for their own copy; when one
 * accepts, propagation brings the other's copy to the same values and leaves a
 * share notice. The other's suggestion would now offer what is already there,
 * so it is `superseded` — the share notice (with its undo) is the item.
 *
 * Only a suggestion with NOTHING left to propose: every field its change list
 * names (its edited list, when the member edited it) already holds on the copy,
 * read through the same merge an apply would write (`proposalWithEdits`). A
 * partial match stays open, because it still proposes something the copy does
 * not have.
 *
 * The change list, not the snapshot, says what is proposed: `proposedData` is
 * the provider's WHOLE report — route object, overflown-country array, every
 * unchanged time — and judging every key of it would never match a stored row.
 * A suggestion without a change list proposes nothing judgeable and stays.
 */
const OPEN_STATUSES = ["pending", "edited"];

const asObject = (v: Prisma.JsonValue | null): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function proposedFields(update: {
  changes: Prisma.JsonValue;
  editedChanges: Prisma.JsonValue | null;
}): string[] {
  const list = update.editedChanges ?? update.changes;
  if (!Array.isArray(list)) return [];
  return (list as unknown as ChangeEntry[])
    .map((entry) => entry?.field)
    .filter((field): field is string => typeof field === "string");
}

export async function supersedeSatisfied(
  c: DbTransaction,
  flightId: string,
  by: { noticeId: string; actorId: string }
): Promise<number> {
  const flight = await c.flight.findUnique({ where: { id: flightId } });
  if (!flight) return 0;
  const row = flight as unknown as Record<string, unknown>;
  const open = await c.pendingFlightUpdate.findMany({
    where: { flightId, status: { in: OPEN_STATUSES } },
  });
  let superseded = 0;
  for (const update of open) {
    const fields = proposedFields(update);
    if (fields.length === 0) continue;
    const proposal = proposalWithEdits(
      update.proposedData as FlightDataSnapshot | null,
      update.editedData as FlightDataSnapshot | null
    ) as Record<string, unknown>;
    if (!fields.every((field) => sameStoredValue(row[field], proposal[field]))) continue;
    await c.pendingFlightUpdate.update({
      where: { id: update.id },
      data: {
        status: "superseded",
        metadata: { ...asObject(update.metadata), supersededBy: by } as Prisma.InputJsonValue,
      },
    });
    superseded += 1;
  }
  return superseded;
}

/**
 * The undo of a propagated change takes back what superseded the member's own
 * suggestion, so the suggestion proposes something again: it reopens — as
 * `edited` when the member had edited it, else `pending` — and loses the
 * `supersededBy` mark. Only the suggestions THIS notice superseded.
 */
export async function reopenSuperseded(
  c: DbTransaction,
  flightId: string,
  noticeId: string
): Promise<number> {
  const superseded = await c.pendingFlightUpdate.findMany({
    where: {
      flightId,
      status: "superseded",
      metadata: { path: ["supersededBy", "noticeId"], equals: noticeId },
    },
  });
  for (const update of superseded) {
    const { supersededBy: _gone, ...metadata } = asObject(update.metadata);
    await c.pendingFlightUpdate.update({
      where: { id: update.id },
      data: {
        status: update.editedChanges === null ? "pending" : "edited",
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
  return superseded.length;
}
