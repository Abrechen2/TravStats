/**
 * Per-user "test this key" endpoints for the two tour-routing providers
 * (OpenRouteService, GraphHopper) — `routes/settings/apiKeys.ts`. These two
 * were undocumented (found by the openapi coverage guard while task 6 of
 * the tour-routing-providers phase was in flight — `POST
 * /settings/api-keys/test/openrouteservice` and `.../graphhopper`), added
 * when `routes/settings/apiKeys.ts` grew a routing-provider key chain
 * without anyone adding the matching OpenAPI entries.
 *
 * The rest of `/settings/api-keys` (GET/PUT, and the flight-data-provider
 * test endpoints: airlabs, aviationstack, aerodatabox, opensky) is
 * deliberately NOT documented here — those stay in `pending.ts` untouched;
 * this file closes only the two endpoints the guard flagged.
 */

import { z } from "zod";

import { registry } from "../registry";

const apiKeyTestInput = registry.register(
  "ApiKeyTestInput",
  z
    .object({
      apiKey: z
        .string()
        .optional()
        .describe(
          "A key to test directly. Omit it, or send back the masked echo " +
            "from GET /settings/api-keys (a value containing '****'), to " +
            "test the persisted/inherited key instead — the handler " +
            "resolves that case itself.",
        ),
    })
    .openapi("ApiKeyTestInput", { example: {} }),
);

/**
 * Every outcome `services/apiKeyTester.ts`'s testers can report — success,
 * an invalid/rate-limited/unreachable key, or (the one case this route
 * itself produces rather than the tester) no key configured to test at
 * all. `messageKey` is the stable, translatable identifier the frontend
 * switches on; `message` is always present as the untranslated fallback.
 */
const apiKeyTestResult = registry.register(
  "ApiKeyTestResult",
  z
    .object({
      success: z.boolean(),
      message: z.string(),
      messageKey: z
        .enum([
          "valid",
          "validBilled",
          "invalid",
          "rateLimited",
          "noKey",
          "notConfigured",
          "unexpectedStatus",
          "protocol",
          "openskyMissingCredentials",
          "openskyInvalid",
        ])
        .optional(),
      messageParams: z.record(z.union([z.string(), z.number()])).optional(),
      details: z.record(z.unknown()).optional(),
    })
    .openapi("ApiKeyTestResult", {
      example: { success: true, message: "API key is valid", messageKey: "valid" },
    }),
);

const testEndpoint = (provider: "OpenRouteService" | "GraphHopper", path: string) => {
  registry.registerPath({
    method: "post",
    path,
    summary: `Test a ${provider} API key`,
    description:
      `Makes a real, short test request to ${provider} with the given key ` +
      "(or, if the body's `apiKey` is omitted or is the masked GET echo, " +
      "with the persisted/inherited key) and reports whether it is valid. " +
      "This always answers 200 with `success` set either way — an invalid " +
      "or rate-limited key is a normal test OUTCOME, not a request error. " +
      "The only 400 is 'nothing to test': no key was supplied and none is " +
      "configured yet.",
    tags: ["Settings"],
    request: {
      body: { content: { "application/json": { schema: apiKeyTestInput } } },
    },
    responses: {
      200: {
        description: "Test outcome — success is true or false, both are a normal result",
        content: { "application/json": { schema: apiKeyTestResult } },
      },
      400: {
        description: "No key was supplied and none is configured to test — save one first",
        content: { "application/json": { schema: apiKeyTestResult } },
      },
    },
  });
};

testEndpoint("OpenRouteService", "/settings/api-keys/test/openrouteservice");
testEndpoint("GraphHopper", "/settings/api-keys/test/graphhopper");
