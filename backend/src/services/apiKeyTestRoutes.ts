import type { NextFunction, Response, Router } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { looksMasked } from "../utils/maskedKey";
import {
  testAerodataboxKey,
  testAirlabsKey,
  testAviationstackKey,
  testGooglePlacesKey,
  testGraphHopperKey,
  testLogostreamKey,
  testOpenRouteServiceKey,
  type ApiKeyTestResult,
} from "./apiKeyTester";
import { testAdsbLolKey, testAdsbxKey } from "./apiKeyTesterAdsbx";
import { testAeroapiKey } from "./apiKeyTesterAeroapi";

/**
 * One table for the "test this key" endpoints that the account settings and the
 * admin settings both serve (`POST <base>/test/<provider>`). They were sixteen
 * hand-copied handlers; the account copy had also lost `messageKey:
 * "notConfigured"`, so its "no key saved" answer reached the German UI as
 * English prose. The stable code is sent here, once, for both.
 */
export interface KeyTestProvider {
  /** Path segment and key into the stored-key resolver. */
  id: string;
  /** Name used in the English fallback message. */
  label: string;
  test: (apiKey: string, userId?: string) => Promise<ApiKeyTestResult>;
}

export const FLIGHT_AND_ROUTING_KEY_PROVIDERS: readonly KeyTestProvider[] = [
  { id: "airlabs", label: "AirLabs", test: testAirlabsKey },
  { id: "aviationstack", label: "Aviationstack", test: testAviationstackKey },
  { id: "aerodatabox", label: "AeroDataBox", test: testAerodataboxKey },
  { id: "aeroapi", label: "AeroAPI", test: testAeroapiKey },
  { id: "adsbx", label: "ADS-B Exchange", test: testAdsbxKey },
  { id: "adsblol", label: "adsb.lol", test: testAdsbLolKey },
  { id: "openrouteservice", label: "OpenRouteService", test: testOpenRouteServiceKey },
  { id: "graphhopper", label: "GraphHopper", test: testGraphHopperKey },
];

/** Admin-only providers (no per-account key exists for them). */
export const ADMIN_ONLY_KEY_PROVIDERS: readonly KeyTestProvider[] = [
  { id: "logostream", label: "logostream", test: testLogostreamKey },
  { id: "googlePlaces", label: "Google Places", test: testGooglePlacesKey },
];

const testApiKeySchema = z.object({ apiKey: z.string().optional() });

interface MountOptions {
  /** Path in front of `/test/<id>`: "" for the account router, "/api-keys" for admin. */
  basePath: string;
  providers: readonly KeyTestProvider[];
  /** The persisted key to test when the client sent the masked value back. */
  resolveStored: (providerId: string, req: AuthRequest) => Promise<string | null | undefined>;
  /** The account router passes the user so a per-account quota/log is attributed. */
  passUserId: boolean;
}

export function mountKeyTestRoutes(router: Router, options: MountOptions): void {
  for (const provider of options.providers) {
    router.post(
      `${options.basePath}/test/${provider.id}`,
      async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
          const { apiKey } = testApiKeySchema.parse(req.body);
          const effective = looksMasked(apiKey)
            ? ((await options.resolveStored(provider.id, req)) ?? "")
            : apiKey!;
          if (!effective) {
            res.status(400).json({
              success: false,
              message: `No ${provider.label} key configured to test. Save one first.`,
              messageKey: "notConfigured",
            });
            return;
          }
          res.json(await provider.test(effective, options.passUserId ? req.userId! : undefined));
        } catch (error) {
          next(error);
        }
      }
    );
  }
}
