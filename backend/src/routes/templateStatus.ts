import { Router } from "express";
import type { Response } from "express";
import { templateRegistry } from "../services/parsers/templates/registry";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { adminReseedLimiter } from "../middleware/rateLimit";

const router = Router();

// GET is a read of the in-memory registry — no I/O at all, so no limiter, and
// every signed-in user may look: the list explains which airlines the mail
// parser understands, which is a user question, not an admin one.
router.get("/", authenticate, (_req: AuthRequest, res: Response): void => {
  res.json({
    templates: templateRegistry.getStatus(),
    total: templateRegistry.getAll().length,
    githubRepo: "https://github.com/Abrechen2/travstats-airline-templates",
  });
});

// POST /sync changes INSTANCE-GLOBAL state: it fans out HTTP requests to
// raw.githubusercontent.com (the index plus one fetch per outdated template)
// and replaces the registry every user parses with. That is an operator
// action, so it takes `requireAdmin` — exactly like the airline-logo re-sync
// under /admin, which is the same kind of refresh. Until 2026-09-04 the only
// guard was the limiter below, which meant ANY signed-in account could spend
// the instance's three refreshes per hour (forgejo#67).
//
// `adminReseedLimiter` stays on top of the admin check: GitHub rate-limits
// unauthenticated raw fetches by IP, and an admin hammering the button would
// cost every user of the instance their template updates, not just their own.
router.post(
  "/sync",
  authenticate,
  requireAdmin,
  adminReseedLimiter,
  (_req: AuthRequest, res: Response): void => {
    void templateRegistry
      .syncNow()
      .then((count) => {
        res.json({
          templates: templateRegistry.getStatus(),
          total: count,
          githubRepo: "https://github.com/Abrechen2/travstats-airline-templates",
        });
      })
      .catch((err: unknown) => {
        res.status(500).json({ error: String(err) });
      });
  },
);

export default router;
