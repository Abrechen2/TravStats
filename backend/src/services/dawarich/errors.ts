/**
 * Shared vocabulary for the Dawarich integration.
 *
 * Dawarich is a self-hosted location-history server. TravStats only PULLS
 * from it — no endpoint, helper or type anywhere in `services/dawarich`
 * ever writes back.
 *
 * Deliberately mirrors `services/immich/types.ts`: same connection shape,
 * same error taxonomy, same egress decision on the base-url normaliser
 * below. Read that file's comments if this one feels thin — the reasoning
 * carries over verbatim.
 */

import {
  PrivateTargetError,
  assertTargetAllowed,
  type PrivateTargetCode,
  type TargetPolicy,
} from "../egress/privateTargets";

/** Which settings tier supplied the connection. */
export type DawarichConnectionSource = "user" | "global";

export interface DawarichConnection {
  /** Normalised, no trailing slash, no credentials. */
  baseUrl: string;
  /** Decrypted. Never leaves the backend. */
  apiKey: string;
  source: DawarichConnectionSource;
  /**
   * May this connection reach a private, loopback or link-local address?
   * Same meaning as `ImmichConnection.allowPrivate` (forgejo#411).
   */
  allowPrivate: boolean;
}

/**
 * Why a Dawarich call failed. Identical vocabulary to Immich's
 * `ImmichErrorKind` on purpose — the frontend's failure-kind parser and the
 * route layer both already understand this shape, and a second vocabulary
 * for the same idea would just be a second thing to keep in sync.
 *
 * `notConfigured` is NOT a member here — like Immich, that case is decided
 * at the route layer (no connection resolved for this request at all), not
 * by the client, which only ever sees a fully-formed connection.
 *
 * `invalidUrl` is the user's own typo (a malformed / non-http base URL,
 * caught before any request leaves the process); `protocol` means Dawarich
 * actually answered but the payload/version was not what we expect.
 * Conflating the two sends someone debugging their server version when they
 * really just fat-fingered a hostname.
 */
export type DawarichErrorKind = "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl";

export class DawarichError extends Error {
  public readonly kind: DawarichErrorKind;
  public readonly status?: number;
  /** Set on an `invalidUrl` refusal of a target this caller may not reach. */
  public readonly code?: PrivateTargetCode;

  constructor(kind: DawarichErrorKind, message: string, status?: number, code?: PrivateTargetCode) {
    super(message);
    this.name = "DawarichError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/**
 * Validate and canonicalise a user-supplied Dawarich base URL.
 *
 * This is a security boundary, not cosmetics: the client builds every
 * upstream request from this value, so it must be a plain http(s) origin
 * with no credentials, query or fragment. A sub-path is allowed
 * (reverse-proxy installs mount Dawarich under e.g. `/dawarich`).
 *
 * Egress (forgejo#411): the same rule as `normalizeImmichBaseUrl` — an
 * ordinary account's own connection may not name a private, loopback or
 * link-local host (`invalidUrl` + `PRIVATE_TARGET`); the admin-global tier,
 * ENV and an admin's own connection keep LAN access. A public-looking name is
 * checked again at connection time (`services/egress/privateTargets.ts`).
 */
export function normalizeDawarichBaseUrl(raw: string, policy: TargetPolicy): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new DawarichError("invalidUrl", "Dawarich URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DawarichError("invalidUrl", "Dawarich URL must use http:// or https://");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  const normalized = `${parsed.protocol}//${parsed.host}${path}`;
  try {
    assertTargetAllowed(normalized, policy);
  } catch (error) {
    if (error instanceof PrivateTargetError) throw privateTargetDawarichError();
    throw error;
  }
  return normalized;
}

/** The refusal of a host this caller may not reach, in Dawarich's vocabulary. */
export function privateTargetDawarichError(): DawarichError {
  return new DawarichError(
    "invalidUrl",
    "Dawarich URL points to a private address this account may not reach",
    undefined,
    "PRIVATE_TARGET"
  );
}
