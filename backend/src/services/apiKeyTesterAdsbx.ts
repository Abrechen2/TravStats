import axios from "axios";

import { ADSBLOL_KEY_HEADER } from "./flightLookup/adsbV2";
import { getApiKey } from "./apiKeyResolver";
import { extractAxiosErrorInfo, failure, type ApiKeyTestResult } from "./apiKeyTester";

// Its own module because apiKeyTester.ts is held under the 800-line limit by
// the file-size ratchet (forgejo#408).

/**
 * Test an ADS-B Exchange (RapidAPI) key.
 *
 * `GET /v2/icao/<hex>` for a fixed hex: one cheap read with the same headers
 * the lookup adapter sends. 200 means the key is accepted — an aircraft that is
 * not currently seen still answers 200 with an empty `ac` list.
 */
export async function testAdsbxKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("adsbx", userId));
    if (!key) {
      return { success: false, message: "No API key provided", messageKey: "noKey" };
    }

    const host = "adsbexchange-com1.p.rapidapi.com";
    const response = await axios.get(`https://${host}/v2/icao/3C6518/`, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": host, Accept: "application/json" },
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

/**
 * Test an adsb.lol key: `GET /v2/hex/<hex>` with the key header. adsb.lol also
 * answers keyless, so a 200 proves the service is reachable and the key was not
 * refused — a rejected key (401/403) is what this can detect.
 */
export async function testAdsbLolKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("adsblol", userId));
    if (!key) {
      return { success: false, message: "No API key provided", messageKey: "noKey" };
    }
    const response = await axios.get("https://api.adsb.lol/v2/hex/3C6518", {
      headers: { [ADSBLOL_KEY_HEADER]: key, Accept: "application/json" },
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
