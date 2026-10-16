/**
 * The leaderboard's cookie API (spec 2026-10-16 §9.1). Enveloped family. Browser sessions
 * only: a personal access token is refused, as is everything while the instance beta switch
 * is off. Every refusal carries a COMPARISON_* code and is logged (services/comparison/errors).
 *
 * Every route is throttled per user by the read limiter; the four that create something —
 * asking a person, minting and redeeming an invitation, creating a group — also by the hourly
 * write limiter. No route sets a cache header: the `/api` no-store default stays in charge.
 */
import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { comparisonReadLimiter, comparisonWriteLimiter } from "../middleware/comparisonRateLimit";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { comparisonError } from "../services/comparison/errors";
import { buildLeaderboardSnapshot } from "../services/comparison/aggregates";
import {
  acceptConsent,
  declineConsent,
  endLocal,
  listPeople,
  requestComparison,
  updateScope,
} from "../services/comparison/consents";
import { deleteBoard, listBoards, saveBoard } from "../services/comparison/boards";
import { claimInvite, createInvite, endRemote } from "../services/comparison/remote";
import { readLeaderboard } from "../services/comparison/leaderboard";
import {
  boardBodySchema,
  claimBodySchema,
  consentRequestBodySchema,
  leaderboardQuerySchema,
  leaderboardScopeSchema,
  personKeySchema,
  scopeBodySchema,
  uuidParamSchema,
} from "../schemas/comparison";

const router = Router();
type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle = (fn: Handler) => (req: AuthRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};
const send = (res: Response, data: unknown, status = 200): void => {
  res.status(status).json({ success: true, data });
};

router.use(authenticate, rejectDemo);
router.use((req: AuthRequest, _res, next) => {
  if (req.apiToken) {
    next(
      comparisonError("COMPARISON_TOKEN_REFUSED", 403, "Comparison is a browser feature", {
        userId: req.userId,
      })
    );
    return;
  }
  void getInstanceSettings()
    .then((s) =>
      next(
        s.betaFeaturesEnabled
          ? undefined
          : comparisonError("COMPARISON_DISABLED", 403, "Comparison is off on this server", {
              userId: req.userId,
            })
      )
    )
    .catch(next);
});
router.use(comparisonReadLimiter);

/**
 * No route-level timeout applies here: a remote pull is bounded by REMOTE_PULL_DEADLINE_MS
 * (12 s) inside readLeaderboard, and an unanswered pull becomes that row's "unreachable".
 */
router.get(
  "/leaderboard",
  handle(async (req, res) => {
    const q = leaderboardQuerySchema.parse(req.query);
    send(
      res,
      await readLeaderboard(req.userId!, {
        year: q.year === "all" ? null : q.year,
        boardId: q.board,
      })
    );
  })
);
router.post(
  "/preview",
  handle(async (req, res) => {
    const scope = leaderboardScopeSchema.parse(req.body);
    send(res, await buildLeaderboardSnapshot(req.userId!, scope, scope.year));
  })
);
router.get(
  "/people",
  handle(async (req, res) => {
    const [people, boards] = await Promise.all([listPeople(req.userId!), listBoards(req.userId!)]);
    send(res, { ...people, boards });
  })
);
router.post(
  "/requests",
  comparisonWriteLimiter,
  handle(async (req, res) => {
    const body = consentRequestBodySchema.parse(req.body);
    send(res, await requestComparison(req.userId!, body.username, body.scope), 201);
  })
);
router.post(
  "/consents/:id/accept",
  handle(async (req, res) => {
    const id = uuidParamSchema.parse(req.params.id);
    const { scope } = scopeBodySchema.parse(req.body);
    send(res, await acceptConsent(req.userId!, id, scope));
  })
);
router.post(
  "/consents/:id/decline",
  handle(async (req, res) => {
    send(res, await declineConsent(req.userId!, uuidParamSchema.parse(req.params.id)));
  })
);
router.put(
  "/consents/:id",
  handle(async (req, res) => {
    const id = uuidParamSchema.parse(req.params.id);
    const { scope } = scopeBodySchema.parse(req.body);
    send(res, await updateScope(req.userId!, id, scope));
  })
);
/**
 * Ending works locally whatever the other side does: a remote friend whose server no longer
 * answers is removed here at once, and their server is told best-effort (endRemote).
 */
router.delete(
  "/people/:key",
  handle(async (req, res) => {
    const key = personKeySchema.parse(req.params.key);
    if (key.startsWith("local:")) await endLocal(req.userId!, key.slice("local:".length));
    else await endRemote(req.userId!, key.slice("remote:".length));
    send(res, { ended: true });
  })
);
router.post(
  "/invites",
  comparisonWriteLimiter,
  handle(async (req, res) => {
    send(res, await createInvite(req.userId!), 201);
  })
);
router.post(
  "/invites/claim",
  comparisonWriteLimiter,
  handle(async (req, res) => {
    // The scope is validated here, before claimInvite asks the other server anything.
    const body = claimBodySchema.parse(req.body);
    send(res, await claimInvite(req.userId!, body.code, body.scope), 201);
  })
);
router.post(
  "/boards",
  comparisonWriteLimiter,
  handle(async (req, res) => {
    send(res, await saveBoard(req.userId!, boardBodySchema.parse(req.body)), 201);
  })
);
router.put(
  "/boards/:id",
  handle(async (req, res) => {
    const id = uuidParamSchema.parse(req.params.id);
    send(res, await saveBoard(req.userId!, boardBodySchema.parse(req.body), id));
  })
);
router.delete(
  "/boards/:id",
  handle(async (req, res) => {
    send(res, await deleteBoard(req.userId!, uuidParamSchema.parse(req.params.id)));
  })
);

export default router;
