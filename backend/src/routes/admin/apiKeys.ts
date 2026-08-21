import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import logger from "../../utils/logger";
import {
  testAirlabsKey,
  testAviationstackKey,
  testAerodataboxKey,
  testLogostreamKey,
  testGooglePlacesKey,
  testOpenSkyCredentials,
} from "../../services/apiKeyTester";

interface GlobalApiKeysUpdateData {
  globalAirlabsApiKey?: string | null;
  globalAviationstackApiKey?: string | null;
  globalAerodataboxApiKey?: string | null;
  globalLogostreamApiKey?: string | null;
  globalGooglePlacesApiKey?: string | null;
  globalOpenskyClientId?: string | null;
  globalOpenskyClientSecret?: string | null;
  globalOpenskyUsername?: string | null;
  globalOpenskyPassword?: string | null;
  allowUserFlightApiKeys?: boolean;
}

const globalApiKeysSchema = z
  .object({
    globalAirlabsApiKey: z.string().optional().nullable(),
    globalAviationstackApiKey: z.string().optional().nullable(),
    globalAerodataboxApiKey: z.string().optional().nullable(),
    // Encryption silently corrupts secrets shorter than 16 bytes (see
    // utils/encryption.ts). Allow the "no change" sentinels — empty string
    // (clear the key) and a masked echo of the GET response (unchanged) —
    // but reject any other short value before it ever reaches encryptApiKey.
    globalLogostreamApiKey: z
      .string()
      .refine((v) => v === "" || v.includes("****") || v.length >= 16, {
        message: "API key must be at least 16 characters",
      })
      .optional()
      .nullable(),
    // Same short-secret guard as the logostream key above — and the same two
    // sentinels: "" clears it, a masked echo means "unchanged".
    globalGooglePlacesApiKey: z
      .string()
      .refine((v) => v === "" || v.includes("****") || v.length >= 16, {
        message: "API key must be at least 16 characters",
      })
      .optional()
      .nullable(),
    globalOpenskyClientId: z.string().optional().nullable(),
    globalOpenskyClientSecret: z.string().optional().nullable(),
    globalOpenskyUsername: z.string().optional().nullable(),
    globalOpenskyPassword: z.string().optional().nullable(),
    allowUserFlightApiKeys: z.boolean().optional(),
  })
  .partial();

const testApiKeySchema = z.object({
  apiKey: z.string().optional(),
});

const testOpenSkySchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

/**
 * Frontend ships the masked GET-response value (e.g. "ac97****2a86") back
 * into the Test request when the admin hasn't typed anything new. Treat
 * empty + masked as "test the persisted key".
 */
const looksMasked = (s: string | undefined | null): boolean => !s || s.includes("****");

/**
 * Encrypt an incoming key value for storage, honouring the masked-echo
 * protocol: the GET response masks stored keys as "abcd****wxyz" and the
 * admin UI PUTs its whole form state back, so a value still containing
 * "****" means "unchanged — keep the stored key" (return undefined = no
 * update). Empty string / null clears the key (encryptApiKey maps them
 * to null).
 */
const encryptUnlessMasked = (incoming: string | null): string | null | undefined =>
  incoming && incoming.includes("****") ? undefined : encryptApiKey(incoming);

async function resolveAdminGlobalKey(
  column:
    | "globalAirlabsApiKey"
    | "globalAviationstackApiKey"
    | "globalAerodataboxApiKey"
    | "globalLogostreamApiKey"
    | "globalGooglePlacesApiKey"
    | "globalOpenskyClientId"
    | "globalOpenskyClientSecret"
): Promise<string | null> {
  const settings = await prisma.adminSettings.findFirst();
  return decryptApiKey((settings?.[column] as string | null) ?? null);
}

const router = Router();

/** Mask a decrypted key for safe display: "abcd****wxyz" */
const maskKey = (encrypted: string | null | undefined): string | undefined => {
  const decrypted = decryptApiKey(encrypted);
  if (!decrypted) return undefined;
  if (decrypted.length <= 8) return "****";
  return decrypted.slice(0, 4) + "****" + decrypted.slice(-4);
};

// Get global API keys
router.get("/api-keys", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminSettings = await prisma.adminSettings.findFirst();

    if (!adminSettings) {
      return res.json({
        globalAirlabsApiKey: undefined,
        globalAviationstackApiKey: undefined,
        globalAerodataboxApiKey: undefined,
        globalLogostreamApiKey: undefined,
        globalGooglePlacesApiKey: undefined,
        globalOpenskyClientId: undefined,
        globalOpenskyClientSecret: undefined,
        globalOpenskyUsername: undefined,
        globalOpenskyPassword: undefined,
        allowUserFlightApiKeys: true,
      });
    }

    res.json({
      globalAirlabsApiKey: maskKey(adminSettings.globalAirlabsApiKey),
      globalAviationstackApiKey: maskKey(adminSettings.globalAviationstackApiKey),
      globalAerodataboxApiKey: maskKey(adminSettings.globalAerodataboxApiKey),
      globalLogostreamApiKey: maskKey(adminSettings.globalLogostreamApiKey),
      globalGooglePlacesApiKey: maskKey(adminSettings.globalGooglePlacesApiKey),
      globalOpenskyClientId: maskKey(adminSettings.globalOpenskyClientId),
      globalOpenskyClientSecret: maskKey(adminSettings.globalOpenskyClientSecret),
      globalOpenskyUsername: maskKey(adminSettings.globalOpenskyUsername),
      globalOpenskyPassword: maskKey(adminSettings.globalOpenskyPassword),
      allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys ?? true,
    });
  } catch (error) {
    logger.error({
      operation: "get_global_api_keys_error",
      message: "Failed to get global API keys",
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    next(error);
  }
});

// Update global API keys
router.put("/api-keys", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payload = globalApiKeysSchema.parse(req.body);

    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: GlobalApiKeysUpdateData = {};

    // Encrypt flight lookup API keys before storing. Every field goes
    // through encryptUnlessMasked() — the admin UI always PUTs its entire
    // form state, which after a GET contains masked echoes ("ac97****2a86")
    // for every provider the admin did not retype. Re-encrypting a masked
    // echo would silently overwrite the real stored key with an unusable
    // ciphertext of the literal mask string.
    if (payload.globalAirlabsApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalAirlabsApiKey);
      if (encrypted !== undefined) {
        updateData.globalAirlabsApiKey = encrypted;
      }
    }
    if (payload.globalAviationstackApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalAviationstackApiKey);
      if (encrypted !== undefined) {
        updateData.globalAviationstackApiKey = encrypted;
      }
    }
    if (payload.globalAerodataboxApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalAerodataboxApiKey);
      if (encrypted !== undefined) {
        updateData.globalAerodataboxApiKey = encrypted;
      }
    }
    if (payload.globalLogostreamApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalLogostreamApiKey);
      if (encrypted !== undefined) {
        updateData.globalLogostreamApiKey = encrypted;
      }
    }
    if (payload.globalGooglePlacesApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalGooglePlacesApiKey);
      if (encrypted !== undefined) {
        updateData.globalGooglePlacesApiKey = encrypted;
      }
    }
    if (payload.globalOpenskyClientId !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalOpenskyClientId);
      if (encrypted !== undefined) {
        updateData.globalOpenskyClientId = encrypted;
      }
    }
    if (payload.globalOpenskyClientSecret !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalOpenskyClientSecret);
      if (encrypted !== undefined) {
        updateData.globalOpenskyClientSecret = encrypted;
      }
    }
    if (payload.globalOpenskyUsername !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalOpenskyUsername);
      if (encrypted !== undefined) {
        updateData.globalOpenskyUsername = encrypted;
      }
    }
    if (payload.globalOpenskyPassword !== undefined) {
      const encrypted = encryptUnlessMasked(payload.globalOpenskyPassword);
      if (encrypted !== undefined) {
        updateData.globalOpenskyPassword = encrypted;
      }
    }
    if (payload.allowUserFlightApiKeys !== undefined) {
      updateData.allowUserFlightApiKeys = payload.allowUserFlightApiKeys;
    }

    if (adminSettings) {
      adminSettings = await prisma.adminSettings.update({
        where: { id: adminSettings.id },
        data: updateData,
      });
    } else {
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          defaultVisionParser: "auto",
          defaultTextParser: "auto",
          allowUserFlightApiKeys: true,
          ...updateData,
        },
      });
    }

    res.json({
      message: "Global API keys updated successfully",
      settings: {
        globalAirlabsApiKey: maskKey(adminSettings.globalAirlabsApiKey),
        globalAviationstackApiKey: maskKey(adminSettings.globalAviationstackApiKey),
        globalAerodataboxApiKey: maskKey(adminSettings.globalAerodataboxApiKey),
        globalLogostreamApiKey: maskKey(adminSettings.globalLogostreamApiKey),
        globalOpenskyClientId: maskKey(adminSettings.globalOpenskyClientId),
        globalOpenskyClientSecret: maskKey(adminSettings.globalOpenskyClientSecret),
        globalOpenskyUsername: maskKey(adminSettings.globalOpenskyUsername),
        globalOpenskyPassword: maskKey(adminSettings.globalOpenskyPassword),
        allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Test API key endpoints (admin)
router.post(
  "/api-keys/test/airlabs",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { apiKey } = testApiKeySchema.parse(req.body);
      const effective = looksMasked(apiKey)
        ? ((await resolveAdminGlobalKey("globalAirlabsApiKey")) ?? "")
        : apiKey!;
      if (!effective) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No AirLabs key configured to test. Save one first.",
            messageKey: "notConfigured",
          });
      }
      const result = await testAirlabsKey(effective);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api-keys/test/aviationstack",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { apiKey } = testApiKeySchema.parse(req.body);
      const effective = looksMasked(apiKey)
        ? ((await resolveAdminGlobalKey("globalAviationstackApiKey")) ?? "")
        : apiKey!;
      if (!effective) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No Aviationstack key configured to test. Save one first.",
            messageKey: "notConfigured",
          });
      }
      const result = await testAviationstackKey(effective);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api-keys/test/aerodatabox",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { apiKey } = testApiKeySchema.parse(req.body);
      const effective = looksMasked(apiKey)
        ? ((await resolveAdminGlobalKey("globalAerodataboxApiKey")) ?? "")
        : apiKey!;
      if (!effective) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No AeroDataBox key configured to test. Save one first.",
            messageKey: "notConfigured",
          });
      }
      const result = await testAerodataboxKey(effective);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api-keys/test/logostream",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { apiKey } = testApiKeySchema.parse(req.body);
      const effective = looksMasked(apiKey)
        ? ((await resolveAdminGlobalKey("globalLogostreamApiKey")) ?? "")
        : apiKey!;
      if (!effective) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No logostream key configured to test. Save one first.",
            messageKey: "notConfigured",
          });
      }
      const result = await testLogostreamKey(effective);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api-keys/test/googlePlaces",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { apiKey } = testApiKeySchema.parse(req.body);
      const effective = looksMasked(apiKey)
        ? ((await resolveAdminGlobalKey("globalGooglePlacesApiKey")) ?? "")
        : apiKey!;
      if (!effective) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No Google Places key configured to test. Save one first.",
            messageKey: "notConfigured",
          });
      }
      const result = await testGooglePlacesKey(effective);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api-keys/test/opensky",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      let { clientId, clientSecret, username, password } = testOpenSkySchema.parse(req.body);
      if (looksMasked(clientId) || looksMasked(clientSecret)) {
        clientId = (await resolveAdminGlobalKey("globalOpenskyClientId")) ?? undefined;
        clientSecret = (await resolveAdminGlobalKey("globalOpenskyClientSecret")) ?? undefined;
      }
      if (!(clientId && clientSecret) && !(username && password)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "No OpenSky credentials configured to test. Save them first.",
            messageKey: "notConfigured",
          });
      }
      const result = await testOpenSkyCredentials({ clientId, clientSecret, username, password });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
