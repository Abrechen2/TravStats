/**
 * File validation utilities using Magic Numbers (file signatures)
 * This provides more secure file type validation than MIME types alone
 */

import fs from 'fs';
import logger from './logger';
import { SECURITY, FILE_LIMITS } from '../config/constants';

// Magic numbers (file signatures) for different file types
const FILE_SIGNATURES: Record<string, Array<{ offset: number; bytes: number[] }>> = {
  // Image formats
  'image/jpeg': [
    { offset: 0, bytes: [0xff, 0xd8, 0xff] }, // JPEG
  ],
  'image/png': [
    { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, // PNG
  ],
  'image/gif': [
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP (at offset 8)
  ],
  // PDF
  'application/pdf': [
    { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ],
  // Email formats
  'message/rfc822': [
    // .eml files - check for common email headers
    { offset: 0, bytes: [0x46, 0x72, 0x6f, 0x6d] }, // "From"
    { offset: 0, bytes: [0x52, 0x65, 0x74, 0x75, 0x72, 0x6e] }, // "Return"
    { offset: 0, bytes: [0x44, 0x65, 0x6c, 0x69, 0x76, 0x65, 0x72, 0x65, 0x64] }, // "Delivered"
  ],
  // Outlook .msg files (OLE2 format)
  'application/vnd.ms-outlook': [
    { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }, // OLE2 signature
  ],
};

/**
 * Read file signature (first bytes) from file path
 */
function readFileSignature(filePath: string, maxBytes: number = SECURITY.MAGIC_NUMBER_READ_BYTES): Buffer | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    fs.closeSync(fd);

    if (bytesRead < maxBytes) {
      return buffer.subarray(0, bytesRead);
    }
    return buffer;
  } catch (error) {
    logger.error({
      operation: 'file_signature_read_error',
      message: 'Failed to read file signature',
      context: { filePath },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

/**
 * Read file signature from buffer
 */
function readFileSignatureFromBuffer(buffer: Buffer, maxBytes: number = SECURITY.MAGIC_NUMBER_READ_BYTES): Buffer {
  return buffer.subarray(0, Math.min(maxBytes, buffer.length));
}

/**
 * Check if file signature matches expected magic numbers
 */
function matchesSignature(buffer: Buffer, signatures: Array<{ offset: number; bytes: number[] }>): boolean {
  for (const sig of signatures) {
    if (sig.offset + sig.bytes.length > buffer.length) {
      continue; // Not enough bytes to check this signature
    }

    const slice = buffer.subarray(sig.offset, sig.offset + sig.bytes.length);
    let matches = true;

    for (let i = 0; i < sig.bytes.length; i++) {
      if (slice[i] !== sig.bytes[i]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

/**
 * Validate file type using magic numbers
 * @param filePath Path to file
 * @param expectedMimeType Expected MIME type
 * @returns true if file signature matches expected type
 */
export function validateFileType(filePath: string, expectedMimeType: string): boolean {
  const signatures = FILE_SIGNATURES[expectedMimeType];
  if (!signatures) {
    // No magic number validation available for this type
    // Fall back to MIME type check only
    logger.warn({
      operation: 'file_validation_no_signature',
      message: `No magic number signature defined for ${expectedMimeType}`,
      context: { mimeType: expectedMimeType },
    });
    return true; // Allow if no signature defined (backward compatibility)
  }

  const signature = readFileSignature(filePath, SECURITY.MAGIC_NUMBER_READ_BYTES);
  if (!signature) {
    return false;
  }

  return matchesSignature(signature, signatures);
}

/**
 * Validate file type from buffer using magic numbers
 * @param buffer File buffer
 * @param expectedMimeType Expected MIME type
 * @returns true if file signature matches expected type
 */
export function validateFileTypeFromBuffer(buffer: Buffer, expectedMimeType: string): boolean {
  const signatures = FILE_SIGNATURES[expectedMimeType];
  if (!signatures) {
    // No magic number validation available for this type
    return true; // Allow if no signature defined
  }

  const signature = readFileSignatureFromBuffer(buffer, 32);
  return matchesSignature(signature, signatures);
}

/**
 * Get file type from magic numbers
 * @param filePath Path to file
 * @returns Detected MIME type or null
 */
export function detectFileType(filePath: string): string | null {
  const signature = readFileSignature(filePath, SECURITY.MAGIC_NUMBER_READ_BYTES);
  if (!signature) {
    return null;
  }

  for (const [mimeType, signatures] of Object.entries(FILE_SIGNATURES)) {
    if (matchesSignature(signature, signatures)) {
      return mimeType;
    }
  }

  return null;
}

/**
 * Get file type from buffer using magic numbers
 * @param buffer File buffer
 * @returns Detected MIME type or null
 */
export function detectFileTypeFromBuffer(buffer: Buffer): string | null {
  const signature = readFileSignatureFromBuffer(buffer, SECURITY.MAGIC_NUMBER_READ_BYTES);

  for (const [mimeType, signatures] of Object.entries(FILE_SIGNATURES)) {
    if (matchesSignature(signature, signatures)) {
      return mimeType;
    }
  }

  return null;
}

/**
 * Validate receipt file (images and PDFs)
 */
export function validateReceiptFile(filePath: string, declaredMimeType: string): { valid: boolean; reason?: string } {
  // First check MIME type
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
  ];

  if (!allowedMimeTypes.includes(declaredMimeType)) {
    return { valid: false, reason: `Invalid MIME type: ${declaredMimeType}` };
  }

  // Then validate with magic numbers
  if (!validateFileType(filePath, declaredMimeType)) {
    const detectedType = detectFileType(filePath);
    return {
      valid: false,
      reason: `File signature does not match declared type. Declared: ${declaredMimeType}, Detected: ${detectedType || 'unknown'}`,
    };
  }

  return { valid: true };
}

/**
 * Validate email file (.eml, .txt, .msg)
 */
export function validateEmailFile(filePath: string, declaredMimeType: string, extension: string): { valid: boolean; reason?: string } {
  const allowedExtensions = ['.eml', '.txt', '.msg'];
  const ext = extension.toLowerCase();

  if (!allowedExtensions.includes(ext)) {
    return { valid: false, reason: `Invalid file extension: ${ext}` };
  }

  // For .msg files, validate OLE2 signature
  if (ext === '.msg') {
    if (!validateFileType(filePath, 'application/vnd.ms-outlook')) {
      return { valid: false, reason: 'Invalid .msg file: does not match OLE2 format' };
    }
  }

  // For .eml files, check for email headers (optional - some .eml files might be valid without From header)
  if (ext === '.eml') {
    // More lenient validation - just check if it's text-based
    const signature = readFileSignature(filePath, 512);
    if (signature) {
      // Check if it contains printable ASCII or UTF-8
      const text = signature.toString('utf-8', 0, Math.min(SECURITY.MAGIC_NUMBER_READ_BYTES_TEXT, signature.length));
      // Allow if it looks like text (contains common email keywords or is mostly printable)
      const hasEmailKeywords = /(From|To|Subject|Date|Message-ID)/i.test(text);
      if (!hasEmailKeywords && text.length > 0) {
        // Check if it's mostly printable ASCII
        const printableRatio = text.split('').filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126).length / text.length;
        if (printableRatio < 0.7) {
          return { valid: false, reason: 'Invalid .eml file: does not appear to be a valid email file' };
        }
      }
    }
  }

  // For .txt files, just check if it's text-based
  if (ext === '.txt') {
    const signature = readFileSignature(filePath, SECURITY.MAGIC_NUMBER_READ_BYTES_TEXT);
    if (signature) {
      const text = signature.toString('utf-8', 0, Math.min(SECURITY.MAGIC_NUMBER_READ_BYTES_TEXT, signature.length));
      const printableRatio = text.split('').filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126 || c.charCodeAt(0) >= 160).length / text.length;
      if (printableRatio < 0.7 && text.length > 0) {
        return { valid: false, reason: 'Invalid .txt file: does not appear to be text-based' };
      }
    }
  }

  return { valid: true };
}

/**
 * Validate image file for boarding pass parsing
 */
export function validateBoardingPassImage(filePath: string, declaredMimeType: string): { valid: boolean; reason?: string } {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ];

  if (!allowedMimeTypes.includes(declaredMimeType)) {
    return { valid: false, reason: `Invalid MIME type for image: ${declaredMimeType}` };
  }

  // Validate with magic numbers
  if (!validateFileType(filePath, declaredMimeType)) {
    const detectedType = detectFileType(filePath);
    return {
      valid: false,
      reason: `File signature does not match declared type. Declared: ${declaredMimeType}, Detected: ${detectedType || 'unknown'}`,
    };
  }

  return { valid: true };
}

/**
 * Validate Base64-encoded image for boarding pass parsing
 * @param imageBase64 Base64-encoded image string (with or without data URI prefix)
 * @returns Validation result with detected MIME type
 */
export function validateBoardingPassImageBase64(imageBase64: string): { valid: boolean; mimeType?: string; reason?: string } {
  try {
    // Remove data URI prefix if present (e.g., "data:image/png;base64,")
    let base64Data = imageBase64;
    let declaredMimeType: string | undefined;

    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        declaredMimeType = match[1];
        base64Data = match[2];
      } else {
        return { valid: false, reason: 'Invalid data URI format' };
      }
    }

    // Decode base64
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0) {
      return { valid: false, reason: 'Empty image data' };
    }

    // Check file size limit
    if (buffer.length > FILE_LIMITS.BOARDING_PASS_MAX_SIZE) {
      return { valid: false, reason: `Image too large: ${buffer.length} bytes (max: ${FILE_LIMITS.BOARDING_PASS_MAX_SIZE})` };
    }

    // Detect file type from magic numbers
    const detectedType = detectFileTypeFromBuffer(buffer);
    if (!detectedType) {
      return { valid: false, reason: 'Could not detect image type from file signature' };
    }

    // Check if detected type is an allowed image type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    if (!allowedMimeTypes.includes(detectedType)) {
      return { valid: false, reason: `Detected type ${detectedType} is not an allowed image format` };
    }

    // If MIME type was declared, verify it matches detected type
    if (declaredMimeType) {
      // Normalize jpg to jpeg
      const normalizedDeclared = declaredMimeType === 'image/jpg' ? 'image/jpeg' : declaredMimeType;
      const normalizedDetected = detectedType === 'image/jpg' ? 'image/jpeg' : detectedType;

      if (normalizedDeclared !== normalizedDetected) {
        return {
          valid: false,
          reason: `Declared MIME type (${declaredMimeType}) does not match detected type (${detectedType})`,
        };
      }
    }

    return { valid: true, mimeType: detectedType };
  } catch (error) {
    return {
      valid: false,
      reason: `Failed to validate image: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

