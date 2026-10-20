/**
 * Before this server sends anything to another one on a user's behalf (spec 2026-10-20 §7, §10):
 * that server is admitted by this server's admin and verified, and it serves trip sharing with
 * the feature on. Each failure is its own code naming the origin, so the screen can say which
 * server and what to ask for. Shared by the claim (F-S4b) and the offer (F-S4c).
 */
import { ZodError } from "zod";
import { prisma } from "../../../db";
import { PeerRefusal } from "../../federation/refusal";
import { TRIP_SHARE_VERSIONS, tripPingReplySchema } from "../../../schemas/tripSharePeer";
import { remoteShareError } from "./errors";
import { messageHeader, tripShareExchange } from "./transport";

export const kindOf = (error: unknown): string =>
  error instanceof PeerRefusal
    ? error.kind
    : error instanceof ZodError || error instanceof SyntaxError
      ? "malformed"
      : "unreachable";

export const unreachable = (userId: string, origin: string, kind: string) =>
  remoteShareError(
    "SHARE_REMOTE_UNREACHABLE",
    502,
    "That server does not answer",
    { userId, origin, kind },
    { origin }
  );

/** Admitted by this server's admin (pinned, enabled) AND verified by a ping that reached it. */
export async function requireAdmitted(userId: string, origin: string): Promise<void> {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  if (!peer?.enabled || !peer.verifiedAt)
    throw remoteShareError(
      "SHARE_REMOTE_PEER_NOT_ADMITTED",
      403,
      "The admin has not admitted that server",
      { userId, origin },
      { origin }
    );
}

/** The other server serves trip sharing version 1 and has it switched on. */
export async function requireTripSharePeer(userId: string, origin: string): Promise<void> {
  let versions: number[];
  try {
    const reply = await tripShareExchange(origin, { kind: "ping", ...messageHeader() });
    versions = tripPingReplySchema.parse(reply).tripShare;
  } catch (error) {
    // 404: off there, or a server from before trip sharing — the route is absent either way.
    if (error instanceof PeerRefusal && error.kind === "remote-absent")
      throw remoteShareError(
        "SHARE_REMOTE_PEER_DISABLED",
        409,
        "That server does not share trips across servers",
        { userId, origin },
        { origin }
      );
    throw unreachable(userId, origin, kindOf(error));
  }
  if (!versions.some((v) => (TRIP_SHARE_VERSIONS as readonly number[]).includes(v)))
    throw remoteShareError(
      "SHARE_REMOTE_PEER_OUTDATED",
      409,
      "That server needs an update",
      { userId, origin },
      { origin }
    );
}

/** A send that failed in transport: switched off there (404), or not answering usably. */
export function peerFailure(userId: string, origin: string, error: unknown) {
  if (error instanceof PeerRefusal && error.kind === "remote-absent")
    return remoteShareError(
      "SHARE_REMOTE_PEER_DISABLED",
      409,
      "That server does not share trips across servers",
      { userId, origin },
      { origin }
    );
  return unreachable(userId, origin, kindOf(error));
}
