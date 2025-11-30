import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Upload directories
const UPLOAD_DIR = path.join(__dirname, '../../uploads/receipts');
const EMAIL_UPLOAD_DIR = path.join(__dirname, '../../uploads/emails');

// Ensure upload directories exist
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log(`📁 Created upload directory: ${UPLOAD_DIR}`);
}
if (!fs.existsSync(EMAIL_UPLOAD_DIR)) {
  fs.mkdirSync(EMAIL_UPLOAD_DIR, { recursive: true });
  console.log(`📁 Created email upload directory: ${EMAIL_UPLOAD_DIR}`);
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

// File filter - only allow images and PDFs
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${allowedMimeTypes.join(', ')}`));
  }
};

// Configure multer
export const uploadReceipt = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

/**
 * Delete a receipt file
 */
export function deleteReceiptFile(filename: string): void {
  const filePath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`🗑️  Deleted receipt file: ${filename}`);
  }
}

/**
 * Clean up old receipt files (older than 90 days with no database reference)
 * This should be run periodically (e.g., daily cron job)
 */
export async function cleanupOldReceipts(prisma: any): Promise<number> {
  const files = fs.readdirSync(UPLOAD_DIR);
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  for (const file of files) {
    const filePath = path.join(UPLOAD_DIR, file);
    const stats = fs.statSync(filePath);

    // Skip if file is newer than 90 days
    if (stats.mtimeMs > ninetyDaysAgo) {
      continue;
    }

    // Check if file is referenced in database
    const receiptUrl = `/api/v1/uploads/receipts/${file}`;
    const referencedFlight = await prisma.flight.findFirst({
      where: { receiptUrl },
    });

    // Delete if not referenced
    if (!referencedFlight) {
      fs.unlinkSync(filePath);
      deletedCount++;
      console.log(`🗑️  Cleaned up orphaned receipt: ${file}`);
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
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});
