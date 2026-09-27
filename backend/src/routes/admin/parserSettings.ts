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
import { checkLlmBaseUrl } from "../../services/llm/llmEndpoint";
import { LLM_PROVIDER_KINDS, llmProbe } from "../../services/llm/llmProvider";
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
  llmProvider?: string;
  openaiCompatBaseUrl?: string | null;
  openaiCompatModel?: string | null;
  openaiCompatApiKey?: string | null;
  llmCloudOptIn?: boolean;
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

/** The settings as the admin page reads them — the key only ever masked. */
function serializeParserSettings(settings: AdminSettings) {
  return {
    allowUserApiKeys: settings.allowUserApiKeys,
    fxCdnFallbackEnabled: settings.fxCdnFallbackEnabled,
    allowUserFlightApiKeys: settings.allowUserFlightApiKeys,
    parserOrder: settings.parserOrder ?? "template_first",
    llmEnabled: settings.llmEnabled,
    ollamaUrl: settings.ollamaUrl ?? null,
    ollamaModel: settings.ollamaModel ?? null,
    llmProvider: settings.llmProvider,
    openaiCompatBaseUrl: settings.openaiCompatBaseUrl ?? null,
    openaiCompatModel: settings.openaiCompatModel ?? null,
    openaiCompatApiKey: maskKey(settings.openaiCompatApiKey) ?? null,
    openaiCompatIsCloud: providerIsCloud(settings),
    llmCloudOptIn: settings.llmCloudOptIn,
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
  // Which protocol the model speaks (`llm/llmProvider.ts`). Ollama stays the
  // default; an OpenAI-compatible endpoint is chosen explicitly.
  llmProvider: z.enum(LLM_PROVIDER_KINDS).optional(),
  openaiCompatBaseUrl: z.string().max(500).optional().nullable(),
  openaiCompatModel: z.string().max(200).optional().nullable(),
  // Masked echo ("abcd****wxyz") = unchanged; "" / null = clear.
  openaiCompatApiKey: z.string().max(1000).optional().nullable(),
  // Consent to send booking documents to a provider outside the local network.
  llmCloudOptIn: z.boolean().optional(),
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
      llmProvider,
      openaiCompatBaseUrl,
      openaiCompatModel,
      openaiCompatApiKey,
      llmCloudOptIn,
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
    if (llmProvider !== undefined) updateData.llmProvider = llmProvider;
    const baseUrl = normalizeProviderBaseUrl(openaiCompatBaseUrl);
    if (baseUrl !== undefined) updateData.openaiCompatBaseUrl = baseUrl;
    if (openaiCompatModel !== undefined) {
      updateData.openaiCompatModel = openaiCompatModel?.trim() || null;
    }
    if (openaiCompatApiKey !== undefined) {
      const encrypted = encryptUnlessMasked(openaiCompatApiKey);
      if (encrypted !== undefined) updateData.openaiCompatApiKey = encrypted;
    }
    if (llmCloudOptIn !== undefined) updateData.llmCloudOptIn = llmCloudOptIn;

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
 * "Verbindung testen" for an OpenAI-compatible provider: `GET {baseUrl}/models`
 * with the key. It carries no document — only the key — so it runs before the
 * cloud opt-in, which is exactly when an admin needs it. The answer is a
 * stable `errorCode` the UI words; `detail` is the protocol/status line
 * (never a response body, never the key). `ok`, not `success`: this router
 * is in the bare family (ADR 0001), and its frozen envelope leaks only shrink.
 */
router.post("/test-llm-provider", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { baseUrl, model, apiKey } = z
      .object({
        baseUrl: z.string().min(1).max(500),
        model: z.string().max(200).optional().nullable(),
        apiKey: z.string().max(1000).optional().nullable(),
      })
      .parse(req.body);

    const check = checkLlmBaseUrl(baseUrl);
    if (!check.ok) {
      res.json({ ok: false, errorCode: check.problem });
      return;
    }
    let key = apiKey ?? null;
    if (looksMasked(key)) {
      const stored = await prisma.adminSettings.findUnique({
        where: { id: await ensureAdminSettingsRow() },
        select: { openaiCompatApiKey: true },
      });
      key = decryptApiKey(stored?.openaiCompatApiKey ?? null);
    }

    const probe = await llmProbe({
      kind: "openai_compatible",
      url: check.url,
      model: model ?? "",
      ...(key ? { apiKey: key } : {}),
      isCloud: !check.isLocal,
    });
    if (!probe.reachable) {
      const auth = /HTTP 40[13]\b/.test(probe.error ?? "");
      res.json({
        ok: false,
        errorCode: auth ? "auth" : "unreachable",
        detail: probe.error ?? null,
        isCloud: !check.isLocal,
      });
      return;
    }
    const wanted = model?.trim();
    res.json({
      ok: true,
      isCloud: !check.isLocal,
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
