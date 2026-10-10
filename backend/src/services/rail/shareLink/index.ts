import { toRailCandidate, type RailImportCandidate } from "../parser/railCandidates";
import { bookingFromConnection, fetchDbConnection, type ShareLinkFailure } from "./dbConnection";
import { NO_FACTS, parseShareLink, type ShareLinkFacts } from "./shareLinkUrl";

/**
 * A pasted rail link, read as far as it can be (forgejo#204).
 *
 * The answer always names what happened: `read` with a booking for the
 * ordinary rail review, or `failed` with a reason the client words — and, in
 * both cases, the facts the link itself carried, so a failure still hands the
 * next step (a PDF, a booking mail, typing it in) what was reliably known.
 * A search link carries its facts but no ride: it answers `failed` /
 * `noConnectionInLink`, never a ride assembled from a search.
 */

export type ShareLinkOutcome =
  | { outcome: "read"; facts: ShareLinkFacts; booking: RailImportCandidate }
  | {
      outcome: "failed";
      reason: ShareLinkFailure | "noConnectionInLink";
      facts: ShareLinkFacts;
    };

export interface ShareLinkDeps {
  fetchConnection: typeof fetchDbConnection;
}

const defaultDeps: ShareLinkDeps = { fetchConnection: fetchDbConnection };

export async function resolveShareLink(
  url: string,
  userId: string | undefined,
  deps: ShareLinkDeps = defaultDeps
): Promise<ShareLinkOutcome> {
  const link = parseShareLink(url);
  if (link.kind === "invalid") return { outcome: "failed", reason: "invalidLink", facts: NO_FACTS };
  if (link.kind === "unsupported") {
    return { outcome: "failed", reason: "unsupportedLink", facts: NO_FACTS };
  }
  if (link.kind === "dbSearch") {
    return { outcome: "failed", reason: "noConnectionInLink", facts: link.facts };
  }
  const fetched = await deps.fetchConnection(link.vbid);
  if (!fetched.ok) return { outcome: "failed", reason: fetched.reason, facts: link.facts };
  const booking = bookingFromConnection(fetched.connection, link.facts.travelClass);
  if (!booking) return { outcome: "failed", reason: "noTrain", facts: link.facts };
  return { outcome: "read", facts: link.facts, booking: await toRailCandidate(booking, userId) };
}

export { SHARE_LINK_FAILURES } from "./dbConnection";
export type { ShareLinkFailure } from "./dbConnection";
export type { ShareLinkFacts } from "./shareLinkUrl";
