import { handleSealed } from "../services/federation/e2e/relay";
import { listAtHub, circleInfo, acceptAtHub } from "../services/federation/circles";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { packetBody } from "../services/federation/contract";
import { authenticatePeer, envelope, refused } from "../services/federation/security";
import { receiveClaim, receiveState } from "../services/federation/links";

const router = Router();
router.use(
  rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false })
);
router.post("/", async (req, res) => {
  try {
    if (!(await getInstanceSettings()).betaFeaturesEnabled) throw refused();
    const message = await authenticatePeer(req.body);
    const body = packetBody.parse(JSON.parse(message.body));
    if (message.body.length > 8_192) throw refused();
    if (
      body.action !== "ping" &&
      !(await prisma.comparisonPeer.findUnique({ where: { origin: message.origin } }))?.verifiedAt
    )
      throw refused();
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
  } catch {
    res.status(403).json({ error: "COMPARISON_REFUSED" });
  }
});
export default router;
