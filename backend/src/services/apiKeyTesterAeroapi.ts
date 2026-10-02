import axios from "axios";

import { getApiKey } from "./apiKeyResolver";
import { extractAxiosErrorInfo, failure, type ApiKeyTestResult } from "./apiKeyTester";

// Its own module because apiKeyTester.ts is held under the 800-line limit by
// the file-size ratchet; the AeroAPI provider arrived with forgejo#156.

/**
 * Test FlightAware AeroAPI key
 *
 * `GET /airports/EDDF` — one fixed, cheap read with the same `x-apikey`
 * header the lookup adapter sends. A 200 means the key is accepted; no
 * flight query is spent on it.
 */
export async function testAeroapiKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("aeroapi", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    const response = await axios.get("https://aeroapi.flightaware.com/aeroapi/airports/EDDF", {
      headers: { "x-apikey": key, Accept: "application/json" },
      timeout: 10000,
    });

    if (response.status === 200) {
      return { success: true, message: "API key is valid", messageKey: "valid" };
    }

    return {
      success: false,
      message: `Unexpected response: ${response.status}`,
      messageKey: "unexpectedStatus",
      messageParams: { status: response.status },
    };
  } catch (error: unknown) {
    const errInfo = extractAxiosErrorInfo(error);
    if (errInfo.status === 401 || errInfo.status === 403) {
      return { success: false, message: "Invalid API key", messageKey: "invalid" };
    }
    if (errInfo.status === 429) {
      return { success: false, message: "Rate limit exceeded", messageKey: "rateLimited" };
    }
    return failure(errInfo);
  }
}
