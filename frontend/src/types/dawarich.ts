/**
 * Per-user Dawarich connection (phase 3b). Mirrors `types/immich.ts`
 * closely on purpose — the backend's own doc comment on
 * `backend/src/routes/settings/dawarich.ts` says the route "Mirrors
 * settings/immich.ts minus the link/import mode toggle": Dawarich is
 * pull-only location history, not albums, so there is no mode to choose.
 */

/** Which settings tier supplied the connection. */
export type DawarichConnectionSource = "user" | "global" | "env";

export interface DawarichConnectionStatus {
  baseUrl: string | null;
  hasKey: boolean;
  source: DawarichConnectionSource | null;
  isShared: boolean;
  hasAccess: boolean;
}

export interface DawarichTestResult {
  success: boolean;
  /** English, for debugging only — the UI renders `errors.<kind>` instead. */
  message: string;
  /** Machine-readable failure classification, present only on failure. */
  kind?: DawarichFailureKind;
  details?: { version?: string };
}

/**
 * Why a Dawarich-backed request failed. `notConfigured` comes back as a
 * 400/409 from our own API when no connection resolves at all; the rest are
 * upstream kinds `DawarichError` on the backend already classifies (see
 * `backend/src/services/dawarich/errors.ts`). Identical vocabulary to
 * `ImmichFailureKind` by design — same taxonomy, same reason (`invalidUrl`
 * is the user's own typo, `protocol` means Dawarich answered but was not
 * what we expect).
 */
export type DawarichFailureKind =
  "notConfigured" | "unreachable" | "auth" | "notFound" | "protocol" | "invalidUrl";
