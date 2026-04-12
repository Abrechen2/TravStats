import { Router, Response, NextFunction } from 'express';
import https from 'https';
import http from 'http';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

interface ParserSettingsUpdateData {
  allowUserApiKeys?: boolean;
  defaultVisionParser?: string;
  defaultTextParser?: string;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
}

const parserSettingsSchema = z.object({
  allowUserApiKeys: z.boolean().optional(),
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
    const { allowUserApiKeys, defaultVisionParser, defaultTextParser, ollamaUrl, ollamaModel } =
      parserSettingsSchema.parse(req.body);

    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: ParserSettingsUpdateData = {};

    if (allowUserApiKeys !== undefined) {
      updateData.allowUserApiKeys = allowUserApiKeys;
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

export default router;
