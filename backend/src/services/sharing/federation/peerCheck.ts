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

/**
 * What a failed exchange was. `exchange()` turns every network failure into a `PeerRefusal` (a
 * name that does not resolve included), and an answer that does not parse is `malformed`; any
 * other error was thrown by this server's own code or database — `local-error`, never read as
 * "the other server does not answer" (F-S4d leftover).
 */
export const kindOf = (error: unknown): string =>
  error instanceof PeerRefusal
    ? error.kind
    : error instanceof ZodError || error instanceof SyntaxError
      ? "malformed"
      : LOCAL_ERROR;

export const LOCAL_ERROR = "local-error";

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
    throw peerFailure(userId, origin, error);
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

/**
 * A send that failed: switched off there (404), or not answering usably. A failure of this
 * server's own is passed on as itself (a 500 the log names), not dressed up as the other server's.
 */
export function peerFailure(userId: string, origin: string, error: unknown): unknown {
  if (kindOf(error) === LOCAL_ERROR) return error;
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
