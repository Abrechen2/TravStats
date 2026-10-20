/**
 * How a person on another server appears on a trip page (spec 2026-10-20 §7: "every remote
 * member row in the trip's people section carries its state"): name, server, state, and what
 * last went wrong, so the page says it instead of showing a member who silently has nothing.
 */
import { prisma } from "../../../db";
import { remoteMemberStateSchema, type RemoteMemberState } from "../../../schemas/sharingRemote";

export interface RemoteMemberView {
  id: string;
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
  state: RemoteMemberState;
  /** `entries-undelivered`, `entries-refused`, `restore`, … — null when nothing is wrong. */
  stateReason: string | null;
  stateSince: string;
}

export const MEMBER_INCLUDE = {
  remote: { select: { id: true, displayName: true, username: true, origin: true } },
} as const;

export function remoteMemberView(row: {
  id: string;
  state: string;
  stateReason: string | null;
  stateSince: Date;
  remote: { id: string; displayName: string; username: string; origin: string };
}): RemoteMemberView {
  return {
    id: row.id,
    remoteId: row.remote.id,
    displayName: row.remote.displayName,
    username: row.remote.username,
    origin: row.remote.origin,
    state: remoteMemberStateSchema.parse(row.state),
    stateReason: row.stateReason,
    stateSince: row.stateSince.toISOString(),
  };
}

export async function readRemoteMember(id: string): Promise<RemoteMemberView> {
  return remoteMemberView(
    await prisma.tripShareRemoteMember.findUniqueOrThrow({ where: { id }, include: MEMBER_INCLUDE })
  );
}
