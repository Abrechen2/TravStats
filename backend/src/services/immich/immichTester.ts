/**
 * Validate an Immich connection and turn any failure into a message a
 * self-hoster can act on: bad URL vs bad key vs unreachable vs wrong software
 * answering on that port. Mirrors the `ApiKeyTestResult` shape of
 * `services/apiKeyTester.ts`.
 *
 * Version first (unauthenticated), identity second — so a wrong URL never
 * reads as a wrong key.
 */
import { createImmichClient } from "./immichClient";
import { ImmichError, ImmichErrorKind, normalizeImmichBaseUrl } from "./types";

export interface ImmichTestResult {
  success: boolean;
  /**
   * Human-readable, English — kept for server logs and debugging. The UI must
   * NOT render this directly; it renders a localized string keyed off `kind`.
   */
  message: string;
  /**
   * Machine-readable failure classification, present only on failure. The
   * frontend maps it to a localized `errors.<kind>` string, matching the fixed
   * `immichFailureKind()` vocabulary.
   */
  kind?: ImmichErrorKind;
  details?: { version?: string; user?: string };
}

export async function testImmichConnection(
  baseUrl: string,
  apiKey: string,
): Promise<ImmichTestResult> {
  let normalized: string;
  try {
    normalized = normalizeImmichBaseUrl(baseUrl);
  } catch (error) {
    // normalizeImmichBaseUrl only ever throws ImmichError("protocol", …) (bad
    // URL shape / non-http scheme), so a normalize failure IS a protocol/config
    // problem. The defensive non-ImmichError branch maps to the same `protocol`
    // kind for consistency — staying inside the fixed 5-kind vocabulary rather
    // than inventing a new one for a practically-unreachable branch.
    return {
      success: false,
      kind: error instanceof ImmichError ? error.kind : "protocol",
      message: error instanceof ImmichError ? error.message : "Invalid Immich URL",
    };
  }

  const client = createImmichClient({ baseUrl: normalized, apiKey, source: "user" });

  try {
    const version = await client.getServerVersion();
    const identity = await client.whoami();
    return {
      success: true,
      message: "Connected to Immich",
      details: { version, user: identity.name },
    };
  } catch (error) {
    if (error instanceof ImmichError) {
      return { success: false, kind: error.kind, message: error.message };
    }
    return { success: false, kind: "unreachable", message: "Could not reach Immich" };
  }
}
