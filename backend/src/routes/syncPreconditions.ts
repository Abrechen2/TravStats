import { Router, type NextFunction, type Request, type Response } from "express";

import { authenticate, requireWriteScope } from "../middleware/auth";
import { SYNC_GUARDED_ROUTES } from "../services/sync/guardedRoutes";
import { requireCurrentVersion } from "../services/sync/versionPrecondition";

/**
 * Version preconditions on the edits and deletes the Companion makes
 * (forgejo#141) — one router in front of the domain routers instead of a line
 * in each of them: `routes/flights.ts` is frozen at its size by the file-size
 * ratchet and cannot take another import, and one table is easier to hold
 * against the sync entity list than eleven scattered call sites.
 *
 * Mounted in `mounts.ts` BEFORE every router it covers. A request that names
 * no base version (no `If-Match`, no `baseVersion`) leaves at the first step
 * with `next("route")` — no authentication, no query — and reaches its router
 * exactly as before. One that names one is authenticated, write-scope checked
 * and claimed here; the domain router then authenticates again and writes.
 *
 * It answers nothing but errors (400, 401, 403, 409), in the error handler's
 * `{ error, code }` shape that both response families share.
 */
const router = Router();

function namesBaseVersion(req: Request): boolean {
  const body = req.body as Record<string, unknown> | undefined;
  return (
    req.get("if-match") !== undefined ||
    (body !== undefined && typeof body === "object" && body !== null && "baseVersion" in body)
  );
}

const onlyWithBaseVersion = (req: Request, _res: Response, next: NextFunction): void => {
  next(namesBaseVersion(req) ? undefined : "route");
};

for (const { entity, idParam, paths, edit } of SYNC_GUARDED_ROUTES) {
  const chain = [
    onlyWithBaseVersion,
    authenticate,
    requireWriteScope,
    requireCurrentVersion(entity, idParam),
  ];
  // Express wants a mutable array; the shared list stays read-only.
  router[edit]([...paths], ...chain);
  router.delete([...paths], ...chain);
}

export default router;
