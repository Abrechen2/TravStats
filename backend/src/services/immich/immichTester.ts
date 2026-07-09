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
import { ImmichError, normalizeImmichBaseUrl } from "./types";

export interface ImmichTestResult {
  success: boolean;
  message: string;
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
    return {
      success: false,
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
      return { success: false, message: error.message };
    }
    return { success: false, message: "Could not reach Immich" };
  }
}
