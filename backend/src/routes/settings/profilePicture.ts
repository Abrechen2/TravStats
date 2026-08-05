import { Router, Response, NextFunction, Request } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import {
  uploadProfilePicture,
  deleteProfilePictureFile,
  getProfilePictureDir,
} from '../../middleware/upload';
import { uploadProfilePictureLimiter } from '../../middleware/rateLimit';
import { AppError } from '../../middleware/errorHandler';
import { validateProfilePictureFile } from '../../utils/fileValidation';
import { prisma } from '../../db';
import logger from '../../utils/logger';
import { SettingsDataJson, defaultSettings } from './types';

const router = Router();

/**
 * POST /api/v1/settings/profile-picture
 * Upload (or replace) the current user's avatar. The previous avatar file,
 * if any, is deleted once the new one is safely persisted (see issue #186 —
 * the old feature never had a backend route at all, which is why the
 * frontend fell back to a doomed `blob:` URL).
 */
router.post(
  '/',
  uploadProfilePictureLimiter,
  // Wrap multer manually so oversized / invalid-mimetype uploads surface as
  // a normal 400 AppError instead of falling through to the generic 500
  // path the shared errorHandler uses for unrecognised MulterError objects.
  (req: Request, res: Response, next: NextFunction) => {
    uploadProfilePicture.single('profilePicture')(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('File too large. Maximum size is 5 MB.', 400));
        }
        const message = err instanceof Error ? err.message : 'Upload failed';
        return next(new AppError(message, 400));
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    let filePath: string | undefined;
    try {
      const userId = req.userId!;

      if (!req.file) {
        throw new AppError('No file uploaded', 400);
      }
      // Rebuild the cleanup path from the trusted upload dir + the basename of
      // multer's server-generated filename, never the raw req.file.path. The
      // filename is already server-side (userId_timestamp-random+ext), so this
      // is defense-in-depth, and it clears the CodeQL js/path-injection taint
      // on the fs.unlinkSync cleanup below.
      filePath = path.join(getProfilePictureDir(), path.basename(req.file.filename));

      // Magic-number validation — never trust the client-supplied mimetype.
      const validation = validateProfilePictureFile(filePath, req.file.mimetype);
      if (!validation.valid) {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        logger.warn({
          operation: 'profile_picture_upload_validation_failed',
          message: 'Profile picture validation failed',
          context: {
            userId,
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            reason: validation.reason,
          },
        });
        throw new AppError(`File validation failed: ${validation.reason}`, 400);
      }

      const profilePictureUrl = `/api/v1/settings/profile-picture/${req.file.filename}`;

      // Look up any previous avatar so it can be deleted after the new one
      // is safely persisted — otherwise every replacement leaks a file.
      const existing = await prisma.userSettings.findUnique({ where: { userId } });
      const existingData = (
        typeof existing?.data === 'object' && existing.data !== null
          ? (existing.data as SettingsDataJson)
          : {}
      );
      const previousUrl = existingData.profile?.profilePicture;

      const merged: SettingsDataJson = {
        ...defaultSettings,
        ...existingData,
        profile: {
          ...defaultSettings.profile,
          ...existingData.profile,
          profilePicture: profilePictureUrl,
        },
      };

      await prisma.userSettings.upsert({
        where: { userId },
        update: { data: merged as Prisma.InputJsonValue },
        create: {
          userId,
          data: merged as Prisma.InputJsonValue,
          autoUpdateEnabled: false,
          autoUpdateRequireApproval: true,
          autoUpdateCheckInterval: 15,
          autoUpdateOnlyDuringFlight: true,
          autoUpdateExpiryHours: 24,
          boardingPassParserStrategy: null,
          historicalEnrichmentEnabled: false,
          historicalEnrichmentMinConfidence: 60,
          historicalEnrichmentMaxPerDay: 50,
          enabledDomains: ['flight'],
        },
      });

      // Delete the old file only after the new one is committed, and only
      // if it's actually a locally-served avatar (not a legacy external URL).
      if (
        previousUrl &&
        typeof previousUrl === 'string' &&
        previousUrl.startsWith('/api/v1/settings/profile-picture/')
      ) {
        const previousFilename = previousUrl.split('/').pop();
        if (previousFilename && previousFilename !== req.file.filename) {
          deleteProfilePictureFile(previousFilename);
        }
      }

      res.status(201).json({ profilePictureUrl });
    } catch (error) {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (_cleanupError) {
          logger.error({
            operation: 'profile_picture_upload_cleanup_error',
            message: 'Failed to cleanup file after error',
            context: { filePath },
          });
        }
      }
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/settings/profile-picture
 * Remove the current user's avatar: null the settings field first, then
 * delete the file (same commit-before-cleanup order as the upload's
 * replacement path). Idempotent — deleting with no avatar set is a 200
 * no-op, so the UI never has to special-case "was there one?".
 */
router.delete(
  '/',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const existing = await prisma.userSettings.findUnique({ where: { userId } });
      const existingData =
        typeof existing?.data === 'object' && existing.data !== null
          ? (existing.data as SettingsDataJson)
          : {};
      const previousUrl = existingData.profile?.profilePicture;

      if (existing && previousUrl) {
        const merged: SettingsDataJson = {
          ...existingData,
          profile: {
            ...existingData.profile,
            profilePicture: null,
          },
        };
        await prisma.userSettings.update({
          where: { userId },
          data: { data: merged as Prisma.InputJsonValue },
        });
      }

      if (
        previousUrl &&
        typeof previousUrl === 'string' &&
        previousUrl.startsWith('/api/v1/settings/profile-picture/')
      ) {
        const previousFilename = previousUrl.split('/').pop();
        if (previousFilename) {
          deleteProfilePictureFile(previousFilename);
        }
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/settings/profile-picture/:filename
 * Serve an uploaded avatar. Ownership is enforced from the filename itself
 * — the requesting user's id is baked in as the prefix at upload time
 * (see middleware/upload.ts), so a user cannot fetch another user's avatar
 * by guessing a filename.
 */
router.get(
  '/:filename',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { filename } = req.params;

      // Sanitize to prevent directory traversal.
      const sanitized = path.basename(filename);

      const ownerId = sanitized.split('_')[0];
      if (!ownerId || ownerId !== userId) {
        throw new AppError('File not found or access denied', 404);
      }

      const filePath = path.join(getProfilePictureDir(), sanitized);
      if (!fs.existsSync(filePath)) {
        throw new AppError('File not found', 404);
      }

      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
