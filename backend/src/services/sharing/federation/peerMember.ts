/**
 * Which membership a group message from another server is about (spec 2026-10-20 §4, F-S4d/e):
 * the group by (sending origin, `groupRef`) — one whose home is that server, or this server's own
 * group — then the pairing the message names (`from`, `to`), then that pairing's member row in
 * the group. Never by a ref or a channel alone.
 *
 * A membership that is held here — after a restore, a re-pinned key, a server this admin blocked
 * (`HELD_REASONS`) — answers `suspended`: the sender keeps the message and retries it, because
 * nothing about it is wrong; the person here has to confirm the membership again first (O9).
 */
import type { DbTransaction } from "../../../db";
import { rejectWith } from "./streams";

/** Suspended until the person here confirms again (restore, O9); messages wait, retried. */
export const HELD_REASONS = ["restore", "restore-invited", "peer-blocked", "repinned"] as const;
const HELD = new Set<string>(HELD_REASONS);
/** A member here still takes messages while their delivery towards that server is held up. */
const RECEIVING = new Set(["active", "unreachable"]);

export const isHeld = (m: { state: string; stateReason: string | null }): boolean =>
  m.state === "suspended" && HELD.has(m.stateReason ?? "");

interface Addressed {
  groupRef: string;
  from: string;
  to: string;
}

/** `ours`: only a group whose home is this server; `theirs`: only one whose home is `origin`. */
export type GroupSide = "ours" | "theirs" | "either";

export async function addressed(
  tx: DbTransaction,
  origin: string,
  message: Addressed,
  side: GroupSide = "either"
) {
  const group =
    (side !== "ours"
      ? await tx.tripShareGroup.findFirst({
          where: { homeOrigin: origin, federatedRef: message.groupRef },
        })
      : null) ??
    (side !== "theirs"
      ? await tx.tripShareGroup.findFirst({
          where: { homeOrigin: null, federatedRef: message.groupRef },
        })
      : null);
  if (!group) throw rejectWith("not-member");
  const pairing = await tx.remoteShareAccount.findFirst({
    where: { origin, channel: message.from, localChannel: message.to },
  });
  if (!pairing) throw rejectWith("not-member");
  const member = await tx.tripShareRemoteMember.findUnique({
    where: { groupId_remoteId: { groupId: group.id, remoteId: pairing.id } },
  });
  return { group, pairing, member };
}

/**
 * The member must still take ordinary messages: active, unreachable, or switched off there
 * (`off`, which recovers on the next message). Held → `suspended`; anything else → `not-member`.
 */
export function requireReceiving<T extends { state: string; stateReason: string | null }>(
  member: T | null
): T {
  if (!member) throw rejectWith("not-member");
  if (isHeld(member)) throw rejectWith("suspended");
  const live =
    RECEIVING.has(member.state) || (member.state === "suspended" && member.stateReason === "off");
  if (!live) throw rejectWith("not-member");
  return member;
}
