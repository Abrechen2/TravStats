import type { ApiToken } from "./api/tokens";
import { now } from "../shared/time/clock";

/** Revoked, or past its expiry: the only tokens the server lets the user remove for good. */
export function isOldToken(tok: ApiToken, at: Date = now()): boolean {
  return !!tok.revokedAt || (!!tok.expiresAt && new Date(tok.expiresAt) <= at);
}
