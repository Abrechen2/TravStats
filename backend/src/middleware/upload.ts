import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { FILE_LIMITS, CLEANUP } from '../config/constants';

// Upload directories
const UPLOAD_DIR = path.join(__dirname, '../../uploads/receipts');
const EMAIL_UPLOAD_DIR = path.join(__dirname, '../../uploads/emails');

// Ensure upload directories exist
// Wrap in try-catch to prevent startup failures if permissions are missing
try {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    logger.info({
      operation: 'upload_dir_created',
      message: `Created upload directory: ${UPLOAD_DIR}`,
      context: { directory: UPLOAD_DIR },
    });
  }
} catch (error: unknown) {
  // Log warning but don't prevent startup - directory will be created on first upload attempt
  const errMsg = error instanceof Error ? error.message : String(error);
  console.warn(`[Upload] Could not create upload directory ${UPLOAD_DIR}:`, errMsg);
  console.warn('[Upload] Uploads may fail until directory permissions are fixed');
  logger.warn({
    operation: 'upload_dir_creation_failed',
    message: `Could not create upload directory: ${UPLOAD_DIR}`,
    context: { directory: UPLOAD_DIR, error: errMsg },
  });
}

try {
  if (!fs.existsSync(EMAIL_UPLOAD_DIR)) {
    fs.mkdirSync(EMAIL_UPLOAD_DIR, { recursive: true });
    logger.info({
      operation: 'upload_email_dir_created',
      message: `Created email upload directory: ${EMAIL_UPLOAD_DIR}`,
      context: { directory: EMAIL_UPLOAD_DIR },
    });
  }
} catch (error: unknown) {
  // Log warning but don't prevent startup - directory will be created on first upload attempt
  const errMsg = error instanceof Error ? error.message : String(error);
  console.warn(`[Upload] Could not create email upload directory ${EMAIL_UPLOAD_DIR}:`, errMsg);
  console.warn('[Upload] Email uploads may fail until directory permissions are fixed');
  logger.warn({
    operation: 'upload_email_dir_creation_failed',
    message: `Could not create email upload directory: ${EMAIL_UPLOAD_DIR}`,
    context: { directory: EMAIL_UPLOAD_DIR, error: errMsg },
  });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitized}${ext}`);
  },
});

// File filter - only allow images and PDFs with magic number validation
const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type. Allowed: ${allowedMimeTypes.join(', ')}`));
  }

  // Note: Magic number validation happens after file is saved
  // We'll validate in the route handler after multer processes the file
  cb(null, true);
};

// Configure multer
export const uploadReceipt = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: FILE_LIMITS.RECEIPT_MAX_SIZE,
  },
});

/**
 * Delete a receipt file
 */
export function deleteReceiptFile(filename: string): void {
  const filePath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      logger.debug({
        operation: 'upload_receipt_deleted',
        message: `Deleted receipt file: ${filename}`,
        context: { filename },
      });
    } catch (error) {
      // Log warning but don't throw - file might already be deleted
      logger.warn({
        operation: 'upload_receipt_delete_error',
        message: `Failed to delete receipt file: ${filename}`,
        context: { filename, error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }
}

/**
 * Clean up old receipt files (older than retention period with no database reference)
 * This should be run periodically (e.g., daily cron job)
 */
export async function cleanupOldReceipts(prisma: PrismaClient): Promise<number> {
  const files = fs.readdirSync(UPLOAD_DIR);
  const retentionMs = CLEANUP.RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - retentionMs;
  let deletedCount = 0;

  for (const file of files) {
    const filePath = path.join(UPLOAD_DIR, file);
    const stats = fs.statSync(filePath);

    // Skip if file is newer than retention period
    if (stats.mtimeMs > cutoffTime) {
      continue;
    }

    // Check if file is referenced in the database — via a flight OR a
    // lodging stay (a lodging-only receipt must not be treated as orphaned
    // just because no flight references it; same gap fixed in routes/uploads.ts).
    const receiptUrl = `/api/v1/uploads/receipts/${file}`;
    const [referencedFlight, referencedStay] = await Promise.all([
      prisma.flight.findFirst({ where: { receiptUrl } }),
      prisma.lodgingStay.findFirst({ where: { receiptUrl } }),
    ]);

    // Delete if not referenced
    if (!referencedFlight && !referencedStay) {
      try {
        fs.unlinkSync(filePath);
        deletedCount++;
        logger.debug({
          operation: 'upload_receipt_cleanup',
          message: `Cleaned up orphaned receipt: ${file}`,
          context: { filename: file },
        });
      } catch (error) {
        // Log warning but don't fail cleanup process
        logger.warn({
          operation: 'upload_receipt_cleanup_error',
          message: `Failed to delete receipt file: ${file}`,
          error: error instanceof Error ? error.message : 'Unknown error',
          context: { filename: file },
        });
      }
    }
  }

  return deletedCount;
}

/**
 * Get upload directory path
 */
export function getUploadDir(): string {
  return UPLOAD_DIR;
}

// Email file storage configuration
const emailStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, EMAIL_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitized}${ext}`);
  },
});

// Email file filter - allow .eml, .txt, .msg
const emailFileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void => {
  const allowedMimeTypes = [
    'message/rfc822', // .eml files
    'text/plain', // .txt files
    'application/vnd.ms-outlook', // .msg files
    'application/octet-stream', // fallback for .msg
  ];

  const allowedExtensions = ['.eml', '.txt', '.msg'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    // Note: Magic number validation happens after file is saved
    // We'll validate in the route handler after multer processes the file
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: .eml, .txt, .msg files`));
  }
};

// Configure multer for email uploads
export const uploadEmailFile = multer({
  storage: emailStorage,
  fileFilter: emailFileFilter,
  limits: {
    fileSize: FILE_LIMITS.EMAIL_MAX_SIZE,
  },
});

export function getEmailUploadDir(): string {
  return EMAIL_UPLOAD_DIR;
}

// =============== Trip photos (iter 7) ===============

const TRIP_PHOTO_DIR = path.join(__dirname, '../../uploads/trip-photos');

try {
  if (!fs.existsSync(TRIP_PHOTO_DIR)) {
    fs.mkdirSync(TRIP_PHOTO_DIR, { recursive: true });
  }
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  logger.warn({
    operation: 'upload_trip_photo_dir_creation_failed',
    message: `Could not create trip photo directory: ${TRIP_PHOTO_DIR}`,
    context: { directory: TRIP_PHOTO_DIR, error: errMsg },
  });
}

const tripPhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TRIP_PHOTO_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname).toLowerCase();
    const basename = path.basename(file.originalname, ext);
    const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
    cb(null, `${uniqueSuffix}-${sanitized}${ext}`);
  },
});

const tripPhotoFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error(`Invalid image type. Allowed: ${allowed.join(', ')}`));
  }
  cb(null, true);
};

export const uploadTripPhotos = multer({
  storage: tripPhotoStorage,
  fileFilter: tripPhotoFilter,
  limits: {
    fileSize: FILE_LIMITS.TRIP_PHOTO_MAX_SIZE,
    files: FILE_LIMITS.TRIP_PHOTO_MAX_COUNT,
  },
});

export const uploadTripCover = multer({
  storage: tripPhotoStorage,
  fileFilter: tripPhotoFilter,
  limits: {
    fileSize: FILE_LIMITS.TRIP_PHOTO_MAX_SIZE,
  },
});

export function getTripPhotoDir(): string {
  return TRIP_PHOTO_DIR;
}

export function deleteTripPhotoFile(filename: string): void {
  const filePath = path.join(TRIP_PHOTO_DIR, path.basename(filename));
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      logger.warn({
        operation: 'upload_trip_photo_delete_error',
        message: `Failed to delete trip photo file: ${filename}`,
        context: { filename, error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }
}

// =============== Place visit photos (POI phase C) ===============
//
// Its OWN directory rather than a shared one with trip photos. The two have
// different owners and different lifetimes — a place photo dies with its visit,
// a trip photo with its trip — and a shared directory would make a future
// cleanup sweep have to know which rows point where before it may delete a
// byte. Same storage and filter rules otherwise; a photo is a photo.

const PLACE_PHOTO_DIR = path.join(__dirname, '../../uploads/place-photos');

try {
  if (!fs.existsSync(PLACE_PHOTO_DIR)) {
    fs.mkdirSync(PLACE_PHOTO_DIR, { recursive: true });
  }
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  logger.warn({
    operation: 'upload_place_photo_dir_creation_failed',
    message: `Could not create place photo directory: ${PLACE_PHOTO_DIR}`,
    context: { directory: PLACE_PHOTO_DIR, error: errMsg },
  });
}

const placePhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, PLACE_PHOTO_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname).toLowerCase();
    const basename = path.basename(file.originalname, ext);
    const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
    cb(null, `${uniqueSuffix}-${sanitized}${ext}`);
  },
});

export const uploadPlacePhotos = multer({
  storage: placePhotoStorage,
  fileFilter: tripPhotoFilter,
  limits: {
    fileSize: FILE_LIMITS.TRIP_PHOTO_MAX_SIZE,
    files: FILE_LIMITS.TRIP_PHOTO_MAX_COUNT,
  },
});

export function getPlacePhotoDir(): string {
  return PLACE_PHOTO_DIR;
}

export function deletePlacePhotoFile(filename: string): void {
  const filePath = path.join(PLACE_PHOTO_DIR, path.basename(filename));
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      logger.warn({
        operation: 'upload_place_photo_delete_error',
        message: `Failed to delete place photo file: ${filename}`,
        context: { filename, error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }
}

// =============== Profile pictures (issue #186) ===============

const PROFILE_PICTURE_DIR = path.join(__dirname, '../../uploads/profile-pictures');

try {
  if (!fs.existsSync(PROFILE_PICTURE_DIR)) {
    fs.mkdirSync(PROFILE_PICTURE_DIR, { recursive: true });
  }
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  logger.warn({
    operation: 'upload_profile_picture_dir_creation_failed',
    message: `Could not create profile picture directory: ${PROFILE_PICTURE_DIR}`,
    context: { directory: PROFILE_PICTURE_DIR, error: errMsg },
  });
}

// The requesting user's id is embedded as the filename prefix (separated by
// "_", which never appears in a UUID) so the GET route can enforce
// ownership from the filename alone, without a database lookup — there is
// no per-avatar DB row (profilePicture is a JSON field on UserSettings).
const profilePictureStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, PROFILE_PICTURE_DIR);
  },
  filename: (req, file, cb) => {
    const userId = (req as { userId?: string }).userId ?? 'unknown';
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${userId}_${uniqueSuffix}${ext}`);
  },
});

const profilePictureFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error(`Invalid image type. Allowed: ${allowed.join(', ')}`));
  }
  cb(null, true);
};

export const uploadProfilePicture = multer({
  storage: profilePictureStorage,
  fileFilter: profilePictureFilter,
  limits: {
    fileSize: FILE_LIMITS.PROFILE_PICTURE_MAX_SIZE,
  },
});

export function getProfilePictureDir(): string {
  return PROFILE_PICTURE_DIR;
}

export function deleteProfilePictureFile(filename: string): void {
  const filePath = path.join(PROFILE_PICTURE_DIR, path.basename(filename));
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      logger.warn({
        operation: 'upload_profile_picture_delete_error',
        message: `Failed to delete profile picture file: ${filename}`,
        context: { filename, error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }
}
