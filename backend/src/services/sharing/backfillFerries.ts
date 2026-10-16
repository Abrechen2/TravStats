import { prisma } from "../../db";
import { restatusTrips } from "../trip/restatusTrips";
import { copyMissing } from "./copyInto";
import { assignKeysFor } from "./keyOps";
import { acceptedWith, receivingMembers } from "./members";
import { noticeMeta, recordEntryNotice, SHARE_TX_TIMEOUT_MS } from "./propagate";

/**
 * The two rollout tools of the rework (spec 2026-10-16, §10).
 *
 * `backfillSharedFerries` gives every existing group the crossings it would
 * hold had ferry been shareable from the start: per group, per member trip,
 * per receiving member (consenting AND active — `receivingMembers`), exactly
 * what sharing again would do — key the crossings, join the other's own
 * logged crossing or copy it, tell them. Each group runs in its own
 * transaction. A dry run runs the same code and rolls the transaction back, so
 * the counts it prints are the counts an apply would produce and nothing stays
 * written. A second apply finds every key held and changes nothing.
 *
 * `unconsentedPairs` names member pairs of a group with no accepted consent
 * in either direction — they do not receive each other's changes
 * (`receivingMembers`). It changes nothing: consent is given, never inferred.
 */
class DryRun extends Error {}

export interface BackfillResult {
  groups: number;
  keyed: number;
  joined: number;
  copied: number;
}

type Counts = Omit<BackfillResult, "groups">;

export async function backfillSharedFerries(opts: { apply: boolean }): Promise<BackfillResult> {
  const groups = await prisma.tripShareGroup.findMany({ select: { id: true } });
  const total: BackfillResult = { groups: groups.length, keyed: 0, joined: 0, copied: 0 };
  for (const group of groups) {
    const counted: Counts = { keyed: 0, joined: 0, copied: 0 };
    try {
      await prisma.$transaction(
        async (tx) => {
          const trips = await tx.trip.findMany({
            where: { shareGroupId: group.id },
            select: { id: true, userId: true },
            orderBy: { createdAt: "asc" },
          });
          for (const source of trips) {
            counted.keyed += await assignKeysFor(tx, "ferry", source.userId, source.id);
            for (const member of await receivingMembers(tx, group.id, source.userId)) {
              const copied = await copyMissing(
                tx,
                "ferry",
                { userId: source.userId, tripId: source.id },
                { userId: member.userId, tripId: member.id }
              );
              for (const entry of copied) {
                counted[entry.joined ? "joined" : "copied"] += 1;
                await recordEntryNotice(tx, {
                  recipient: member,
                  groupId: group.id,
                  actorId: source.userId,
                  kind: "created",
                  entity: "ferry",
                  shareKey: entry.source.shareKey as string,
                  after: {
                    ...noticeMeta(entry.source, member, entry.id),
                    ...(entry.joined ? { joined: true } : {}),
                  },
                });
              }
              if (copied.length > 0) await restatusTrips([member.id], tx);
            }
          }
          if (!opts.apply) throw new DryRun();
        },
        { timeout: SHARE_TX_TIMEOUT_MS }
      );
    } catch (err) {
      if (!(err instanceof DryRun)) throw err;
    }
    total.keyed += counted.keyed;
    total.joined += counted.joined;
    total.copied += counted.copied;
  }
  return total;
}

export async function unconsentedPairs(): Promise<
  { groupId: string; pairs: [string, string][] }[]
> {
  const trips = await prisma.trip.findMany({
    where: { shareGroupId: { not: null } },
    select: { userId: true, shareGroupId: true },
  });
  const byGroup = new Map<string, string[]>();
  for (const t of trips) {
    const list = byGroup.get(t.shareGroupId as string) ?? [];
    if (!list.includes(t.userId)) list.push(t.userId);
    byGroup.set(t.shareGroupId as string, list);
  }
  const out: { groupId: string; pairs: [string, string][] }[] = [];
  for (const [groupId, users] of byGroup) {
    const pairs: [string, string][] = [];
    for (const [i, a] of users.entries()) {
      const later = users.slice(i + 1);
      const ok = await acceptedWith(prisma, a, later);
      for (const b of later) if (!ok.has(b)) pairs.push([a, b]);
    }
    if (pairs.length > 0) out.push({ groupId, pairs });
  }
  return out;
}
