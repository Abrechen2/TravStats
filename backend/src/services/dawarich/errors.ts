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

/** Which settings tier supplied the connection. */
export type DawarichConnectionSource = "user" | "global" | "env";

export interface DawarichConnection {
  /** Normalised, no trailing slash, no credentials. */
  baseUrl: string;
  /** Decrypted. Never leaves the backend. */
  apiKey: string;
  source: DawarichConnectionSource;
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

  constructor(kind: DawarichErrorKind, message: string, status?: number) {
    super(message);
    this.name = "DawarichError";
    this.kind = kind;
    this.status = status;
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
 * DELIBERATE NON-RESTRICTION (SSRF egress): there is intentionally NO block
 * on loopback / link-local / private / ULA hosts here. TravStats is
 * self-hosted and the operator's Dawarich instance is on the LAN (often a
 * private RFC1918 or `.local` address) by design, so a private-IP filter
 * would break the primary use case. The base URL is operator-supplied
 * (per-user or admin-global), not attacker-chosen in the single-tenant
 * deployment this targets. An operator who exposes Dawarich *configuration*
 * to untrusted users on a multi-tenant instance MUST restrict egress at the
 * network layer — the request would otherwise be a blind-SSRF /
 * internal-reconnaissance oracle via the error taxonomy. Mirrors
 * `normalizeImmichBaseUrl`'s decision (reviewed 2026-07-10) exactly; do not
 * "harden" this without changing the threat model.
 */
export function normalizeDawarichBaseUrl(raw: string): string {
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
  return `${parsed.protocol}//${parsed.host}${path}`;
}
