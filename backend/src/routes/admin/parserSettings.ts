import { Router, Response, NextFunction } from "express";
import https from "https";
import http from "http";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { AppError } from "../../middleware/errorHandler";
import { encryptUnlessMasked, looksMasked, maskKey } from "../../utils/maskedKey";
import { decryptApiKey } from "../../utils/encryption";
import {
  checkLlmBaseUrl,
  CLOUD_PROVIDER_KINDS,
  type CloudProviderKind,
} from "../../services/llm/llmEndpoint";
import {
  llmProbe,
  parseProviderOrder,
  serializeProviderOrder,
  OPENAI_BASE_URL,
  ANTHROPIC_BASE_URL,
  GOOGLE_BASE_URL,
} from "../../services/llm/llmProvider";
import { clearAvailabilityCache } from "../../services/parsers/config";
import { clearLlmAvailabilityCache } from "../../services/parsers/llmAvailability";
import type { AdminSettings } from "../../prisma";

interface ParserSettingsUpdateData {
  allowUserApiKeys?: boolean;
  fxCdnFallbackEnabled?: boolean;
  parserOrder?: string;
  llmEnabled?: boolean;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
  llmOllamaOptIn?: boolean;
  llmProviderOrder?: string;
  openaiCompatBaseUrl?: string | null;
  openaiCompatModel?: string | null;
  openaiCompatApiKey?: string | null;
  llmCustomOptIn?: boolean;
  llmOpenaiApiKey?: string | null;
  llmOpenaiModel?: string | null;
  llmOpenaiOptIn?: boolean;
  llmAnthropicApiKey?: string | null;
  llmAnthropicModel?: string | null;
  llmAnthropicOptIn?: boolean;
  llmGoogleApiKey?: string | null;
  llmGoogleModel?: string | null;
  llmGoogleOptIn?: boolean;
}

/** The fixed base URL for a NAMED cloud slot — `custom` has none, it is admin-supplied. */
const FIXED_SLOT_URL: Record<Exclude<CloudProviderKind, "custom">, string> = {
  openai: OPENAI_BASE_URL,
  anthropic: ANTHROPIC_BASE_URL,
  google: GOOGLE_BASE_URL,
};

/** Which stored (encrypted) column a masked-echo test-connection reads back, per slot. */
async function storedKeyFor(kind: CloudProviderKind, settingsId: number): Promise<string | null> {
  if (kind === "custom") {
    const row = await prisma.adminSettings.findUnique({
      where: { id: settingsId },
      select: { openaiCompatApiKey: true },
    });
    return row?.openaiCompatApiKey ?? null;
  }
  if (kind === "openai") {
    const row = await prisma.adminSettings.findUnique({
      where: { id: settingsId },
      select: { llmOpenaiApiKey: true },
    });
    return row?.llmOpenaiApiKey ?? null;
  }
  if (kind === "anthropic") {
    const row = await prisma.adminSettings.findUnique({
      where: { id: settingsId },
      select: { llmAnthropicApiKey: true },
    });
    return row?.llmAnthropicApiKey ?? null;
  }
  const row = await prisma.adminSettings.findUnique({
    where: { id: settingsId },
    select: { llmGoogleApiKey: true },
  });
  return row?.llmGoogleApiKey ?? null;
}

/**
 * A base URL as the admin typed it, validated by the one endpoint rule
 * (`llm/llmEndpoint.ts`): https, except on a local/LAN host. The problem is a
 * stable code the admin UI words; an empty string clears the field.
 */
function normalizeProviderBaseUrl(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw.trim() === "") return null;
  const check = checkLlmBaseUrl(raw);
  if (check.ok) return check.url;
  throw new AppError(
    `Invalid AI provider base URL: ${check.problem}`,
    400,
    check.problem === "https_required" ? "LLM_BASE_URL_HTTPS_REQUIRED" : "LLM_BASE_URL_INVALID",
    "openaiCompatBaseUrl"
  );
}

/** Whether the saved OpenAI-compatible endpoint is outside the local network. */
function providerIsCloud(settings: AdminSettings): boolean {
  if (!settings.openaiCompatBaseUrl) return false;
  const check = checkLlmBaseUrl(settings.openaiCompatBaseUrl);
  return check.ok && !check.isLocal;
}

/** The settings as the admin page reads them — every key only ever masked. */
function serializeParserSettings(settings: AdminSettings) {
  return {
    allowUserApiKeys: settings.allowUserApiKeys,
    fxCdnFallbackEnabled: settings.fxCdnFallbackEnabled,
    allowUserFlightApiKeys: settings.allowUserFlightApiKeys,
    parserOrder: settings.parserOrder ?? "template_first",
    llmEnabled: settings.llmEnabled,
    ollamaUrl: settings.ollamaUrl ?? null,
    ollamaModel: settings.ollamaModel ?? null,
    llmOllamaOptIn: settings.llmOllamaOptIn,
    // Always the four kinds, in the admin's priority, completed with any
    // missing kind at the end — the same normalisation `parseProviderOrder`
    // (`llmProvider.ts`) applies at dispatch time, so what the page shows is
    // what will actually be tried.
    llmProviderOrder: parseProviderOrder(settings.llmProviderOrder),
    openaiCompatBaseUrl: settings.openaiCompatBaseUrl ?? null,
    openaiCompatModel: settings.openaiCompatModel ?? null,
    openaiCompatApiKey: maskKey(settings.openaiCompatApiKey) ?? null,
    openaiCompatIsCloud: providerIsCloud(settings),
    llmCustomOptIn: settings.llmCustomOptIn,
    llmOpenaiModel: settings.llmOpenaiModel ?? null,
    llmOpenaiApiKey: maskKey(settings.llmOpenaiApiKey) ?? null,
    llmOpenaiOptIn: settings.llmOpenaiOptIn,
    llmAnthropicModel: settings.llmAnthropicModel ?? null,
    llmAnthropicApiKey: maskKey(settings.llmAnthropicApiKey) ?? null,
    llmAnthropicOptIn: settings.llmAnthropicOptIn,
    llmGoogleModel: settings.llmGoogleModel ?? null,
    llmGoogleApiKey: maskKey(settings.llmGoogleApiKey) ?? null,
    llmGoogleOptIn: settings.llmGoogleOptIn,
  };
}

const parserSettingsSchema = z.object({
  allowUserApiKeys: z.boolean().optional(),
  // Whether a rate the ECB cannot serve may be fetched from the keyless
  // jsDelivr currency dataset. It sits with the other service settings
  // because it is the same kind of decision as the Ollama URL: which outside
  // service this instance is allowed to contact.
  fxCdnFallbackEnabled: z.boolean().optional(),
  // Which reader looks at a booking document first, in every domain. Kept to
  // the two values the parsers understand, so an admin cannot save a word
  // that silently means "template_first" (`getParserOrder`).
  parserOrder: z.enum(["template_first", "llm_first"]).optional(),
  // The "KI-Parser aus" switch (owner decision 2026-09-25): off means no model
  // call anywhere, even with an Ollama URL or OLLAMA_URL set — see llmGate.ts.
  llmEnabled: z.boolean().optional(),
  ollamaUrl: z.string().url("Must be a valid URL").optional().nullable(),
  ollamaModel: z.string().min(1).max(100).optional().nullable(),
  // Consent for a REMOTE Ollama only — the local/LAN case never asks for this.
  llmOllamaOptIn: z.boolean().optional(),
  // The admin's priority among the four cloud slots (owner decision
  // 2026-09-26: a fallback CHAIN, not one picked "active" provider). Every
  // kind exactly once, in any order — `serializeProviderOrder` stores it.
  llmProviderOrder: z
    .array(z.enum(CLOUD_PROVIDER_KINDS))
    .refine(
      (arr) => arr.length === CLOUD_PROVIDER_KINDS.length && new Set(arr).size === arr.length,
      "llmProviderOrder must name each cloud slot exactly once"
    )
    .optional(),
  // The `custom` slot (beta.17's `openai_compatible`) — a free-form base URL.
  openaiCompatBaseUrl: z.string().max(500).optional().nullable(),
  openaiCompatModel: z.string().max(200).optional().nullable(),
  // Masked echo ("abcd****wxyz") = unchanged; "" / null = clear.
  openaiCompatApiKey: z.string().max(1000).optional().nullable(),
  // The custom slot's OWN consent.
  llmCustomOptIn: z.boolean().optional(),
  // OpenAI — fixed endpoint, key + model only, its OWN consent.
  llmOpenaiApiKey: z.string().max(1000).optional().nullable(),
  llmOpenaiModel: z.string().max(200).optional().nullable(),
  llmOpenaiOptIn: z.boolean().optional(),
  // Anthropic — fixed endpoint, key + model only, its OWN consent.
  llmAnthropicApiKey: z.string().max(1000).optional().nullable(),
  llmAnthropicModel: z.string().max(200).optional().nullable(),
  llmAnthropicOptIn: z.boolean().optional(),
  // Google — fixed endpoint, key + model only, its OWN consent.
  llmGoogleApiKey: z.string().max(1000).optional().nullable(),
  llmGoogleModel: z.string().max(200).optional().nullable(),
  llmGoogleOptIn: z.boolean().optional(),
});

const router = Router();

// Get admin parser settings
router.get("/parser-settings", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // The row's own column defaults decide what a fresh instance gets — this
    // handler used to insert 'tesseract'/'regex', so which parser an instance
    // defaulted to depended on which page an admin opened first.
    const adminSettings = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: await ensureAdminSettingsRow() },
    });

    res.json(serializeParserSettings(adminSettings));
  } catch (error) {
    next(error);
  }
});

// Update admin parser settings
router.put("/parser-settings", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      allowUserApiKeys,
      fxCdnFallbackEnabled,
      parserOrder,
      llmEnabled,
      ollamaUrl,
      ollamaModel,
      llmOllamaOptIn,
      llmProviderOrder,
      openaiCompatBaseUrl,
      openaiCompatModel,
      openaiCompatApiKey,
      llmCustomOptIn,
      llmOpenaiApiKey,
      llmOpenaiModel,
      llmOpenaiOptIn,
      llmAnthropicApiKey,
      llmAnthropicModel,
      llmAnthropicOptIn,
      llmGoogleApiKey,
      llmGoogleModel,
      llmGoogleOptIn,
    } = parserSettingsSchema.parse(req.body);

    let adminSettings;

    const updateData: ParserSettingsUpdateData = {};

    if (allowUserApiKeys !== undefined) {
      updateData.allowUserApiKeys = allowUserApiKeys;
    }
    if (fxCdnFallbackEnabled !== undefined) {
      updateData.fxCdnFallbackEnabled = fxCdnFallbackEnabled;
    }
    if (parserOrder !== undefined) {
      updateData.parserOrder = parserOrder;
    }
    if (llmEnabled !== undefined) {
      updateData.llmEnabled = llmEnabled;
    }
    if (ollamaUrl !== undefined) {
      updateData.ollamaUrl = ollamaUrl;
    }
    if (ollamaModel !== undefined) {
      updateData.ollamaModel = ollamaModel;
    }
    if (llmOllamaOptIn !== undefined) updateData.llmOllamaOptIn = llmOllamaOptIn;
    if (llmProviderOrder !== undefined) {
      updateData.llmProviderOrder = serializeProviderOrder(llmProviderOrder);
    }
    const baseUrl = normalizeProviderBaseUrl(openaiCompatBaseUrl);
    if (baseUrl !== undefined) updateData.openaiCompatBaseUrl = baseUrl;
    if (openaiCompatModel !== undefined) {
      updateData.openaiCompatModel = openaiCompatModel?.trim() || null;
    }
    if (openaiCompatApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(openaiCompatApiKey);
      if (encrypted !== undefined) updateData.openaiCompatApiKey = encrypted;
    }
    if (llmCustomOptIn !== undefined) updateData.llmCustomOptIn = llmCustomOptIn;

    if (llmOpenaiApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(llmOpenaiApiKey);
      if (encrypted !== undefined) updateData.llmOpenaiApiKey = encrypted;
    }
    if (llmOpenaiModel !== undefined) updateData.llmOpenaiModel = llmOpenaiModel?.trim() || null;
    if (llmOpenaiOptIn !== undefined) updateData.llmOpenaiOptIn = llmOpenaiOptIn;

    if (llmAnthropicApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(llmAnthropicApiKey);
      if (encrypted !== undefined) updateData.llmAnthropicApiKey = encrypted;
    }
    if (llmAnthropicModel !== undefined) {
      updateData.llmAnthropicModel = llmAnthropicModel?.trim() || null;
    }
    if (llmAnthropicOptIn !== undefined) updateData.llmAnthropicOptIn = llmAnthropicOptIn;

    if (llmGoogleApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(llmGoogleApiKey);
      if (encrypted !== undefined) updateData.llmGoogleApiKey = encrypted;
    }
    if (llmGoogleModel !== undefined) updateData.llmGoogleModel = llmGoogleModel?.trim() || null;
    if (llmGoogleOptIn !== undefined) updateData.llmGoogleOptIn = llmGoogleOptIn;

    // Always an update against the one row. The create branch this replaces
    // dropped `updateData` on the floor, so a PUT that happened to be the
    // first write to a fresh instance saved nothing the admin had typed.
    adminSettings = await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: updateData,
    });

    // A provider switch must be felt by the very next parse, not after the
    // five-minute availability cache has run out on the old endpoint.
    clearAvailabilityCache();
    clearLlmAvailabilityCache();

    res.json({
      message: "Parser settings updated successfully",
      settings: serializeParserSettings(adminSettings),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * "Verbindung testen" for a cloud slot: `GET {baseUrl}/models` with the key
 * (Anthropic's own header pair for `kind: "anthropic"`). It carries no
 * document — only the key — so it runs before that slot's own consent, which
 * is exactly when an admin needs it. `openai`/`anthropic`/`google` use their
 * FIXED base URL (`baseUrl` is ignored/not required); `custom` needs one. The
 * answer is a stable `errorCode` the UI words; `detail` is the protocol/
 * status line (never a response body, never the key). `ok`, not `success`:
 * this router is in the bare family (ADR 0001), and its frozen envelope
 * leaks only shrink.
 */
router.post("/test-llm-provider", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { kind, baseUrl, model, apiKey } = z
      .object({
        kind: z.enum(CLOUD_PROVIDER_KINDS),
        baseUrl: z.string().max(500).optional().nullable(),
        model: z.string().max(200).optional().nullable(),
        apiKey: z.string().max(1000).optional().nullable(),
      })
      .parse(req.body);

    let url: string;
    let isLocal: boolean;
    if (kind === "custom") {
      if (!baseUrl) {
        res.json({ ok: false, errorCode: "invalid_url" });
        return;
      }
      const check = checkLlmBaseUrl(baseUrl);
      if (!check.ok) {
        res.json({ ok: false, errorCode: check.problem });
        return;
      }
      url = check.url;
      isLocal = check.isLocal;
    } else {
      url = FIXED_SLOT_URL[kind];
      isLocal = false;
    }

    let key = apiKey ?? null;
    if (looksMasked(key)) {
      key = decryptApiKey(await storedKeyFor(kind, await ensureAdminSettingsRow()));
    }

    const probe = await llmProbe({
      kind,
      url,
      model: model ?? "",
      ...(key ? { apiKey: key } : {}),
      isCloud: !isLocal,
    });
    if (!probe.reachable) {
      const auth = /HTTP 40[13]\b/.test(probe.error ?? "");
      res.json({
        ok: false,
        errorCode: auth ? "auth" : "unreachable",
        detail: probe.error ?? null,
        isCloud: !isLocal,
      });
      return;
    }
    const wanted = model?.trim();
    res.json({
      ok: true,
      isCloud: !isLocal,
      modelCount: probe.models.length,
      // null = the endpoint lists no models (some proxies do not), which is
      // not the same as "your model is missing".
      modelFound: wanted && probe.models.length > 0 ? probe.models.includes(wanted) : null,
    });
  } catch (error) {
    next(error);
  }
});

// Test Ollama connectivity
router.post("/test-ollama", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ollamaUrl, ollamaModel } = z
      .object({
        ollamaUrl: z.string().url(),
        ollamaModel: z.string().min(1),
      })
      .parse(req.body);

    const tagsUrl = `${ollamaUrl}/api/tags`;
    const parsed = new URL(tagsUrl);

    // SSRF protection: block loopback and link-local addresses
    const BLOCKED_HOSTS = /^(localhost|127\.|::1|0\.0\.0\.0|169\.254\.)/i;
    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      res.json({ success: false, error: "Loopback and link-local addresses are not allowed" });
      return;
    }

    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const result = await new Promise<{ ok: boolean; models?: string[]; error?: string }>(
      (resolve) => {
        const req2 = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname,
            method: "GET",
            timeout: 5000,
          },
          (response) => {
            let data = "";
            response.on("data", (chunk: string) => {
              data += chunk;
            });
            response.on("end", () => {
              try {
                const json: unknown = JSON.parse(data);
                if (typeof json === "object" && json !== null && "models" in json) {
                  const modelsArray = (json as Record<string, unknown>).models;
                  const models = Array.isArray(modelsArray)
                    ? modelsArray.map((m: unknown) => {
                        if (typeof m === "object" && m !== null && "name" in m) {
                          return String((m as Record<string, unknown>).name);
                        }
                        return String(m);
                      })
                    : [];
                  const modelInstalled = models.some((m) => m.startsWith(ollamaModel));
                  resolve({
                    ok: true,
                    models,
                    ...(modelInstalled
                      ? {}
                      : {
                          error: `Model '${ollamaModel}' not found. Installed: ${models.join(", ")}`,
                        }),
                  });
                } else {
                  resolve({ ok: false, error: "Unexpected response format" });
                }
              } catch {
                resolve({ ok: false, error: "Failed to parse Ollama response" });
              }
            });
          }
        );
        req2.on("error", (err: Error) => resolve({ ok: false, error: err.message }));
        req2.on("timeout", () => {
          req2.destroy();
          resolve({ ok: false, error: "Connection timed out (5s)" });
        });
        req2.end();
      }
    );

    if (result.ok) {
      res.json({ success: true, models: result.models, warning: result.error ?? null });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (error) {
    next(error);
  }
});

// List models on the Ollama server (no model name required)
router.post("/ollama-models", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ollamaUrl } = z
      .object({
        ollamaUrl: z.string().url(),
      })
      .parse(req.body);

    const tagsUrl = `${ollamaUrl}/api/tags`;
    const parsed = new URL(tagsUrl);

    const BLOCKED_HOSTS = /^(localhost|127\.|::1|0\.0\.0\.0|169\.254\.)/i;
    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      res.json({ success: false, error: "Loopback and link-local addresses are not allowed" });
      return;
    }

    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const result = await new Promise<{
      ok: boolean;
      models?: Array<{ name: string; size: number; modified: string }>;
      error?: string;
    }>((resolve) => {
      const req2 = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname,
          method: "GET",
          timeout: 5000,
        },
        (response) => {
          let data = "";
          response.on("data", (chunk: string) => {
            data += chunk;
          });
          response.on("end", () => {
            try {
              const json: unknown = JSON.parse(data);
              if (typeof json === "object" && json !== null && "models" in json) {
                const modelsArray = (json as Record<string, unknown>).models;
                const models = Array.isArray(modelsArray)
                  ? modelsArray.map((m: unknown) => {
                      const model = m as Record<string, unknown>;
                      return {
                        name: String(model.name ?? ""),
                        size: Number(model.size ?? 0),
                        modified: String(model.modified_at ?? ""),
                      };
                    })
                  : [];
                resolve({ ok: true, models });
              } else {
                resolve({ ok: false, error: "Unexpected response format" });
              }
            } catch {
              resolve({ ok: false, error: "Failed to parse Ollama response" });
            }
          });
        }
      );
      req2.on("error", (err: Error) => resolve({ ok: false, error: err.message }));
      req2.on("timeout", () => {
        req2.destroy();
        resolve({ ok: false, error: "Connection timed out (5s)" });
      });
      req2.end();
    });

    if (result.ok) {
      res.json({ success: true, models: result.models });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (error) {
    next(error);
  }
});

// Pull (download) a model on the Ollama server
router.post("/ollama-pull", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ollamaUrl, modelName } = z
      .object({
        ollamaUrl: z.string().url(),
        modelName: z.string().min(1).max(100),
      })
      .parse(req.body);

    const pullUrl = `${ollamaUrl}/api/pull`;
    const parsed = new URL(pullUrl);

    const BLOCKED_HOSTS = /^(localhost|127\.|::1|0\.0\.0\.0|169\.254\.)/i;
    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      res.json({ success: false, error: "Loopback and link-local addresses are not allowed" });
      return;
    }

    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const postBody = JSON.stringify({ name: modelName, stream: false });

    const result = await new Promise<{ ok: boolean; status?: string; error?: string }>(
      (resolve) => {
        const req2 = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname,
            method: "POST",
            timeout: 600000, // 10 minutes for large model downloads
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postBody),
            },
          },
          (response) => {
            let data = "";
            response.on("data", (chunk: string) => {
              data += chunk;
            });
            response.on("end", () => {
              try {
                // Ollama returns multiple JSON objects for progress; take the last one
                const lines = data.trim().split("\n");
                const lastLine = lines[lines.length - 1];
                const json = JSON.parse(lastLine) as Record<string, unknown>;
                if (json.status === "success" || String(json.status ?? "").includes("success")) {
                  resolve({ ok: true, status: "success" });
                } else if (json.error) {
                  resolve({ ok: false, error: String(json.error) });
                } else {
                  resolve({ ok: true, status: String(json.status ?? "pulling") });
                }
              } catch {
                resolve({ ok: false, error: "Failed to parse Ollama pull response" });
              }
            });
          }
        );
        req2.on("error", (err: Error) => resolve({ ok: false, error: err.message }));
        req2.on("timeout", () => {
          req2.destroy();
          resolve({ ok: false, error: "Pull timed out (10min)" });
        });
        req2.write(postBody);
        req2.end();
      }
    );

    if (result.ok) {
      res.json({ success: true, status: result.status });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
