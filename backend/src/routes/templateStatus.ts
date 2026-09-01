import { Router } from "express";
import type { Response } from "express";
import { templateRegistry } from "../services/parsers/templates/registry";
import { authenticate, AuthRequest } from "../middleware/auth";
import { adminReseedLimiter } from "../middleware/rateLimit";

const router = Router();

// GET is a read of the in-memory registry — no I/O at all, so no limiter.
router.get("/", authenticate, (_req: AuthRequest, res: Response): void => {
  res.json({
    templates: templateRegistry.getStatus(),
    total: templateRegistry.getAll().length,
    githubRepo: "https://github.com/Abrechen2/travstats-airline-templates",
  });
});

// POST /sync is the opposite of its neighbour, and the shape is easy to miss
// because the handler body is four lines: it makes ANY authenticated user able
// to trigger a fan-out of HTTP requests to raw.githubusercontent.com (the index
// plus one fetch per outdated airline template) that refreshes INSTANCE-GLOBAL
// state. GitHub rate-limits unauthenticated raw fetches by IP, so an
// unthrottled loop here costs every user of the instance their template
// updates, not just the caller's own.
//
// `adminReseedLimiter` is the right existing bucket despite the name: 3/h for
// a rare operational refresh of catalog data from an external source is
// exactly what it was written for, and it is what the airline-logo re-sync —
// the same action, admin-side — already uses.
router.post("/sync", authenticate, adminReseedLimiter, (_req: AuthRequest, res: Response): void => {
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
