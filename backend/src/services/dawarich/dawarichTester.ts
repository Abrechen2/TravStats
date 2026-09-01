/**
 * Validate a Dawarich connection and turn any failure into a message a
 * self-hoster can act on: bad URL vs bad key vs unreachable vs wrong
 * software answering on that port. Mirrors `services/immich/immichTester.ts`.
 *
 * Health first (unauthenticated, `GET /api/v1/health`), points second — so a
 * wrong URL never reads as a wrong key, and a rejected key never reads as an
 * unreachable host.
 */
import { createDawarichClient } from "./dawarichClient";
import { DawarichError, DawarichErrorKind, normalizeDawarichBaseUrl } from "./errors";

export interface DawarichTestResult {
  success: boolean;
  /**
   * Human-readable, English — kept for server logs and debugging. The UI
   * must NOT render this directly; it renders a localized string keyed off
   * `kind`.
   */
  message: string;
  /**
   * Machine-readable failure classification, present only on failure. The
   * frontend maps it to a localized `errors.<kind>` string, matching the
   * fixed `dawarichFailureKind()` vocabulary (identical to Immich's).
   */
  kind?: DawarichErrorKind;
  details?: { version?: string };
}

/**
 * A minimal recent window — enough to prove the key is accepted (a 401
 * reads as `auth` regardless of whether the window has any data in it),
 * nothing more. `per_page` stays at the client's default; one page is
 * always enough for a probe this small.
 */
const PROBE_WINDOW_MS = 60_000;

export async function testDawarichConnection(
  baseUrl: string,
  apiKey: string,
): Promise<DawarichTestResult> {
  let normalized: string;
  try {
    normalized = normalizeDawarichBaseUrl(baseUrl);
  } catch (error) {
    // normalizeDawarichBaseUrl only ever throws DawarichError("invalidUrl", …)
    // (bad URL shape / non-http scheme) — the user's own typo, NOT a server
    // problem. The defensive non-DawarichError branch maps to the same
    // `invalidUrl` kind so a malformed base URL never masquerades as a
    // `protocol` (server-version) failure.
    return {
      success: false,
      kind: error instanceof DawarichError ? error.kind : "invalidUrl",
      message: error instanceof DawarichError ? error.message : "Invalid Dawarich URL",
    };
  }

  const client = createDawarichClient({ baseUrl: normalized, apiKey, source: "user" });

  try {
    const health = await client.checkHealth();
    const now = new Date();
    await client.getPoints({ startAt: new Date(now.getTime() - PROBE_WINDOW_MS), endAt: now });
    return {
      success: true,
      message: "Connected to Dawarich",
      details: health.version ? { version: health.version } : undefined,
    };
  } catch (error) {
    if (error instanceof DawarichError) {
      return { success: false, kind: error.kind, message: error.message };
    }
    return { success: false, kind: "unreachable", message: "Could not reach Dawarich" };
  }
}
