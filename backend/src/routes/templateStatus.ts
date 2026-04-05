import { Router } from "express";
import type { Response } from "express";
import { templateRegistry } from "../services/parsers/templates/registry";
import { authenticate, AuthRequest } from "../middleware/auth";

const router = Router();

router.get("/", authenticate, (_req: AuthRequest, res: Response): void => {
  res.json({
    templates: templateRegistry.getStatus(),
    total: templateRegistry.getAll().length,
    githubRepo: "https://github.com/Abrechen2/travstats-airline-templates",
  });
});

router.post("/sync", authenticate, (_req: AuthRequest, res: Response): void => {
  void templateRegistry.syncNow().then((count) => {
    res.json({
      templates: templateRegistry.getStatus(),
      total: count,
      githubRepo: "https://github.com/Abrechen2/travstats-airline-templates",
    });
  }).catch((err: unknown) => {
    res.status(500).json({ error: String(err) });
  });
});

export default router;
