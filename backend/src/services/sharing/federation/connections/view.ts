/**
 * What the user sees of a connection (spec 2026-11-02 §5): one row per person on another server,
 * with its state, what this side gives (`mine`) and what the other side announced (`theirs` — for
 * a request still waiting, the switches the asker chose, so the confirm dialog shows what the
 * person gets before they set their own).
 */
import { prisma } from "../../../../db";
import { requireConnectionFederation } from "../access";
import { connectionsAvailability } from "../availability";
import { remoteShareError } from "../errors";
import type { ConnectionSwitches } from "../../../../schemas/tripSharePeer";
import { mineOf, theirsOf } from "./switches";

export const CONNECTION_STATES = [
  "pending_out",
  "pending_in",
  "active",
  "declined",
  "revoked",
  "reconfirm",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export interface ConnectionView {
  id: string;
  origin: string;
  username: string;
  displayName: string;
  state: ConnectionState;
  mine: ConnectionSwitches;
  theirs: ConnectionSwitches;
  requestedAt: string | null;
  confirmedAt: string | null;
  /** When it was declined or ended (the database column is `ended_at`). */
  revokedAt: string | null;
}

type Row = Parameters<typeof mineOf>[0] & {
  id: string;
  origin: string;
  username: string;
  displayName: string;
  state: string;
  requestedAt: Date | null;
  confirmedAt: Date | null;
  endedAt: Date | null;
};

export function connectionView(row: Row): ConnectionView {
  return {
    id: row.id,
    origin: row.origin,
    username: row.username,
    displayName: row.displayName,
    // The database holds the closed vocabulary (CHECK).
    state: row.state as ConnectionState,
    mine: mineOf(row),
    theirs: theirsOf(row),
    requestedAt: row.requestedAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    revokedAt: row.endedAt?.toISOString() ?? null,
  };
}

export async function listConnections(userId: string): Promise<ConnectionView[]> {
  await requireConnectionFederation(userId);
  const rows = await prisma.remoteShareAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(connectionView);
}

export async function readConnection(userId: string, id: string): Promise<ConnectionView> {
  const row = await prisma.remoteShareAccount.findFirst({ where: { id, userId } });
  if (!row)
    throw remoteShareError("SHARE_REMOTE_PERSON_NOT_FOUND", 404, "No such person", { userId });
  return connectionView(row);
}

/** Requests waiting for an answer, and pairings from before connections that wait to be confirmed. */
export async function countConnectionRequests(userId: string): Promise<number> {
  if (!(await connectionsAvailability()).available) return 0;
  return prisma.remoteShareAccount.count({
    where: { userId, state: { in: ["pending_in", "reconfirm"] } },
  });
}
