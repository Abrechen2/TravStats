/**
 * The fixed error vocabulary of the Strava integration — the same kinds the
 * Immich and Dawarich integrations use, so the frontend can map each to one
 * sentence instead of parsing prose.
 *
 * - `notConfigured` — the operator has not registered a Strava application,
 *   or this user has not connected their account.
 * - `unreachable`   — Strava did not answer (network, timeout, 5xx).
 * - `auth`          — Strava refused the token or the client credentials;
 *   the user must connect again.
 * - `notFound`      — the activity does not exist or is not the user's.
 * - `protocol`      — Strava answered with something we cannot read, or the
 *   activity has no GPS route to import (an indoor workout).
 * - `rateLimited`   — Strava's 15-minute / daily request budget is spent.
 */
export type StravaErrorKind =
  "notConfigured" | "unreachable" | "auth" | "notFound" | "protocol" | "rateLimited";

export class StravaError extends Error {
  public readonly kind: StravaErrorKind;
  public readonly status?: number;

  constructor(kind: StravaErrorKind, message: string, status?: number) {
    super(message);
    this.name = "StravaError";
    this.kind = kind;
    this.status = status;
  }
}

/** HTTP status the API answers with for each kind. */
export function stravaErrorStatus(kind: StravaErrorKind): number {
  switch (kind) {
    case "notConfigured":
      return 409;
    case "auth":
      return 401;
    case "notFound":
      return 404;
    case "rateLimited":
      return 429;
    case "unreachable":
    case "protocol":
      return 502;
  }
}
