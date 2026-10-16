import { handleSealed } from "../services/federation/e2e/relay";
import { listAtHub, circleInfo, acceptAtHub } from "../services/federation/circles";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { packetBody } from "../services/federation/contract";
import { authenticatePeer, consumeNonce, envelope, refused } from "../services/federation/security";
import logger from "../utils/logger";
import { receiveClaim, receiveState } from "../services/federation/links";

const router = Router();
const MAX_PACKET_BODY = 8_192;
router.use(
  rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false })
);
router.post("/", async (req, res) => {
  try {
    if (!(await getInstanceSettings()).betaFeaturesEnabled) throw refused();
    // Size first: an 8 MB body was signature-checked, parsed and validated before this refused it.
    const raw: unknown = req.body;
    if (
      !raw ||
      typeof raw !== "object" ||
      !("body" in raw) ||
      typeof raw.body !== "string" ||
      raw.body.length > MAX_PACKET_BODY
    )
      throw refused();
    const { message, peer } = await authenticatePeer(raw);
    const body = packetBody.parse(JSON.parse(message.body));
    // A replayed ping is harmless; anything else needs a verified peer BEFORE a nonce row is kept.
    if (body.action !== "ping" && !peer.verifiedAt) throw refused();
    if (peer.verifiedAt) await consumeNonce(message);
    let data: unknown;
    if (body.action === "ping") data = { ready: true };
    else if (body.action === "claim")
      data = await receiveClaim(message.origin, body.code, body.channel);
    else if (body.action === "state")
      data = await receiveState(message.origin, body.channel, body.confirmed, body.revoked);
    else if (body.action === "sealed") {
      const link = await prisma.comparisonLink.findFirst({
        where: { origin: message.origin, channel: body.channel, revoked: false },
      });
      if (!link) throw refused();
      data = await handleSealed(link, body);
    } else if (body.action === "circle") {
      const link = await prisma.comparisonLink.findFirst({
        where: { origin: message.origin, channel: body.channel, revoked: false },
      });
      if (!link) throw refused();
      if (body.operation === "list") data = await listAtHub(link);
      else {
        if (!body.circleId) throw refused();
        if (body.operation === "info") data = await circleInfo(link, body.circleId);
        else {
          if (!body.version) throw refused();
          data = await acceptAtHub(link, body.circleId, body.version, body.operation === "accept");
        }
      }
    } else throw refused(); // Legacy plaintext travel reads are deliberately disabled.
    const signed = envelope(data, message.origin, message.nonce);
    if (Buffer.byteLength(JSON.stringify(signed)) > 10_000_000) throw refused();
    res.setHeader("Cache-Control", "no-store");
    res.json(signed);
  } catch (error) {
    // The peer learns nothing; the operator learns why a federation partner is being turned away.
    logger.warn(
      {
        operation: "comparison_peer_refused",
        reason: error instanceof Error ? error.message : String(error),
      },
      "Comparison peer packet refused"
    );
    res.status(403).json({ error: "COMPARISON_REFUSED" });
  }
});
export default router;
