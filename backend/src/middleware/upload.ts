import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import logger from '../utils/logger';
import { validateReceiptFile, validateEmailFile, validateBoardingPassImage } from '../utils/fileValidation';
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
} catch (error: any) {
  // Log warning but don't prevent startup - directory will be created on first upload attempt
  console.warn(`[Upload] Could not create upload directory ${UPLOAD_DIR}:`, error?.message || error);
  console.warn('[Upload] Uploads may fail until directory permissions are fixed');
  logger.warn({
    operation: 'upload_dir_creation_failed',
    message: `Could not create upload directory: ${UPLOAD_DIR}`,
    context: { directory: UPLOAD_DIR, error: error?.message || 'Unknown error' },
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
} catch (error: any) {
  // Log warning but don't prevent startup - directory will be created on first upload attempt
  console.warn(`[Upload] Could not create email upload directory ${EMAIL_UPLOAD_DIR}:`, error?.message || error);
  console.warn('[Upload] Email uploads may fail until directory permissions are fixed');
  logger.warn({
    operation: 'upload_email_dir_creation_failed',
    message: `Could not create email upload directory: ${EMAIL_UPLOAD_DIR}`,
    context: { directory: EMAIL_UPLOAD_DIR, error: error?.message || 'Unknown error' },
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
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
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
export async function cleanupOldReceipts(prisma: any): Promise<number> {
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

    // Check if file is referenced in database
    const receiptUrl = `/api/v1/uploads/receipts/${file}`;
    const referencedFlight = await prisma.flight.findFirst({
      where: { receiptUrl },
    });

    // Delete if not referenced
    if (!referencedFlight) {
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
const emailFileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
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
