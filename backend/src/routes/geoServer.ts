import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ownGeoUrl } from "../services/geo/ownServerConfig";
import { OwnGeoUnavailable, ownGeoRequest } from "../services/geo/ownServerTransport";
import { allowedMapAsset, rewriteMapDocument } from "../services/geo/ownMapAssets";

const router = Router();

// Non-sensitive instance mode, loaded before any frontend module. No internal URL.
router.get("/runtime", (_req, res) => {
  res.set("Cache-Control", "no-store").type("application/javascript");
  try {
    res.send(`window.__TRAVSTATS_GEO__=Object.freeze({mode:${JSON.stringify(ownGeoUrl() ? "own" : "legacy")}});`);
  } catch {
    res.status(503).send("/* Geo configuration unavailable; bootstrap remains pending. */");
  }
});

// Public base-map bytes only: no routes, positions, users, cookies or secrets.
router.get("/assets/*", rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
  const path = "/" + req.params[0];
  if (Object.keys(req.query).length || !allowedMapAsset(path)) { res.sendStatus(404); return; }
  try {
    const result = await ownGeoRequest(path);
    if (result.status !== 200) { res.status(result.status).end(); return; }
    res.set("Cache-Control", "private, no-store").set("X-Content-Type-Options", "nosniff");
    if (result.contentType === "application/json") {
      res.json(rewriteMapDocument(path, JSON.parse(result.body.toString("utf8")), `${req.protocol}://${req.get("host")}`));
    } else if (["application/x-protobuf", "application/vnd.mapbox-vector-tile", "application/octet-stream", "image/png"].includes(result.contentType)) {
      res.type(result.contentType).send(result.body);
    } else {
      res.status(502).json({ error: "geo_invalid_response" });
    }
  } catch (error) {
    res.status(error instanceof OwnGeoUnavailable && error.code === "disabled" ? 404 : 503)
      .set("Cache-Control", "no-store").json({ error: "geo_unavailable" });
  }
});

export default router;
