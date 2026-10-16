/**
 * What both the remote-friend flows (`remote.ts`) and the owner's answers (`consents.ts`) need
 * to say about another server: why its reply was not used, and that a friendship is over. Kept
 * apart so `consents.ts` can tell the other server without importing `remote.ts`, which
 * imports it.
 */
import { ZodError } from "zod";
import logger from "../../utils/logger";
import { exchange, PeerRefusal } from "../federation/security";

/** Why a reply that parsed was still not used. */
type UnexpectedReplyKind = "wrong-year" | "nameless" | "channel-reused";

/** A reply that parsed but does not answer what was asked (another year, a reused channel). */
export class UnexpectedReply extends Error {
  constructor(readonly kind: UnexpectedReplyKind) {
    super(`Unexpected peer reply: ${kind}`);
    this.name = "UnexpectedReply";
  }
}

/** The log's name for why another server's answer was not used. */
export const failureKind = (error: unknown): string => {
  if (error instanceof PeerRefusal) return error.kind;
  if (error instanceof UnexpectedReply) return error.kind;
  if (error instanceof ZodError || error instanceof SyntaxError) return "malformed";
  return "unreachable";
};

/** Best-effort: tells the other server a friendship on this channel is over. */
export async function tellEnded(origin: string, channel: string): Promise<void> {
  try {
    await exchange(origin, { action: "lb-state", channel, status: "withdrawn" });
  } catch (error) {
    // Its pulls are refused (unknown channel) from now on, so nothing more is served.
    logger.warn(
      { operation: "comparison_remote_end_unsent", origin, kind: failureKind(error) },
      "The other server was not told that a comparison ended"
    );
  }
}
