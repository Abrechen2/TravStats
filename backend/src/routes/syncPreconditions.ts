import { Router, type NextFunction, type Request, type Response } from "express";

import { authenticate, requireWriteScope } from "../middleware/auth";
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

/** [entity, id parameter, paths] — every PATCH/PUT and DELETE below gets the check. */
const GUARDED: ReadonlyArray<{
  entity: string;
  idParam: string;
  paths: string[];
  edit: "put" | "patch";
}> = [
  { entity: "flight", idParam: "id", paths: ["/flights/:id"], edit: "put" },
  { entity: "rail_journey", idParam: "id", paths: ["/rail/:id"], edit: "patch" },
  { entity: "cruise", idParam: "id", paths: ["/cruises/:id"], edit: "patch" },
  { entity: "lodging", idParam: "id", paths: ["/lodging/:id"], edit: "patch" },
  {
    entity: "lodging_stay",
    idParam: "stayId",
    paths: ["/lodging/:id/stays/:stayId"],
    edit: "patch",
  },
  { entity: "trip", idParam: "id", paths: ["/trips/:id"], edit: "patch" },
  { entity: "trip_stop", idParam: "stopId", paths: ["/trips/:id/stops/:stopId"], edit: "patch" },
  {
    entity: "trip_journal_entry",
    idParam: "entryId",
    paths: ["/trips/:id/journal/:entryId"],
    edit: "patch",
  },
  { entity: "place", idParam: "id", paths: ["/places/:id"], edit: "patch" },
  { entity: "place_visit", idParam: "visitId", paths: ["/places/visits/:visitId"], edit: "patch" },
  {
    entity: "trip_route",
    idParam: "routeId",
    paths: ["/trips/:id/routes/:routeId", "/tours/:routeId"],
    edit: "patch",
  },
];

for (const { entity, idParam, paths, edit } of GUARDED) {
  const chain = [
    onlyWithBaseVersion,
    authenticate,
    requireWriteScope,
    requireCurrentVersion(entity, idParam),
  ];
  router[edit](paths, ...chain);
  router.delete(paths, ...chain);
}

export const SYNC_GUARDED_ROUTES = GUARDED;
export default router;
