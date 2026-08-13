import { Router, Response, NextFunction } from 'express';
import https from 'https';
import http from 'http';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

interface ParserSettingsUpdateData {
  allowUserApiKeys?: boolean;
  fxCdnFallbackEnabled?: boolean;
  defaultVisionParser?: string;
  defaultTextParser?: string;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
}

const parserSettingsSchema = z.object({
  allowUserApiKeys: z.boolean().optional(),
  // Whether a rate the ECB cannot serve may be fetched from the keyless
  // jsDelivr currency dataset. It sits with the other service settings
  // because it is the same kind of decision as the Ollama URL: which outside
  // service this instance is allowed to contact.
  fxCdnFallbackEnabled: z.boolean().optional(),
  defaultVisionParser: z.string().optional(),
  defaultTextParser: z.string().optional(),
  ollamaUrl: z.string().url("Must be a valid URL").optional().nullable(),
  ollamaModel: z.string().min(1).max(100).optional().nullable(),
});

const router = Router();

// Get admin parser settings
router.get('/parser-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let adminSettings = await prisma.adminSettings.findFirst();

    if (!adminSettings) {
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          allowUserFlightApiKeys: true,
          defaultVisionParser: 'tesseract',
          defaultTextParser: 'regex',
        },
      });
    }

    res.json({
      allowUserApiKeys: adminSettings.allowUserApiKeys,
      fxCdnFallbackEnabled: adminSettings.fxCdnFallbackEnabled,
      allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
      defaultVisionParser: adminSettings.defaultVisionParser ?? 'tesseract',
      defaultTextParser: adminSettings.defaultTextParser ?? 'regex',
      ollamaUrl: adminSettings.ollamaUrl ?? null,
      ollamaModel: adminSettings.ollamaModel ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// Update admin parser settings
router.put('/parser-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      allowUserApiKeys,
      fxCdnFallbackEnabled,
      defaultVisionParser,
      defaultTextParser,
      ollamaUrl,
      ollamaModel,
    } = parserSettingsSchema.parse(req.body);

    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: ParserSettingsUpdateData = {};

    if (allowUserApiKeys !== undefined) {
      updateData.allowUserApiKeys = allowUserApiKeys;
    }
    if (fxCdnFallbackEnabled !== undefined) {
      updateData.fxCdnFallbackEnabled = fxCdnFallbackEnabled;
    }
    if (defaultVisionParser !== undefined) {
      updateData.defaultVisionParser = defaultVisionParser;
    }
    if (defaultTextParser !== undefined) {
      updateData.defaultTextParser = defaultTextParser;
    }
    if (ollamaUrl !== undefined) {
      updateData.ollamaUrl = ollamaUrl;
    }
    if (ollamaModel !== undefined) {
      updateData.ollamaModel = ollamaModel;
    }

    if (adminSettings) {
      adminSettings = await prisma.adminSettings.update({
        where: { id: adminSettings.id },
        data: updateData,
      });
    } else {
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: allowUserApiKeys ?? true,
          allowUserFlightApiKeys: true,
          defaultVisionParser: 'tesseract',
          defaultTextParser: 'regex',
        },
      });
    }

    res.json({
      message: 'Parser settings updated successfully',
      settings: {
        allowUserApiKeys: adminSettings.allowUserApiKeys,
        fxCdnFallbackEnabled: adminSettings.fxCdnFallbackEnabled,
        defaultVisionParser: adminSettings.defaultVisionParser ?? 'tesseract',
        defaultTextParser: adminSettings.defaultTextParser ?? 'regex',
        ollamaUrl: adminSettings.ollamaUrl ?? null,
        ollamaModel: adminSettings.ollamaModel ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Test Ollama connectivity
router.post('/test-ollama', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ollamaUrl, ollamaModel } = z.object({
      ollamaUrl: z.string().url(),
      ollamaModel: z.string().min(1),
    }).parse(req.body);

    const tagsUrl = `${ollamaUrl}/api/tags`;
    const parsed = new URL(tagsUrl);

    // SSRF protection: block loopback and link-local addresses
    const BLOCKED_HOSTS = /^(localhost|127\.|::1|0\.0\.0\.0|169\.254\.)/i;
    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      res.json({ success: false, error: 'Loopback and link-local addresses are not allowed' });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const result = await new Promise<{ ok: boolean; models?: string[]; error?: string }>((resolve) => {
      const req2 = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname,
          method: 'GET',
          timeout: 5000,
        },
        (response) => {
          let data = '';
          response.on('data', (chunk: string) => { data += chunk; });
          response.on('end', () => {
            try {
              const json: unknown = JSON.parse(data);
              if (typeof json === 'object' && json !== null && 'models' in json) {
                const modelsArray = (json as Record<string, unknown>).models;
                const models = Array.isArray(modelsArray)
                  ? modelsArray.map((m: unknown) => {
                      if (typeof m === 'object' && m !== null && 'name' in m) {
                        return String((m as Record<string, unknown>).name);
                      }
                      return String(m);
                    })
                  : [];
                const modelInstalled = models.some((m) => m.startsWith(ollamaModel));
                resolve({
                  ok: true,
                  models,
                  ...(modelInstalled ? {} : { error: `Model '${ollamaModel}' not found. Installed: ${models.join(', ')}` }),
                });
              } else {
                resolve({ ok: false, error: 'Unexpected response format' });
              }
            } catch {
              resolve({ ok: false, error: 'Failed to parse Ollama response' });
            }
          });
        }
      );
      req2.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
      req2.on('timeout', () => { req2.destroy(); resolve({ ok: false, error: 'Connection timed out (5s)' }); });
      req2.end();
    });

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
router.post('/ollama-models', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ollamaUrl } = z.object({
      ollamaUrl: z.string().url(),
    }).parse(req.body);

    const tagsUrl = `${ollamaUrl}/api/tags`;
    const parsed = new URL(tagsUrl);

    const BLOCKED_HOSTS = /^(localhost|127\.|::1|0\.0\.0\.0|169\.254\.)/i;
    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      res.json({ success: false, error: 'Loopback and link-local addresses are not allowed' });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const result = await new Promise<{ ok: boolean; models?: Array<{ name: string; size: number; modified: string }>; error?: string }>((resolve) => {
      const req2 = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname,
          method: 'GET',
          timeout: 5000,
        },
        (response) => {
          let data = '';
          response.on('data', (chunk: string) => { data += chunk; });
          response.on('end', () => {
            try {
              const json: unknown = JSON.parse(data);
              if (typeof json === 'object' && json !== null && 'models' in json) {
                const modelsArray = (json as Record<string, unknown>).models;
                const models = Array.isArray(modelsArray)
                  ? modelsArray.map((m: unknown) => {
                      const model = m as Record<string, unknown>;
                      return {
                        name: String(model.name ?? ''),
                        size: Number(model.size ?? 0),
                        modified: String(model.modified_at ?? ''),
                      };
                    })
                  : [];
                resolve({ ok: true, models });
              } else {
                resolve({ ok: false, error: 'Unexpected response format' });
              }
            } catch {
              resolve({ ok: false, error: 'Failed to parse Ollama response' });
            }
          });
        }
      );
      req2.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
      req2.on('timeout', () => { req2.destroy(); resolve({ ok: false, error: 'Connection timed out (5s)' }); });
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
router.post('/ollama-pull', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ollamaUrl, modelName } = z.object({
      ollamaUrl: z.string().url(),
      modelName: z.string().min(1).max(100),
    }).parse(req.body);

    const pullUrl = `${ollamaUrl}/api/pull`;
    const parsed = new URL(pullUrl);

    const BLOCKED_HOSTS = /^(localhost|127\.|::1|0\.0\.0\.0|169\.254\.)/i;
    if (BLOCKED_HOSTS.test(parsed.hostname)) {
      res.json({ success: false, error: 'Loopback and link-local addresses are not allowed' });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const postBody = JSON.stringify({ name: modelName, stream: false });

    const result = await new Promise<{ ok: boolean; status?: string; error?: string }>((resolve) => {
      const req2 = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname,
          method: 'POST',
          timeout: 600000, // 10 minutes for large model downloads
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postBody),
          },
        },
        (response) => {
          let data = '';
          response.on('data', (chunk: string) => { data += chunk; });
          response.on('end', () => {
            try {
              // Ollama returns multiple JSON objects for progress; take the last one
              const lines = data.trim().split('\n');
              const lastLine = lines[lines.length - 1];
              const json = JSON.parse(lastLine) as Record<string, unknown>;
              if (json.status === 'success' || String(json.status ?? '').includes('success')) {
                resolve({ ok: true, status: 'success' });
              } else if (json.error) {
                resolve({ ok: false, error: String(json.error) });
              } else {
                resolve({ ok: true, status: String(json.status ?? 'pulling') });
              }
            } catch {
              resolve({ ok: false, error: 'Failed to parse Ollama pull response' });
            }
          });
        }
      );
      req2.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
      req2.on('timeout', () => { req2.destroy(); resolve({ ok: false, error: 'Pull timed out (10min)' }); });
      req2.write(postBody);
      req2.end();
    });

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
