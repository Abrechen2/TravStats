import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { ingestTokenCreateLimiter } from "../../middleware/ingestSourceLimits";
import { z } from "../../schemas/zod";
import { getPublicBaseUrl } from "../../services/instanceSettingsService";
import { providerIs } from "../../services/locationProvider/provider";
import {
  INGEST_TOKEN_KINDS,
  createIngestToken,
  listIngestTokens,
  revokeIngestToken,
  type IngestTokenListing,
} from "../../services/travtrack/sources/ingestTokens";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * The owner's ingest tokens for OwnTracks and Overland (TravTrack plan E9).
 * Bare responses (ADR 0001). A new token is in the create answer once and
 * never again; the list carries no secret and no digest.
 *
 * Tiers: creating is new capture (`on`) and needs TravTrack as the account's
 * provider; the list and a revoke are `held`, so a token can be revoked while
 * TravTrack is off.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

const createSchema = z
  .object({
    kind: z.enum(INGEST_TOKEN_KINDS),
    label: z.string().trim().min(1).max(60),
  })
  .strict();

const listing = (t: IngestTokenListing) => ({
  id: t.id,
  kind: t.kind,
  label: t.label,
  createdAt: t.createdAt.toISOString(),
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
});

/** POST /travtrack/ingest-tokens — `{ kind, label }` → 201 with the token, once. */
router.post(
  "/travtrack/ingest-tokens",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  ingestTokenCreateLimiter,
  route(async (req, res) => {
    const input = createSchema.parse(req.body);
    const userId = req.userId!;
    if (!(await providerIs(userId, "travtrack"))) {
      throw new AppError(
        "Further sources need TravTrack as the location provider",
        409,
        "TRAVTRACK_NOT_ACTIVE"
      );
    }
    const created = await createIngestToken(userId, input);
    const url = `${await getPublicBaseUrl(req)}/api/v1/travtrack/ingest/${created.kind}`;
    logger.info({
      operation: "travtrack.ingestToken.create",
      tokenId: created.id,
      kind: created.kind,
    });
    res.status(201).json({ ...listing(created), token: created.token, url });
  })
);

/** GET /travtrack/ingest-tokens — the account's live tokens, without secrets. */
router.get(
  "/travtrack/ingest-tokens",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    res.json({ tokens: (await listIngestTokens(req.userId!)).map(listing) });
  })
);

/** DELETE /travtrack/ingest-tokens/:id — revoked at once; its points stay. */
router.delete(
  "/travtrack/ingest-tokens/:id",
  authenticate,
  travTrackTier("held"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const id = String(req.params.id);
    await revokeIngestToken(req.userId!, id);
    logger.info({ operation: "travtrack.ingestToken.revoke", tokenId: id });
    res.json({ revoked: true });
  })
);

export default router;
