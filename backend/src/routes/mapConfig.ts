import { Router } from "express";
import { getMapConfig } from "../services/mapConfig";

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
export default router;
