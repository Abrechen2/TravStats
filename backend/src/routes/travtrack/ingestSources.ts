import { Router, type NextFunction, type Request, type Response } from "express";

import { AppError } from "../../middleware/errorHandler";
import { ingestAccountLimiter, ingestTokenLimiter } from "../../middleware/ingestSourceLimits";
import { ingestTokenAuth, type IngestTokenRequest } from "../../middleware/ingestTokenAuth";
import { LOCATION_MAX_BODY_BYTES, LOCATION_MAX_POINTS } from "../../schemas/travtrack";
import { travTrackAcceptsBefore } from "../../services/locationProvider/provider";
import { ingestPoints, type IngestResult } from "../../services/travtrack/ingest";
import { mapOverland, overlandBodySchema } from "../../services/travtrack/sources/overland";
import { mapOwnTracks } from "../../services/travtrack/sources/owntracks";
import type { IngestTokenKind } from "../../services/travtrack/sources/ingestTokens";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * OwnTracks and Overland into TravTrack (TravTrack plan E9, review focus 25).
 * Authenticated by a per-device ingest token, never by a session or a PAT;
 * each answers in its app's own protocol:
 *
 *   - OwnTracks: `200 []` once authenticated, whatever the body held (the app
 *     resends on an error status, so one bad message must not wedge its
 *     queue); a failure of the server itself is still 5xx.
 *   - Overland: `200 {"result":"ok"}` only after the transaction committed —
 *     the app deletes the batch on that answer alone; anything else is non-2xx
 *     and the phone keeps it.
 *
 * Both go through the one ingest (plan E8): zone → deleted range → duplicate,
 * per point. These apps cannot filter privacy zones on the phone, so a fix in
 * a zone reaches the server and is dropped there.
 *
 * Refused: TravTrack off (403 `TRAVTRACK_DISABLED`, the gate, before the
 * token is even read; nothing stored), and positions recorded after the
 * account's provider left TravTrack (403 `TRAVTRACK_NOT_ACTIVE`, with
 * `stored` and `refused`). A batch mixing both stores its earlier points and
 * still answers 403, for both apps alike: OwnTracks and Overland then keep
 * the batch and resend it, the stored part is found as duplicates, and no
 * answer claims success for a point that was not stored. The batch clears
 * once the owner chooses TravTrack again or revokes the token. Points the
 * mapper cannot read are different: they can never succeed, so they are
 * counted and answered as accepted.
 */

const router = Router();

function route(fn: (req: IngestTokenRequest, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req as IngestTokenRequest, res).catch(next);
  };
}

function capBody(req: Request, _res: Response, next: NextFunction): void {
  // The header first (cheap), then the parsed body itself: a chunked request
  // carries no Content-Length.
  if (
    Number(req.get("content-length") ?? 0) > LOCATION_MAX_BODY_BYTES ||
    Buffer.byteLength(JSON.stringify(req.body ?? null)) > LOCATION_MAX_BODY_BYTES
  ) {
    return next(new AppError("The upload is too large", 413, "TRACK_BODY_TOO_LARGE"));
  }
  next();
}

const ingestChain = (kind: IngestTokenKind) => [
  travTrackTier("on"),
  ingestTokenAuth(kind),
  ingestTokenLimiter,
  ingestAccountLimiter,
  capBody,
];

/**
 * The points that are still TravTrack's (coordinator ruling after the Codex
 * review of E9): while the account's provider is `travtrack`, all; after it
 * left, those recorded before the moment it left — the positions a phone
 * queued while TravTrack was the provider, the same idea as the Companion's
 * queued points — and none recorded after. With Dawarich chosen no new
 * everyday point is stored.
 */
async function splitByProvider(userId: string, points: readonly Record<string, unknown>[]) {
  const before = await travTrackAcceptsBefore(userId);
  const accepted = points.filter((p) => Date.parse(String(p.t)) < before);
  return { accepted, refused: points.length - accepted.length };
}

/**
 * Some points were recorded after the provider left TravTrack: refused, so
 * the app keeps its queue. What was acceptable is stored first, and a resend
 * finds it as duplicates — never `[]` or `result: ok` for a point not stored.
 */
function refuseLate(stored: number, refused: number): AppError {
  return new AppError(
    "This account's location provider is not TravTrack for these positions",
    403,
    "TRAVTRACK_NOT_ACTIVE",
    undefined,
    { stored, refused }
  );
}

type Totals = Pick<IngestResult, "stored" | "duplicate" | "dropped">;

/** Every point through the one ingest, in batches of one transaction each. */
async function ingestAll(
  req: IngestTokenRequest,
  points: readonly Record<string, unknown>[]
): Promise<Totals> {
  const { tokenId, userId, kind } = req.ingestToken!;
  const origin = `${kind}:${tokenId}`;
  const totals: Totals = { stored: 0, duplicate: 0, dropped: 0 };
  for (let at = 0; at < points.length; at += LOCATION_MAX_POINTS) {
    const { result } = await ingestPoints({
      userId,
      origin,
      deviceId: origin,
      uploadId: null,
      points: points.slice(at, at + LOCATION_MAX_POINTS),
    });
    totals.stored += result.stored;
    totals.duplicate += result.duplicate;
    totals.dropped += result.dropped;
  }
  return totals;
}

/** POST /travtrack/ingest/owntracks — HTTP Basic, password = token. Always `[]`. */
router.post(
  "/travtrack/ingest/owntracks",
  ...ingestChain("owntracks"),
  route(async (req, res) => {
    const mapped = mapOwnTracks(req.body);
    const { accepted, refused } = await splitByProvider(req.userId!, mapped.points);
    const totals = accepted.length > 0 ? await ingestAll(req, accepted) : null;
    logger.info({
      operation: "travtrack.owntracks.ingest",
      tokenId: req.ingestToken!.tokenId,
      messages: mapped.messages,
      ignored: mapped.ignored,
      invalid: mapped.invalid,
      refused,
      ...totals,
    });
    if (refused > 0) throw refuseLate(totals?.stored ?? 0, refused);
    // OwnTracks reads the answer as the friends' positions: none.
    res.status(200).json([]);
  })
);

/** POST /travtrack/ingest/overland — Bearer header. `result: ok` only after the commit. */
router.post(
  "/travtrack/ingest/overland",
  ...ingestChain("overland"),
  route(async (req, res) => {
    const body = overlandBodySchema.parse(req.body);
    const mapped = mapOverland(body);
    const { accepted, refused } = await splitByProvider(req.userId!, mapped.points);
    const totals = accepted.length > 0 ? await ingestAll(req, accepted) : null;
    logger.info({
      operation: "travtrack.overland.ingest",
      tokenId: req.ingestToken!.tokenId,
      features: body.locations.length,
      invalid: mapped.invalid,
      refused,
      ...totals,
    });
    if (refused > 0) throw refuseLate(totals?.stored ?? 0, refused);
    res.status(200).json({ result: "ok" });
  })
);

export default router;
