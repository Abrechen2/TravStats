/**
 * API Key Testing Service
 * Tests API keys by making actual API calls
 */

import axios from "axios";
import { getApiKey, getOpenSkyCredentials } from "./apiKeyResolver";

/**
 * Stable, translatable identifiers for the test outcomes the UI can name in
 * the user's language (#260 — the Immich error-kind pattern). `message`
 * stays the English diagnostic fallback: upstream prose (Google's own
 * error.message, OAuth error_description, network errors) carries no key on
 * purpose — it cannot be translated and is more actionable verbatim.
 */
export type ApiKeyTestMessageKey =
  | "valid"
  | "validBilled"
  | "invalid"
  | "rateLimited"
  | "noKey"
  | "notConfigured"
  | "unexpectedStatus"
  | "protocol"
  | "openskyMissingCredentials"
  | "openskyInvalid";

export interface ApiKeyTestResult {
  success: boolean;
  message: string;
  messageKey?: ApiKeyTestMessageKey;
  /** Interpolation values for messageKey (e.g. { status } for unexpectedStatus). */
  messageParams?: Record<string, string | number>;
  details?: Record<string, unknown>;
}

/** Helper to extract error info from axios-like errors */
function extractAxiosErrorInfo(error: unknown): {
  status?: number;
  message: string;
  data?: Record<string, unknown>;
} {
  if (axios.isAxiosError(error)) {
    return {
      status: error.response?.status,
      message:
        error.response?.data?.error?.message ??
        error.response?.data?.error?.info ??
        error.message ??
        "Unknown error",
      data: error.response?.data as Record<string, unknown> | undefined,
    };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "Unknown error" };
}

/**
 * Test OpenAI API key
 */
export async function testOpenAIKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("openai", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    // Test with a simple completion request
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 5,
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      return {
        success: true,
        message: "API key is valid",
        messageKey: "valid",
        details: {
          model: response.data.model,
        },
      };
    }

    return {
      success: false,
      message: `Unexpected response: ${response.status}`,
      messageKey: "unexpectedStatus",
      messageParams: { status: response.status },
    };
  } catch (error: unknown) {
    const errInfo = extractAxiosErrorInfo(error);
    if (errInfo.status === 401) {
      return {
        success: false,
        message: "Invalid API key",
        messageKey: "invalid",
      };
    }
    if (errInfo.status === 429) {
      return {
        success: false,
        message: "Rate limit exceeded",
        messageKey: "rateLimited",
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test Claude API key
 */
export async function testClaudeKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("claude", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    // Test with a simple message request
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "test" }],
      },
      {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      return {
        success: true,
        message: "API key is valid",
        messageKey: "valid",
        details: {
          model: response.data.model,
        },
      };
    }

    return {
      success: false,
      message: `Unexpected response: ${response.status}`,
      messageKey: "unexpectedStatus",
      messageParams: { status: response.status },
    };
  } catch (error: unknown) {
    const errInfo = extractAxiosErrorInfo(error);
    if (errInfo.status === 401) {
      return {
        success: false,
        message: "Invalid API key",
        messageKey: "invalid",
      };
    }
    if (errInfo.status === 429) {
      return {
        success: false,
        message: "Rate limit exceeded",
        messageKey: "rateLimited",
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test AirLabs API key
 */
export async function testAirlabsKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("airlabs", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    // Test with a simple API call
    const response = await axios.get("https://airlabs.co/api/v9/ping", {
      params: {
        api_key: key,
      },
      timeout: 10000,
    });

    // AirLabs API returns different response formats
    if (response.status === 200) {
      // Check for success status
      if (response.data?.status === "success" || response.data?.response) {
        return {
          success: true,
          message: "API key is valid",
          messageKey: "valid",
          details: response.data,
        };
      }

      // Check for error in response
      if (response.data?.error) {
        const errorMsg =
          typeof response.data.error === "string"
            ? response.data.error
            : response.data.error.message || "API error";
        return {
          success: false,
          message: errorMsg,
        };
      }

      // If we get 200 but no clear success/error, assume it's valid
      return {
        success: true,
        message: "API key is valid",
        messageKey: "valid",
        details: response.data,
      };
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
      return {
        success: false,
        message: "Invalid API key",
        messageKey: "invalid",
      };
    }
    // Check for AirLabs error format
    if (errInfo.data && typeof errInfo.data === "object" && "error" in errInfo.data) {
      const apiError = errInfo.data.error;
      const errorMsg =
        typeof apiError === "string"
          ? apiError
          : typeof apiError === "object" && apiError !== null && "message" in apiError
            ? String((apiError as { message: unknown }).message)
            : "API error";
      return {
        success: false,
        message: errorMsg,
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test Aviationstack API key
 */
export async function testAviationstackKey(
  apiKey: string,
  userId?: string
): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("aviationstack", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    // Test with a simple API call
    const response = await axios.get("https://api.aviationstack.com/v1/flights", {
      params: {
        access_key: key,
        limit: 1,
      },
      timeout: 10000,
    });

    if (response.status === 200) {
      if (response.data?.error) {
        return {
          success: false,
          message: response.data.error.info || "API error",
        };
      }
      return {
        success: true,
        message: "API key is valid",
        messageKey: "valid",
        details: {
          pagination: response.data?.pagination,
        },
      };
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
      return {
        success: false,
        message: "Invalid API key",
        messageKey: "invalid",
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test AeroDataBox API key
 *
 * Uses the `/subscriptions/balance` endpoint — it's cheap (1 unit) and
 * mirrors the actual auth path the lookup adapter uses (RapidAPI host
 * header + key header). Avoids burning a real flight-lookup call from
 * the BASIC tier's tight 600-unit/month budget just to validate.
 */
export async function testAerodataboxKey(
  apiKey: string,
  userId?: string
): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("aerodatabox", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    const response = await axios.get("https://aerodatabox.p.rapidapi.com/subscriptions/balance", {
      headers: {
        "x-rapidapi-host": "aerodatabox.p.rapidapi.com",
        "x-rapidapi-key": key,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    if (response.status === 200) {
      return {
        success: true,
        message: "API key is valid",
        messageKey: "valid",
        details: response.data as Record<string, unknown>,
      };
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
      return {
        success: false,
        message: "Invalid API key",
        messageKey: "invalid",
      };
    }
    if (errInfo.status === 429) {
      return {
        success: false,
        message: "Rate limit exceeded",
        messageKey: "rateLimited",
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test logostream API key
 *
 * Mirrors the real request `airlineLogoService.ts` makes (buildLogostreamUrl
 * / fromLogostream): a GET for a known airline's icon variant, key as a
 * `key=` query param. The response is an image — the body is never parsed,
 * only the status matters, so `responseType: 'arraybuffer'` is enough.
 */
export async function testLogostreamKey(
  apiKey: string,
  userId?: string
): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("logostream", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    const response = await axios.get(
      `https://airlines-api.logostream.dev/airlines/iata/AA?variant=icon&key=${encodeURIComponent(key)}`,
      {
        responseType: "arraybuffer",
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      return {
        success: true,
        message: "API key is valid",
        messageKey: "valid",
      };
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
      return {
        success: false,
        message: "Invalid API key",
        messageKey: "invalid",
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test Google Places API key
 *
 * Mirrors the real request `services/geo/googlePlaces.ts` (findLodgingPlace)
 * makes: a Text Search POST with `X-Goog-Api-Key` + `X-Goog-FieldMask`
 * headers. Unlike the other testers this one is NOT free — every call bills
 * one Text Search request — so it uses the cheapest possible field mask
 * (`places.displayName` only, same principle as googlePlaces.ts:132-135) and
 * says so explicitly in the success message, since the admin is paying for
 * every click of the Test button.
 */
export async function testGooglePlacesKey(
  apiKey: string,
  userId?: string
): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("googlePlaces", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    const response = await axios.post(
      "https://places.googleapis.com/v1/places:searchText",
      { textQuery: "Frankfurt Airport" },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.displayName",
        },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      return {
        success: true,
        message: "API key is valid (this test sent one billed Text Search request, ~0.03 USD)",
        messageKey: "validBilled",
      };
    }

    return {
      success: false,
      message: `Unexpected response: ${response.status}`,
      messageKey: "unexpectedStatus",
      messageParams: { status: response.status },
    };
  } catch (error: unknown) {
    const errInfo = extractAxiosErrorInfo(error);
    // Google answers a malformed/revoked key with 400 INVALID_ARGUMENT, and
    // a valid-but-disabled-API key with 403 PERMISSION_DENIED — both are
    // "the key doesn't work", and extractAxiosErrorInfo already pulled
    // Google's own error.message out of the response body, which is far
    // more actionable than a generic message ("... has not been used in
    // project ... or it is disabled" tells the admin exactly what to fix).
    if (errInfo.status === 400 || errInfo.status === 401 || errInfo.status === 403) {
      return {
        success: false,
        message: errInfo.message || "Invalid API key",
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test OpenRouteService API key
 *
 * Mirrors the real request `openRouteService.ts` (createOpenRouteService)
 * makes: `POST /v2/directions/{profile}/geojson`, key in the raw
 * `Authorization` header (no `Bearer` prefix). Uses the cheapest routable
 * profile (`driving-car`, not the adapter's own `driving-hgv`, which some
 * free-tier ORS accounts don't have enabled) over a two-point route a few
 * hundred metres apart in central Berlin — a real, billed-against-quota
 * request, same trade-off as the other "cheap real call" testers here.
 */
export async function testOpenRouteServiceKey(
  apiKey: string,
  userId?: string
): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("openrouteservice", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    const response = await axios.post(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        coordinates: [
          [13.388, 52.517],
          [13.397, 52.529],
        ],
      },
      {
        headers: {
          Authorization: key,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      return {
        success: true,
        message: "API key is valid",
        messageKey: "valid",
      };
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
      return {
        success: false,
        message: "Invalid API key",
        messageKey: "invalid",
      };
    }
    if (errInfo.status === 429) {
      return {
        success: false,
        message: "Rate limit exceeded",
        messageKey: "rateLimited",
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test GraphHopper API key
 *
 * Mirrors the real request `graphHopper.ts` (createGraphHopper) makes:
 * `GET /route` with repeated `point=lat,lon` params (GraphHopper's own
 * coordinate order — the opposite of ORS/OSRM), `points_encoded=false`, and
 * the key as a `key=` query param. Uses the `car` profile over the same
 * short Berlin route as the ORS tester above.
 */
export async function testGraphHopperKey(
  apiKey: string,
  userId?: string
): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || (await getApiKey("graphhopper", userId));
    if (!key) {
      return {
        success: false,
        message: "No API key provided",
        messageKey: "noKey",
      };
    }

    // Built as a raw query string rather than an axios `params` object:
    // GraphHopper requires `point` to repeat as `point=lat,lon&point=lat,lon`
    // (no array brackets), which is not how axios's default params serializer
    // encodes a JS array — mirrors the adapter's own URLSearchParams build.
    const params = new URLSearchParams();
    params.append("point", "52.517,13.388");
    params.append("point", "52.529,13.397");
    params.append("profile", "car");
    params.append("points_encoded", "false");
    params.append("key", key);

    const response = await axios.get(
      `https://graphhopper.com/api/1/route?${params.toString()}`,
      { timeout: 10000 }
    );

    if (response.status === 200) {
      return {
        success: true,
        message: "API key is valid",
        messageKey: "valid",
      };
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
      return {
        success: false,
        message: "Invalid API key",
        messageKey: "invalid",
      };
    }
    if (errInfo.status === 429) {
      return {
        success: false,
        message: "Rate limit exceeded",
        messageKey: "rateLimited",
      };
    }
    return {
      success: false,
      message: errInfo.message,
    };
  }
}

/**
 * Test OpenSky credentials (OAuth2 only - Client ID + Client Secret)
 */
export async function testOpenSkyCredentials(
  credentials: { clientId?: string; clientSecret?: string; username?: string; password?: string },
  userId?: string
): Promise<ApiKeyTestResult> {
  try {
    // Use provided credentials or get from resolver
    let creds = credentials;
    if (!creds.clientId) {
      const resolved = await getOpenSkyCredentials(userId);
      if (resolved && resolved.clientId) {
        creds = resolved;
      }
    }

    if (!creds.clientId || !creds.clientSecret) {
      return {
        success: false,
        message: "Client ID and Client Secret are required",
        messageKey: "openskyMissingCredentials",
      };
    }

    // Test with OAuth2 (only method supported)
    try {
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      });

      const response = await axios.post(
        "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
        params.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 10000,
        }
      );

      if (response.status === 200 && response.data?.access_token) {
        return {
          success: true,
          message: "OAuth2 credentials are valid",
          messageKey: "valid",
        };
      }

      return {
        success: false,
        message: "Invalid response from authentication server",
        messageKey: "protocol",
      };
    } catch (error: unknown) {
      const errInfo = extractAxiosErrorInfo(error);
      if (errInfo.status === 401 || errInfo.status === 403) {
        return {
          success: false,
          message: "Invalid OAuth2 credentials - please check Client ID and Client Secret",
          messageKey: "openskyInvalid",
        };
      }
      if (errInfo.data && typeof errInfo.data === "object" && "error_description" in errInfo.data) {
        return {
          success: false,
          message: String(errInfo.data.error_description),
        };
      }
      return {
        success: false,
        message: errInfo.message || "Authentication failed",
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
