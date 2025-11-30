/**
 * Boarding Pass OCR Parser
 *
 * Extracts gate, terminal, boarding time from the visual text on boarding passes
 * using Tesseract.js OCR engine.
 */

import Tesseract from 'tesseract.js';

export interface OCRExtractedData {
  gate?: string;
  terminal?: string;
  boardingTime?: string;
  gateCloseTime?: string;
}

/**
 * Preprocess image for better OCR results
 * Handles colored backgrounds (turquoise, etc.) by removing color cast
 */
function preprocessImageForOCR(imageDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }

      // Scale up for better OCR (2.5x for better text recognition)
      const scale = 2.5;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      // Draw image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Step 1: Remove color cast (important for turquoise/colored backgrounds)
      // Calculate average color to detect color cast
      let avgR = 0, avgG = 0, avgB = 0;
      for (let i = 0; i < data.length; i += 4) {
        avgR += data[i];
        avgG += data[i + 1];
        avgB += data[i + 2];
      }
      const pixelCount = data.length / 4;
      avgR /= pixelCount;
      avgG /= pixelCount;
      avgB /= pixelCount;

      console.log(`🎨 Detected color cast: R=${avgR.toFixed(0)}, G=${avgG.toFixed(0)}, B=${avgB.toFixed(0)}`);

      // Step 2: Detect if dark background with light text (SAS, dark blue, etc.)
      const isDarkBackground = avgR < 100 && avgG < 100 && avgB < 150;
      console.log(`🌓 Background type: ${isDarkBackground ? 'DARK (will invert)' : 'LIGHT'}`);

      // Step 3: Preprocessing with color cast removal
      for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // Remove color cast by normalizing against the average
        if (avgG > avgR && avgB > avgR) {
          // Turquoise/cyan cast detected - reduce green and blue
          r = Math.min(255, r * 1.3);
          g = Math.max(0, g * 0.7);
          b = Math.max(0, b * 0.7);
        } else if (avgB > avgR && avgB > avgG && isDarkBackground) {
          // Dark blue background (SAS) - boost other channels
          r = Math.min(255, r * 1.5);
          g = Math.min(255, g * 1.5);
          b = Math.max(0, b * 0.6);
        }

        // Convert to grayscale using luminosity method
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;

        // Invert if dark background (white text on dark background)
        if (isDarkBackground) {
          gray = 255 - gray;
        }

        // Adaptive thresholding: increase contrast aggressively
        // Make dark text much darker, light background much lighter
        gray = ((gray - 128) / 128) * 180 + 128; // Increase contrast
        gray = Math.max(0, Math.min(255, gray));

        // Apply strong threshold for clean black & white
        const bw = gray > 140 ? 255 : 0;

        data[i] = bw;
        data[i + 1] = bw;
        data[i + 2] = bw;
      }

      ctx.putImageData(imageData, 0, 0);

      // Optional: Apply slight sharpening for better edge detection
      const sharpenedData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const sharpen = sharpenedData.data;

      // Simple sharpening kernel (center weight = 5, neighbors = -1)
      for (let y = 1; y < canvas.height - 1; y++) {
        for (let x = 1; x < canvas.width - 1; x++) {
          const i = (y * canvas.width + x) * 4;
          const center = data[i];
          const top = data[((y - 1) * canvas.width + x) * 4];
          const bottom = data[((y + 1) * canvas.width + x) * 4];
          const left = data[(y * canvas.width + (x - 1)) * 4];
          const right = data[(y * canvas.width + (x + 1)) * 4];

          let sharpened = center * 5 - top - bottom - left - right;
          sharpened = Math.max(0, Math.min(255, sharpened));

          sharpen[i] = sharpened;
          sharpen[i + 1] = sharpened;
          sharpen[i + 2] = sharpened;
        }
      }

      ctx.putImageData(sharpenedData, 0, 0);

      console.log('✅ Image preprocessed: 2.5x scale, color cast removed, high contrast B&W, sharpened');

      // Return preprocessed image as data URL
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      console.warn('⚠️ Image preprocessing failed, using original');
      resolve(imageDataUrl);
    };

    img.src = imageDataUrl;
  });
}

/**
 * Extract text from boarding pass image using OCR
 */
async function extractTextFromImage(imageFile: File | string): Promise<string> {
  console.log('📸 Starting OCR text extraction...');

  try {
    // Preprocess image for better OCR
    let imageToProcess = imageFile;
    if (typeof imageFile === 'string') {
      console.log('🔧 Preprocessing image for better OCR...');
      imageToProcess = await preprocessImageForOCR(imageFile);
    }

    const result = await Tesseract.recognize(
      imageToProcess,
      'eng', // English
      {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );

    const extractedText = result.data.text;
    console.log('📄 OCR extracted text:', extractedText);
    return extractedText;
  } catch (error) {
    console.error('❌ OCR extraction failed:', error);
    return '';
  }
}

/**
 * Parse boarding pass fields from OCR text
 */
function parseFieldsFromText(text: string): OCRExtractedData {
  const data: OCRExtractedData = {};

  // Normalize text: uppercase, remove extra spaces
  const normalizedText = text.toUpperCase().replace(/\s+/g, ' ');

  console.log('🔍 Searching for patterns in OCR text...');

  // Pattern 1: Gate (GATE B11, GATE 029, B11 gate, etc.)
  // OCR often misreads characters, so we use flexible patterns
  const gatePatterns = [
    // First check for placeholders explicitly (before matching real gates)
    /(?:GATE|GNTE|G[A4O]TE|G.TE)[:\s]+([-._*]{1,}|TBA|TBD|N\/A|NA)\b/i,  // "GATE ----", "GATE ....", "GATE -"

    // With letter prefix (most common)
    /(?:GATE|GNTE|G[A4O]TE|G.TE)[:\s]+([A-Z]\d{1,3})/i,           // "GATE B11", "GATE: B11" (tolerant for OCR errors)
    /(?:GATE|GNTE|G[A4O]TE)[:\s]+([A-Z])\s*(\d{1,3})/i,      // "GATE B 11"
    /\b([A-Z])(\d{1,3})\s*(?:GATE|GNTE|G.TE)/i,              // "B11 GATE"

    // Numeric only gates (Lufthansa "029", etc.)
    /(?:GATE|GNTE|G[A4O]TE|G.TE)[:\s]+(\d{3})\b/i,           // "GATE 029" (3-digit numeric)
    /(?:GATE|GNTE|G[A4O]TE|G.TE)[:\s]+(\d{1,2})\b(?!\d)/i,   // "GATE 29" (1-2 digit numeric, not followed by more digits)

    // Context-based patterns
    /(?:SITZ|SEAT)[:\s]+\w+.*?\s+([A-Z]\d{1,3})/i, // AirDolomiti/German format: "SITZ 10A B11"
    /GRP[:\s]+\d+.*?SITZ[:\s]+\w+.*?\s+([A-Z]\d{1,3})/i, // Full AirDolomiti format: "GRP 3 SITZ 10A B11"
    /\b([A-Z])(\d{1,2})\s*(?:GRP|GROUP)/i,  // "B11 GRP" pattern
  ];

  for (const pattern of gatePatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      // First pattern is placeholder-only (no capture group for gate code)
      if (match[0].includes('----') || match[0].includes('....') || match[0].includes('***') ||
          match[0].includes('TBA') || match[0].includes('TBD') || match[0].includes('N/A') || match[0].includes('-')) {
        console.log('🚪 Gate placeholder detected (no gate assigned):', match[1] || match[0]);
        break; // Don't set gate, leave undefined
      }

      // Extract gate code (handle both captured groups)
      let gateCode = match[2] ? `${match[1]}${match[2]}` : match[1];

      // Skip if no capture group (shouldn't happen with our patterns)
      if (!gateCode) continue;

      // Clean up: remove spaces
      gateCode = gateCode.replace(/\s/g, '');

      // Double-check for placeholders in captured content
      const isPlaceholder = /^[.\-_*]+$/.test(gateCode) || // "....", "----", "____", "****"
                            gateCode === 'TBA' ||          // "To Be Announced"
                            gateCode === 'TBD' ||          // "To Be Determined"
                            gateCode === 'N/A' ||
                            gateCode === 'NA';

      if (isPlaceholder) {
        console.log('🚪 Gate placeholder detected (no gate assigned):', gateCode);
        break; // Don't set gate, leave undefined
      }

      // Validate: Gate should be either:
      // - 1 letter + 1-3 digits (B11, A5, etc.)
      // - 1-3 digits only (029, 29, etc.)
      if (/^[A-Z]\d{1,3}$/.test(gateCode) || /^\d{1,3}$/.test(gateCode)) {
        data.gate = gateCode;
        console.log('🚪 Found gate:', data.gate);
        break;
      }
    }
  }

  // Fallback: Search for isolated gate pattern (e.g., "B11" in prominent position)
  if (!data.gate) {
    // Look for all potential gate patterns: Capital letter + 1-2 digits that appears isolated
    const allMatches = normalizedText.matchAll(/\b([A-Z])(\d{1,2})\b/g);
    const potentialGates: string[] = [];

    for (const match of allMatches) {
      const potentialGate = `${match[1]}${match[2]}`;
      const num = parseInt(match[2]);

      // Filter criteria for valid gates:
      // 1. Gate number between 1-99 (not seat row like 10A would have letter A after)
      // 2. Exclude common false positives (seat numbers near SEAT/SITZ keywords)
      const isSeatNumber = normalizedText.includes(`SEAT ${potentialGate}`) ||
                           normalizedText.includes(`SITZ ${potentialGate}`) ||
                           normalizedText.includes(`${potentialGate}A`) ||
                           normalizedText.includes(`${potentialGate}B`) ||
                           normalizedText.includes(`${potentialGate}C`) ||
                           normalizedText.includes(`${potentialGate}D`) ||
                           normalizedText.includes(`${potentialGate}E`) ||
                           normalizedText.includes(`${potentialGate}F`);

      if (num >= 1 && num <= 99 && !isSeatNumber) {
        potentialGates.push(potentialGate);
      }
    }

    // If we found potential gates, use the first one that appears in the text
    // (usually gates appear before seat numbers on boarding passes)
    if (potentialGates.length > 0) {
      data.gate = potentialGates[0];
      console.log('🚪 Found gate (fallback pattern):', data.gate,
                  potentialGates.length > 1 ? `(other candidates: ${potentialGates.slice(1).join(', ')})` : '');
    }
  }

  // Pattern 2: Terminal (TERMINAL 1, TERMINAL: T1, T1, etc.)
  const terminalPatterns = [
    /TERMINAL[:\s]+([T]?\d)/i,              // "TERMINAL 1", "TERMINAL: T1"
    /TERMINAL[:\s]+([A-Z])/i,               // "TERMINAL A"
    /\bT(\d|[A-Z])\b/,                      // "T1", "T2"
  ];

  for (const pattern of terminalPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      let terminal = match[1];
      // Ensure it starts with T
      if (!/^T/.test(terminal)) {
        terminal = `T${terminal}`;
      }
      data.terminal = terminal;
      console.log('🏢 Found terminal:', data.terminal);
      break;
    }
  }

  // Pattern 3: Boarding Time (BOARDING 12:25, BOARDS 9:59 AM, BOARDING TIME 11:20, etc.)
  const boardingTimePatterns = [
    // Standard 24h format - Most common patterns first for performance
    /(?:BOARDING\s+TIME|BOARDING TIME)[:\s]+(\d{1,2})[:\.](\d{2})/i,  // Wideroe: "BOARDING TIME 11:20"
    /(?:BOARDING|BOARDI.G|BO.RDING|BOARDS|EINST)[:\s]+(\d{1,2})[:\.](\d{2})/i,   // "BOARDING 12:25", "BOARDS 9:59"

    // Departure/Departs variations (Emirates, United, etc.)
    /(?:DEPARTS?|DEPARTURE)[:\s]+(\d{1,2})[:\.](\d{2})/i,  // Emirates: "DEPARTS 15:40"
    /(?:DEPARTS?)[:\s]+\d{1,2}\s+\w{3}[,\s]+(\d{1,2})[:\.](\d{2})/i,  // "DEPARTS 20 Apr, 15:40"

    // Compact formats
    /(?:BOARDING|BOARDI.G|BOARDS)[:\s]+(\d{4})/i,                  // "BOARDING 1225"
    /(?:BOARD|BO.RD|EINST)[:\s]+(\d{1,2})[:\.](\d{2})/i,      // "BOARD 12:25", "EINST 12:25"
    /(?:EINSTEIGEN|EINSTIEG)[:\s]+(\d{1,2})[:\.](\d{2})/i,    // German: "EINSTEIGEN 12:25"

    // 12h format with AM/PM (United Airlines, etc.)
    /(?:BOARDING|BOARDS)[:\s]+(\d{1,2})[:\.](\d{2})\s*(?:AM|PM)/i,   // "BOARDS 9:59 AM"
    /(?:BOARDING|BOARDS)[:\s]+(\d{1,2})\s*(?:AM|PM)/i,               // "BOARDS 9 AM"
    /(?:DEPARTS?)[:\s]+(\d{1,2})[:\.](\d{2})\s*(?:AM|PM)/i,         // "DEPARTS 3:45 PM"

    // Context-based: Look for time near boarding-related keywords
    /(?:BOARDING|BOARDS|DEPARTS?|DEPARTURE).*?(\d{1,2})[:\.](\d{2})\s*(?:AM|PM)?/i,
  ];

  for (const pattern of boardingTimePatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      // Check if AM/PM format
      const fullMatch = match[0];
      const isAM = /AM/i.test(fullMatch);
      const isPM = /PM/i.test(fullMatch);

      if (match[2]) {
        // HH:MM format
        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);

        // Convert 12h to 24h format if AM/PM detected
        if (isPM && hours < 12) {
          hours += 12;
        } else if (isAM && hours === 12) {
          hours = 0;
        }

        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
          data.boardingTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          console.log('⏰ Found boarding time:', data.boardingTime, isPM || isAM ? `(converted from ${match[0]})` : '');
          break;
        }
      } else if (match[1].length === 4) {
        // HHMM format
        const hours = parseInt(match[1].substring(0, 2));
        const minutes = parseInt(match[1].substring(2, 4));
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
          data.boardingTime = `${match[1].substring(0, 2)}:${match[1].substring(2, 4)}`;
          console.log('⏰ Found boarding time:', data.boardingTime);
          break;
        }
      } else if (isAM || isPM) {
        // Hour only with AM/PM (e.g., "9 AM")
        let hours = parseInt(match[1]);
        if (isPM && hours < 12) {
          hours += 12;
        } else if (isAM && hours === 12) {
          hours = 0;
        }
        if (hours >= 0 && hours < 24) {
          data.boardingTime = `${String(hours).padStart(2, '0')}:00`;
          console.log('⏰ Found boarding time:', data.boardingTime, `(converted from ${match[0]})`);
          break;
        }
      }
    }
  }

  // Pattern 4: Gate Close Time (GATE SCHLIESST 12:50, GATE CLOSES 12:50, etc.)
  const gateClosePatterns = [
    /GATE\s+(?:SCHLIESST|CLOSES|CLOSING)[:\s]+(\d{1,2})[:\.](\d{2})\s*(?:AM|PM)?/i,
    /(?:SCHLIESST|CLOSES)[:\s]+(\d{1,2})[:\.](\d{2})\s*(?:AM|PM)?/i,
  ];

  for (const pattern of gateClosePatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const fullMatch = match[0];
      const isAM = /AM/i.test(fullMatch);
      const isPM = /PM/i.test(fullMatch);

      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);

      // Convert 12h to 24h format if AM/PM detected
      if (isPM && hours < 12) {
        hours += 12;
      } else if (isAM && hours === 12) {
        hours = 0;
      }

      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        data.gateCloseTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        console.log('🚪⏱️ Found gate close time:', data.gateCloseTime, isPM || isAM ? `(converted from ${match[0]})` : '');
        break;
      }
    }
  }

  return data;
}

/**
 * Main OCR function: Extract gate, terminal, boarding time from boarding pass image
 */
export async function extractBoardingPassDataFromImage(
  imageFile: File | string
): Promise<OCRExtractedData> {
  console.log('🔍 Starting boarding pass OCR extraction...');

  try {
    // Step 1: Extract text using OCR
    const text = await extractTextFromImage(imageFile);

    if (!text || text.trim().length === 0) {
      console.warn('⚠️ OCR returned empty text');
      return {};
    }

    // Step 2: Parse fields from extracted text
    const extractedData = parseFieldsFromText(text);

    console.log('✅ OCR extraction complete:', extractedData);
    return extractedData;

  } catch (error) {
    console.error('❌ OCR processing failed:', error);
    return {};
  }
}

/**
 * Quick OCR extraction with timeout (for performance)
 * Returns partial results if OCR takes too long
 */
export async function extractBoardingPassDataQuick(
  imageFile: File | string,
  timeoutMs: number = 10000 // 10 seconds default
): Promise<OCRExtractedData> {
  return Promise.race([
    extractBoardingPassDataFromImage(imageFile),
    new Promise<OCRExtractedData>((resolve) => {
      setTimeout(() => {
        console.warn('⏱️ OCR timeout - returning empty result');
        resolve({});
      }, timeoutMs);
    })
  ]);
}
