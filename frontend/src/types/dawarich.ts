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
 *
 * `DAWARICH_FAILURE_KINDS` is the canonical runtime list — the `as const` +
 * derived-type convention every vocabulary in `types/tour.ts` follows.
 * `lib/api/dawarich.ts` imports it rather than re-declaring the list, and
 * `i18n/__tests__/tripsTourKeys.test.ts` binds it to the i18n
 * `tours.tracks.dawarich.errors.*` keys the same way it binds `LEG_MODES`
 * and `LEG_SOURCES` — a kind added here without its i18n label now fails a
 * test instead of rendering a raw key at the user.
 */
export const DAWARICH_FAILURE_KINDS = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
] as const;

export type DawarichFailureKind = (typeof DAWARICH_FAILURE_KINDS)[number];
