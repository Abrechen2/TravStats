import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import {
  getInstanceSettings,
  updateInstanceSettings,
  getWebDAVSettings,
  updateWebDAVSettings,
} from '../../services/instanceSettingsService';
import { testConnection as testWebDAVConnection } from '../../services/cloudSyncService';
import { isValidRpId, passkeyUnavailableReason } from '../../services/webauthn/rpConfig';

const router = Router();

// ---------- Instance (name / maxUsers / allowRegistration / frontendUrl) ----------

const instancePatchSchema = z.object({
  instanceName: z.string().trim().max(100).optional(),
  maxUsers: z.number().int().min(1).max(1000).optional(),
  allowRegistration: z.boolean().optional(),
  frontendUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid http(s) URL')
    .optional(),
  publicUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid http(s) URL')
    .optional(),
  lanUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid http(s) URL')
    .optional(),
  // Geocoder endpoints (Photon search, Nominatim one-shot geocode). Empty
  // string clears the DB override, reverting to ENV/default.
  photonUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid http(s) URL')
    .optional(),
  nominatimUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid http(s) URL')
    .optional(),
  // WebAuthn relying party. Validated hard HERE rather than at the ceremony:
  // a credential is bound to the rpId forever, so a typo saved today mints
  // passkeys that the browser silently refuses tomorrow.
  webauthnRpId: z
    .string()
    .trim()
    .max(253)
    .refine((v) => v === '' || isValidRpId(v), 'Must be a bare domain — not a URL and not an IP')
    .optional(),
  webauthnOrigins: z
    .array(z.string().trim().max(500))
    .max(10)
    .optional()
    .transform((list) => list?.filter((entry) => entry.length > 0))
    .refine(
      (list) => list === undefined || list.every((entry) => /^https?:\/\//.test(entry)),
      'Each origin must be a valid http(s) URL'
    ),
  // Instance-level beta gate. No admin UI on purpose — curl / PAT is the
  // intended way to flip it (ON for RC + Beta servers, OFF for production).
  // Every logged-in user reads the resulting value read-only via
  // GET /api/v1/settings; only this admin-guarded route can write it.
  betaFeaturesEnabled: z.boolean().optional(),
});

/**
 * Whether the saved configuration actually yields working passkeys, derived
 * rather than stored. Returned alongside the settings so the admin form can
 * report the truth after a save instead of re-implementing the secure-context
 * rule in the browser and drifting from it.
 */
function passkeyStatusOf(settings: {
  webauthnRpId: string | null;
  webauthnOrigins: string[];
  publicUrl: string | null;
}): { usable: boolean; reason: string | null } {
  const primary = settings.webauthnOrigins[0] ?? settings.publicUrl ?? null;
  const reason = passkeyUnavailableReason(primary);
  if (reason !== null) return { usable: false, reason };

  const rpId = settings.webauthnRpId ?? new URL(primary!).hostname;
  if (!isValidRpId(rpId)) return { usable: false, reason: 'invalidRpId' };
  return { usable: true, reason: null };
}

router.get('/instance-settings', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await getInstanceSettings();
    res.json({ settings, passkeyStatus: passkeyStatusOf(settings) });
  } catch (error) {
    next(error);
  }
});

router.put('/instance-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const patch = instancePatchSchema.parse(req.body);
    const settings = await updateInstanceSettings({
      ...(patch.instanceName !== undefined && { instanceName: patch.instanceName }),
      ...(patch.maxUsers !== undefined && { maxUsers: patch.maxUsers }),
      ...(patch.allowRegistration !== undefined && { allowRegistration: patch.allowRegistration }),
      ...(patch.frontendUrl !== undefined && {
        frontendUrl: patch.frontendUrl === '' ? null : patch.frontendUrl,
      }),
      ...(patch.publicUrl !== undefined && {
        publicUrl: patch.publicUrl === '' ? null : patch.publicUrl,
      }),
      ...(patch.lanUrl !== undefined && {
        lanUrl: patch.lanUrl === '' ? null : patch.lanUrl,
      }),
      ...(patch.photonUrl !== undefined && {
        photonUrl: patch.photonUrl === '' ? null : patch.photonUrl,
      }),
      ...(patch.nominatimUrl !== undefined && {
        nominatimUrl: patch.nominatimUrl === '' ? null : patch.nominatimUrl,
      }),
      ...(patch.webauthnRpId !== undefined && {
        webauthnRpId: patch.webauthnRpId === '' ? null : patch.webauthnRpId,
      }),
      ...(patch.webauthnOrigins !== undefined && {
        webauthnOrigins: patch.webauthnOrigins,
      }),
      ...(patch.betaFeaturesEnabled !== undefined && {
        betaFeaturesEnabled: patch.betaFeaturesEnabled,
      }),
    });
    res.json({ settings, passkeyStatus: passkeyStatusOf(settings) });
  } catch (error) {
    next(error);
  }
});

// ---------- WebDAV sync ----------

const webdavPatchSchema = z.object({
  enabled: z.boolean().optional(),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid http(s) URL')
    .optional(),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
  backupPath: z.string().trim().max(200).optional(),
});

router.get('/webdav-settings', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await getWebDAVSettings();
    // Never leak the password back — return a boolean marker instead.
    res.json({
      settings: {
        enabled: settings.enabled,
        url: settings.url,
        username: settings.username,
        passwordSet: Boolean(settings.password),
        backupPath: settings.backupPath,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/webdav-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const patch = webdavPatchSchema.parse(req.body);
    const settings = await updateWebDAVSettings({
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      ...(patch.url !== undefined && { url: patch.url === '' ? null : patch.url }),
      ...(patch.username !== undefined && {
        username: patch.username === '' ? null : patch.username,
      }),
      ...(patch.password !== undefined && { password: patch.password }),
      ...(patch.backupPath !== undefined && { backupPath: patch.backupPath }),
    });
    res.json({
      settings: {
        enabled: settings.enabled,
        url: settings.url,
        username: settings.username,
        passwordSet: Boolean(settings.password),
        backupPath: settings.backupPath,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/webdav-settings/test',
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { enabled } = await getWebDAVSettings();
      if (!enabled) {
        throw new AppError('WebDAV sync is disabled', 400);
      }
      const result = await testWebDAVConnection();
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
