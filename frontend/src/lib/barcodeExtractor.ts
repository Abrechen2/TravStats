/**
 * Barcode Extraction Service
 * 
 * Extracts barcode data (QR, Aztec, PDF417, DataMatrix) from boarding pass images.
 * Uses @zxing/browser and jsQR libraries for multi-format support.
 */

import jsQR from 'jsqr';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { logger } from './logger';

export interface BarcodeExtractionResult {
  data: string;
  format: 'QR' | 'Aztec' | 'PDF417' | 'DataMatrix' | 'Unknown';
}

/**
 * Extract barcode from image file or data URL
 * @param image - File object or data URL string
 * @returns Barcode data string or null if not found
 */
export async function extractBarcodeFromImage(
  image: File | string
): Promise<string | null> {
  try {
    // Convert to ImageData for processing
    const imageData = await loadImageData(image);
    if (!imageData) {
      return null;
    }

    // Try QR code first (most common, fastest)
    const qrResult = await tryQRCode(imageData);
    if (qrResult) {
      return qrResult;
    }

    // Try other formats with ZXing (Aztec, PDF417, DataMatrix)
    const zxingResult = await tryZXingFormats(imageData);
    if (zxingResult) {
      return zxingResult;
    }

    return null;
  } catch (error) {
    logger.error('[Barcode Extractor] Error extracting barcode:', error);
    return null;
  }
}

/**
 * Extract barcode with format information
 */
export async function extractBarcodeWithFormat(
  image: File | string
): Promise<BarcodeExtractionResult | null> {
  try {
    const imageData = await loadImageData(image);
    if (!imageData) {
      return null;
    }

    // Try QR code
    const qrResult = await tryQRCode(imageData);
    if (qrResult) {
      return { data: qrResult, format: 'QR' };
    }

    // Try ZXing formats
    const zxingResult = await tryZXingFormats(imageData);
    if (zxingResult) {
      // ZXing doesn't always return format, default to Aztec (most common for boarding passes)
      return { data: zxingResult, format: 'Aztec' };
    }

    return null;
  } catch (error) {
    logger.error('[Barcode Extractor] Error extracting barcode with format:', error);
    return null;
  }
}

/**
 * Load image and convert to ImageData
 */
async function loadImageData(image: File | string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      resolve(null);
      return;
    }

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(imageData);
      } catch (error) {
        logger.error('[Barcode Extractor] Error creating ImageData:', error);
        resolve(null);
      }
    };

    img.onerror = () => {
      logger.error('[Barcode Extractor] Error loading image');
      resolve(null);
    };

    // Set source
    if (typeof image === 'string') {
      img.src = image;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(image);
    }
  });
}

/**
 * Try QR code extraction using jsQR
 */
async function tryQRCode(imageData: ImageData): Promise<string | null> {
  try {
    const result = jsQR(imageData.data, imageData.width, imageData.height);
    if (result && result.data) {
      console.debug('[Barcode Extractor] QR code found:', result.data.substring(0, 50) + '...');
      return result.data;
    }
    return null;
  } catch (error) {
    console.debug('[Barcode Extractor] QR code extraction failed:', error);
    return null;
  }
}

/**
 * Try other barcode formats using ZXing
 */
async function tryZXingFormats(imageData: ImageData): Promise<string | null> {
  try {
    // Convert ImageData to Canvas for ZXing
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.putImageData(imageData, 0, 0);

    // Use ZXing BrowserMultiFormatReader
    const reader = new BrowserMultiFormatReader();
    
    // ZXing can decode from canvas
    try {
      const result = await reader.decodeFromCanvas(canvas);
      if (result && result.getText()) {
        console.debug('[Barcode Extractor] ZXing barcode found:', result.getText().substring(0, 50) + '...');
        return result.getText();
      }
    } catch (zxingError) {
      // ZXing throws errors when no barcode found, this is expected
      console.debug('[Barcode Extractor] ZXing extraction failed (no barcode)');
      return null;
    }

    return null;
  } catch (error) {
    console.debug('[Barcode Extractor] ZXing extraction error:', error);
    return null;
  }
}

/**
 * Check if string looks like barcode data (quick heuristic)
 */
export function looksLikeBarcodeData(data: string): boolean {
  if (!data || data.length < 10) return false;
  
  // Common patterns:
  // - IATA BCBP starts with M1, M2
  // - Contains airline codes (2-3 letters)
  // - Contains airport codes (3 letters)
  // - Contains dates/numbers
  
  const barcodePatterns = [
    /^M[12]/, // IATA BCBP
    /[A-Z]{2}\d{1,4}/, // Flight numbers
    /[A-Z]{3}/, // Airport codes
    /\d{3}/, // Julian dates
  ];

  return barcodePatterns.some(pattern => pattern.test(data));
}

