/**
 * The bootstrap admission action (spec 2026-11-07 §6.2 step 4): the one route an UNPINNED origin
 * can reach. It accepts a signed `admit` only with a valid invitation token of this server, and
 * only after the sender's identity endpoint vouched for the key that signed it; everything else
 * answers 403 and stores nothing (`services/federation/admissionBootstrap.ts`). Bare family, out
 * of the published spec like the other peer routes. 404 while the beta switch is off.
 */
import { Router } from "express";
import { ZodError } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import logger from "../utils/logger";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { MAX_ADMIT_BODY_BYTES, handleAdmit } from "../services/federation/admissionBootstrap";
import { envelope } from "../services/federation/envelope";
import { PeerRefusal, refused } from "../services/federation/refusal";

const router = Router();
/** 10 asks a minute per address (IPv6 masked to /56): a legitimate sender asks once an hour at most. */
export const admissionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});
router.use(admissionLimiter);
router.post("/", async (req, res) => {
  try {
    if (!(await getInstanceSettings()).betaFeaturesEnabled) throw refused("beta-off");
    // Size first, before a signature is looked at or a server is asked anything.
    const raw: unknown = req.body;
    if (
      !raw ||
      typeof raw !== "object" ||
      !("body" in raw) ||
      typeof raw.body !== "string" ||
      raw.body.length > MAX_ADMIT_BODY_BYTES
    )
      throw refused("packet-too-large");
    const { data, message, local } = await handleAdmit(raw);
    res.setHeader("Cache-Control", "no-store");
    res.json(envelope(data, message.origin, local, message.nonce, "admission/1"));
  } catch (error) {
    // The sender learns nothing; the operator learns why a server is being turned away.
    const kind =
      error instanceof PeerRefusal
        ? error.kind
        : error instanceof ZodError || error instanceof SyntaxError
          ? "malformed"
          : "refused";
    logger.warn(
      {
        operation: "federation_admission_refused",
        kind,
        reason: error instanceof Error ? error.message : String(error),
      },
      "Admission request refused"
    );
    res.status(403).json({ error: "FEDERATION_ADMISSION_REFUSED" });
  }
});
export default router;
