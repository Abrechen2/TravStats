import { Router } from "express";
import type { Response } from "express";
import { templateRegistry } from "../services/parsers/templates/registry";
import { authenticate, AuthRequest } from "../middleware/auth";

const router = Router();

router.get("/", authenticate, (_req: AuthRequest, res: Response): void => {
  res.json({
    templates: templateRegistry.getStatus(),
    total: templateRegistry.getAll().length,
    githubRepo: "https://github.com/travstats-community/airline-templates",
  });
});

export default router;
