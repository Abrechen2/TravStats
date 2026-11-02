import Tesseract from "tesseract.js";
import { logger } from "../../lib/logger";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/**
 * Extract text from a bounding box region using OCR
 */
export async function extractTextFromBoundingBox(
  imageBase64: string,
  box: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
  originalImageWidth: number,
  originalImageHeight: number
): Promise<string> {
  try {
    // Convert base64 to image
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageBase64;
    });

    // Box coordinates are in canvas space (which may be scaled with DPR)
    // We need to convert them to original image coordinates
    // The canvas is scaled: canvas = originalImage * displayScale * DPR
    // So: originalImage = canvas / (displayScale * DPR)
    // But we don't have displayScale stored, so we calculate it:
    // displayScale = Math.min(maxDisplayWidth/originalWidth, maxDisplayHeight/originalHeight, 1)
    // Actually, we can calculate it from canvas and image dimensions:
    // The canvas width includes DPR scaling, so: canvasWidth = originalWidth * displayScale * DPR

    // Calculate scale from canvas to original image
    // Canvas dimensions already include DPR scaling
    const scaleX = originalImageWidth / canvasWidth;
    const scaleY = originalImageHeight / canvasHeight;

    // Convert box coordinates from canvas space to original image space
    const imageBox = {
      x: Math.max(0, Math.floor(box.x * scaleX)),
      y: Math.max(0, Math.floor(box.y * scaleY)),
      width: Math.min(
        originalImageWidth - Math.floor(box.x * scaleX),
        Math.floor(box.width * scaleX)
      ),
      height: Math.min(
        originalImageHeight - Math.floor(box.y * scaleY),
        Math.floor(box.height * scaleY)
      ),
    };

    // Ensure minimum size
    if (imageBox.width < 1 || imageBox.height < 1) {
      logger.warn("Bounding box too small for OCR");
      return "";
    }

    // Create a temporary canvas to crop the region
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = imageBox.width;
    tempCanvas.height = imageBox.height;
    const tempCtx = tempCanvas.getContext("2d");

    if (!tempCtx) {
      logger.error("Failed to get canvas context for OCR");
      return "";
    }

    // Draw the cropped region from the original image
    tempCtx.drawImage(
      img,
      imageBox.x,
      imageBox.y,
      imageBox.width,
      imageBox.height,
      0,
      0,
      imageBox.width,
      imageBox.height
    );

    // Perform OCR on the cropped region
    const {
      data: { text },
    } = await Tesseract.recognize(tempCanvas, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    return text.trim();
  } catch (error) {
    logger.error("OCR extraction failed:", error);
    return "";
  }
}
