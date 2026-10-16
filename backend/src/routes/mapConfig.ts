import { Router } from "express";
import { getMapConfig } from "../services/mapConfig";
import { registry } from "../services/openapi/registry";

const router = Router();
router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store").json(getMapConfig());
});
router.get("/runtime", (_req, res) => {
  const config = JSON.stringify(getMapConfig()).replace(/</g, "\\u003c");
  res
    .set("Cache-Control", "no-store")
    .type("application/javascript")
    .send(`window.__TRAVSTATS_MAP_CONFIG__=${config};`);
});
for (const path of ["/map-config", "/map-config/runtime"]) {
  registry.registerPath({
    method: "get",
    path,
    security: [],
    tags: ["Maps"],
    summary: path.endsWith("/runtime")
      ? "Browser map configuration bootstrap"
      : "Public map style configuration",
    responses: {
      200: {
        description:
          "Version 1 public style URLs; no credentials or user data. JSON at /map-config, JavaScript at /map-config/runtime.",
      },
    },
  });
}
export default router;
