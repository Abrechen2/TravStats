import { Router, type NextFunction, type Request, type Response } from "express";

import { AppError } from "../../middleware/errorHandler";
import { ingestAccountLimiter, ingestTokenLimiter } from "../../middleware/ingestSourceLimits";
import { ingestTokenAuth, type IngestTokenRequest } from "../../middleware/ingestTokenAuth";
import { LOCATION_MAX_BODY_BYTES, LOCATION_MAX_POINTS } from "../../schemas/travtrack";
import { providerIs } from "../../services/locationProvider/provider";
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
 * Refused without storing anything: TravTrack off (403 `TRAVTRACK_DISABLED`,
 * the gate, before the token is even read) and an account whose location
 * provider is not a working TravTrack (403 `TRAVTRACK_NOT_ACTIVE`): a
 * third-party app keeps posting after the owner chose another provider, and
 * its positions then belong nowhere here.
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

async function assertTravTrackProvider(userId: string): Promise<void> {
  if (!(await providerIs(userId, "travtrack"))) {
    throw new AppError(
      "This account's location provider is not TravTrack",
      403,
      "TRAVTRACK_NOT_ACTIVE"
    );
  }
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
    await assertTravTrackProvider(req.userId!);
    const mapped = mapOwnTracks(req.body);
    const totals = mapped.points.length > 0 ? await ingestAll(req, mapped.points) : null;
    logger.info({
      operation: "travtrack.owntracks.ingest",
      tokenId: req.ingestToken!.tokenId,
      messages: mapped.messages,
      ignored: mapped.ignored,
      invalid: mapped.invalid,
      ...totals,
    });
    // OwnTracks reads the answer as the friends' positions: none.
    res.status(200).json([]);
  })
);

/** POST /travtrack/ingest/overland — Bearer header. `result: ok` only after the commit. */
router.post(
  "/travtrack/ingest/overland",
  ...ingestChain("overland"),
  route(async (req, res) => {
    await assertTravTrackProvider(req.userId!);
    const body = overlandBodySchema.parse(req.body);
    const mapped = mapOverland(body);
    const totals = mapped.points.length > 0 ? await ingestAll(req, mapped.points) : null;
    logger.info({
      operation: "travtrack.overland.ingest",
      tokenId: req.ingestToken!.tokenId,
      features: body.locations.length,
      invalid: mapped.invalid,
      ...totals,
    });
    res.status(200).json({ result: "ok" });
  })
);

export default router;
