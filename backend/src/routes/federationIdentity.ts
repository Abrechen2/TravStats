/**
 * This server's public federation identity (spec 2026-11-07 §6.2). Unauthenticated: a public key
 * is public, and publishing it is what lets another server check that an origin and a key belong
 * together without a file. Bare family. 404 `FEDERATION_OFF` while federation is off.
 */
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { loadIdentity } from "../services/federation/identity";
import { PeerRefusal } from "../services/federation/refusal";
import { rawPublicKey } from "../services/federation/rawKey";
import { SERVED_VERSIONS } from "../schemas/comparison";
import { AppError } from "../middleware/errorHandler";

const router = Router();
router.use(
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  })
);

router.get("/identity", async (_req, res, next) => {
  try {
    const identity = await loadIdentity().catch((error: unknown) => {
      if (error instanceof PeerRefusal)
        throw new AppError("Federation is off", 404, "FEDERATION_OFF");
      throw error;
    });
    const publicKey = rawPublicKey(identity.publicKey);
    if (!publicKey) throw new AppError("Federation is off", 404, "FEDERATION_OFF");
    res.json({
      origin: identity.origin,
      publicKey,
      fingerprint: identity.fingerprint,
      protocolVersions: [...SERVED_VERSIONS],
    });
  } catch (error) {
    next(error);
  }
});

export default router;
