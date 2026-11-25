import { prisma, type DbTransaction } from "../../db";
import { ADAPTERS } from "./adapters";
import { jsonSubset, sameFact } from "./factValues";
import type { CruiseLegRouteFact } from "./facts";
import { receivingMembers } from "./members";
import { noticeMeta, recordEntryNotice, SHARE_TX_TIMEOUT_MS } from "./propagate";
import { queueFactUpdate } from "./federation/outbound";

/**
 * Hand-drawn cruise lines became a shared fact on 2026-11-24. A share group that existed before
 * holds copies without them, and the next edit would be the first time they travel. This sends
 * them once, without re-sharing — the father's copy of the Antarctica cruise gets its line:
 *
 * - on this server, every receiving member's copy that has NO lines of its own takes the
 *   sharer's, with an "updated" notice like any change; a copy with lines of its own keeps them
 *   (counted as `kept`) — a recipient's own drawing is never overwritten by a rollout;
 * - on other servers, a `fact-update` from "no lines" to the lines is queued. A spoke whose copy
 *   already has lines of its own sees a before-value that does not match and keeps its line as a
 *   conflict in the inbox (the facts model, `inbound.ts`), never silently.
 *
 * A dry run runs the same code and rolls back. A second apply finds every local copy holding the
 * lines; the federated update is queued again but changes nothing where it arrived already.
 */
class DryRun extends Error {}

export interface CruiseRouteBackfillResult {
  cruises: number;
  copied: number;
  kept: number;
  queued: number;
}

async function backfillOne(
  tx: DbTransaction,
  cruiseId: string,
  result: CruiseRouteBackfillResult
): Promise<void> {
  const adapter = ADAPTERS.cruise;
  const [row] = await adapter.load(tx, [cruiseId]);
  const routes = row?.facts.legRoutes as CruiseLegRouteFact[] | undefined;
  if (!row?.shareKey || !row.tripId || !routes || routes.length === 0) return;
  const trip = await tx.trip.findUnique({
    where: { id: row.tripId },
    select: { shareGroupId: true },
  });
  const groupId = trip?.shareGroupId;
  if (!groupId) return;
  result.cruises++;
  const copies = await adapter.copiesOf(tx, row.shareKey, groupId);
  const reached: string[] = [];
  for (const member of await receivingMembers(tx, groupId, row.userId)) {
    const copy = copies.find((c) => c.userId === member.userId && c.tripId === member.id);
    if (!copy) continue;
    reached.push(member.userId);
    const held = (copy.facts.legRoutes as CruiseLegRouteFact[] | undefined) ?? [];
    if (sameFact(held, routes)) continue;
    if (held.length > 0) {
      result.kept++;
      continue;
    }
    await adapter.apply(tx, copy, row.facts, ["legRoutes"]);
    await recordEntryNotice(tx, {
      recipient: member,
      groupId,
      actorId: row.userId,
      kind: "updated",
      entity: "cruise",
      shareKey: row.shareKey,
      before: { facts: jsonSubset(copy.facts, ["legRoutes"]), zones: copy.zones },
      after: { ...noticeMeta(row, member, copy.id), facts: jsonSubset(row.facts, ["legRoutes"]) },
    });
    result.copied++;
  }
  const queuedBefore = await tx.tripShareOutbox.count({ where: { groupId } });
  await queueFactUpdate(
    tx,
    {
      groupId,
      author: { kind: "user", id: row.userId },
      via: [row.userId, ...reached],
      fromOrigin: null,
    },
    "cruise",
    row,
    { ...row.facts, legRoutes: [] },
    ["legRoutes"]
  );
  result.queued += (await tx.tripShareOutbox.count({ where: { groupId } })) - queuedBefore;
}

export async function backfillSharedCruiseRoutes(opts: {
  apply: boolean;
}): Promise<CruiseRouteBackfillResult> {
  const result: CruiseRouteBackfillResult = { cruises: 0, copied: 0, kept: 0, queued: 0 };
  const candidates = await prisma.cruise.findMany({
    where: {
      shareKey: { not: null },
      trip: { shareGroupId: { not: null } },
      legRoutes: { some: {} },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const { id } of candidates) {
    const counts: CruiseRouteBackfillResult = { cruises: 0, copied: 0, kept: 0, queued: 0 };
    try {
      await prisma.$transaction(
        async (tx) => {
          await backfillOne(tx, id, counts);
          if (!opts.apply) throw new DryRun();
        },
        { timeout: SHARE_TX_TIMEOUT_MS }
      );
    } catch (error) {
      if (!(error instanceof DryRun)) throw error;
    }
    result.cruises += counts.cruises;
    result.copied += counts.copied;
    result.kept += counts.kept;
    result.queued += counts.queued;
  }
  return result;
}
