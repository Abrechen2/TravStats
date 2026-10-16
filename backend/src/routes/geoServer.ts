import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ownGeoUrl } from "../services/geo/ownServerConfig";
import { OwnGeoUnavailable, ownGeoRequest } from "../services/geo/ownServerTransport";
import { allowedMapAsset, rewriteMapDocument } from "../services/geo/ownMapAssets";
import logger from "../utils/logger";

const router = Router();

// Non-sensitive instance mode, loaded before any frontend module. No internal URL.
router.get("/runtime", (_req, res) => {
  res.set("Cache-Control", "no-store").type("application/javascript");
  try {
    res.send(
      `window.__TRAVSTATS_GEO__=Object.freeze({mode:${JSON.stringify(ownGeoUrl() ? "own" : "legacy")}});`
    );
  } catch {
    res.status(503).send("/* Geo configuration unavailable; bootstrap remains pending. */");
  }
});

// Public base-map bytes only: no routes, positions, users, cookies or secrets.
router.get(
  "/assets/*",
  rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    const path = "/" + req.params[0];
    if (Object.keys(req.query).length || !allowedMapAsset(path)) {
      res.sendStatus(404);
      return;
    }
    // The asset kind only: a tile path is a position someone is looking at.
    const asset = path.split("/")[1];
    const fail = (status: number, reason: string, detail?: string) => {
      logger.warn(
        { operation: "geo_server_asset_failed", asset, reason, detail, status },
        "Own map server asset could not be served"
      );
      res.status(status).set("Cache-Control", "no-store");
    };
    let result: Awaited<ReturnType<typeof ownGeoRequest>>;
    try {
      result = await ownGeoRequest(path);
    } catch (error) {
      if (error instanceof OwnGeoUnavailable && error.code === "disabled") {
        res.status(404).set("Cache-Control", "no-store").json({ error: "geo_unavailable" });
        return;
      }
      const reason = error instanceof OwnGeoUnavailable ? error.code : "unexpected";
      const detail =
        error instanceof OwnGeoUnavailable
          ? error.detail
          : error instanceof Error
            ? error.message
            : String(error);
      fail(503, reason, detail);
      if (reason === "busy") res.set("Retry-After", "1");
      res.json({ error: "geo_unavailable" });
      return;
    }
    if (result.status !== 200) {
      res.status(result.status).end();
      return;
    }
    res.set("Cache-Control", "private, no-store").set("X-Content-Type-Options", "nosniff");
    if (result.contentType === "application/json") {
      let document: unknown;
      try {
        document = rewriteMapDocument(
          path,
          JSON.parse(result.body.toString("utf8")),
          `${req.protocol}://${req.get("host")}`
        );
      } catch (error) {
        fail(502, "parse", error instanceof Error ? error.message : String(error));
        res.json({ error: "geo_invalid_response" });
        return;
      }
      res.json(document);
    } else if (
      [
        "application/x-protobuf",
        "application/vnd.mapbox-vector-tile",
        "application/octet-stream",
        "image/png",
      ].includes(result.contentType)
    ) {
      res.type(result.contentType).send(result.body);
    } else {
      fail(502, "content_type", result.contentType);
      res.json({ error: "geo_invalid_response" });
    }
  }
);

export default router;
