import { Router } from "express";
import type { NextFunction, Response } from "express";
import { templateRegistry } from "../services/parsers/templates/registry";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { adminReseedLimiter } from "../middleware/rateLimit";
import { prisma } from "../db";
import type { V2Status } from "../services/parsers/templates/v2/status";

const router = Router();

const GITHUB_REPO = "https://github.com/Abrechen2/travstats-templates";

/**
 * The v1 fields keep their meaning (airline templates only); `v2` is added
 * beside them so an existing client reads exactly what it read before.
 */
/**
 * A v2 rejection `detail` is raw operator diagnostics — a fetch error that can
 * name the template source (`TEMPLATE_REPO_BASE_URL`, possibly an internal
 * mirror with credentials in it), validator output, the running version. The
 * status read is open to every signed-in user, so only an admin sees it; the
 * rest get the reason, which is all a user needs to know.
 */
function v2ForAudience(v2: V2Status, isAdmin: boolean): V2Status {
  if (isAdmin) return v2;
  return { ...v2, templates: v2.templates.map(({ detail: _detail, ...entry }) => entry) };
}

async function isAdminRequest(req: AuthRequest): Promise<boolean> {
  if (!req.userId) return false;
  if (req.apiToken && req.apiToken.scope !== "admin") return false;
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { isAdmin: true },
  });
  return user?.isAdmin === true;
}

function statusBody(total: number, isAdmin: boolean) {
  return {
    templates: templateRegistry.getStatus(),
    total,
    githubRepo: GITHUB_REPO,
    v2: v2ForAudience(templateRegistry.getV2Status(), isAdmin),
  };
}

// GET is a read of the in-memory registry — no I/O at all, so no limiter, and
// every signed-in user may look: the list explains which airlines the mail
// parser understands, which is a user question, not an admin one.
router.get("/", authenticate, (req: AuthRequest, res: Response, next: NextFunction): void => {
  isAdminRequest(req)
    .then((isAdmin) => res.json(statusBody(templateRegistry.getAll().length, isAdmin)))
    .catch(next);
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
        res.json(statusBody(count, true));
      })
      .catch((err: unknown) => {
        res.status(500).json({ error: String(err) });
      });
  }
);

export default router;
