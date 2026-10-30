/**
 * The policy on the legacy per-service WRITE routes (forgejo#392). The new
 * façade enforces it by construction; the old Immich/Dawarich/WebDAV/API-key
 * routes predate it and would otherwise let an account store a credential for
 * a service the admin switched off or forbade — a stored key the resolver then
 * ignores, but which the page shows as saved. Clearing a credential is always
 * allowed: a forbidden connection must be removable.
 */
import type { NextFunction, RequestHandler, Response } from "express";
import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { connectionGate, loadPolicy, loadPrefs } from "./policy";

/** Every value empties something: null, "" or false. */
export function isClearingBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return true;
  return Object.values(body as Record<string, unknown>).every(
    (v) => v === null || v === "" || v === false || v === undefined
  );
}

export async function assertAccountMayConnect(userId: string, id: string): Promise<void> {
  const gate = await connectionGate(id, userId);
  if (gate.off === "admin") {
    throw new AppError(
      "This service is switched off by the administrator",
      409,
      "SERVICE_DISABLED"
    );
  }
  if (!gate.accountMayConnect) {
    throw new AppError(
      "The administrator does not allow this connection",
      403,
      "CONNECTION_NOT_ALLOWED"
    );
  }
}

/** Express guard for the PUT of a legacy connection route. */
export function guardConnectionWrite(id: string): RequestHandler {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (req.method !== "PUT" || isClearingBody(req.body)) return next();
    assertAccountMayConnect(req.userId!, id).then(() => next(), next);
  };
}

/** Body field → service id, for the legacy `PUT /settings/api-keys`. */
const KEY_FIELD_SERVICE: Record<string, string> = {
  airlabsApiKey: "airlabs",
  aviationstackApiKey: "aviationstack",
  aerodataboxApiKey: "aerodatabox",
  openskyClientId: "opensky",
  openskyClientSecret: "opensky",
  openskyUsername: "opensky",
  openskyPassword: "opensky",
  openrouteserviceApiKey: "openrouteservice",
  graphhopperApiKey: "graphhopper",
};

/** Express guard: an account may not store a key for a forbidden or switched-off service. */
export const guardAccountKeyWrite: RequestHandler = (req: AuthRequest, _res, next): void => {
  if (req.method !== "PUT") return next();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const touched = new Set<string>();
  for (const [field, id] of Object.entries(KEY_FIELD_SERVICE)) {
    const v = body[field];
    if (typeof v === "string" && v !== "") touched.add(id);
  }
  if (touched.size === 0) return next();
  (async () => {
    const policy = await loadPolicy();
    const prefs = await loadPrefs(req.userId!);
    for (const id of touched) {
      if (policy.disabled.includes(id) || prefs.disabled.includes(id)) {
        throw new AppError("This service is switched off", 409, "SERVICE_DISABLED");
      }
      if (policy.accountKeysForbidden.includes(id)) {
        throw new AppError(
          "The administrator does not allow your own key for this service",
          403,
          "ACCOUNT_KEYS_NOT_ALLOWED"
        );
      }
    }
  })().then(() => next(), next);
};
