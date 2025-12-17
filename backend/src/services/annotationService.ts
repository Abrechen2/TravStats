import { ParsedBooking } from './bookingParser';
import logger from '../utils/logger';

export interface TextSelection {
  start: number;
  end: number;
  text: string;
  label: string; // e.g., "flightNumber", "departureCode", etc.
  flightIndex?: number; // Optional: which flight this annotation belongs to
}

export interface AnnotatedContext {
  label: string;
  text: string;
  context: string; // Context around the marked text
  flightIndex?: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface EmailAnnotation {
  type: 'email';
  textSelections: TextSelection[];
  fullText: string;
}

export interface BoardingPassAnnotation {
  type: 'boarding_pass';
  boundingBoxes: BoundingBox[];
  imageBase64: string;
}

export type Annotation = EmailAnnotation | BoardingPassAnnotation;

/**
 * Extract context around a text selection
 * @param fullText The full email text
 * @param start Start position of the selection
 * @param end End position of the selection
 * @param contextWindow Number of characters to include before and after (default: 100)
 * @returns Context string with marked text highlighted
 */
export function extractContextAroundSelection(
  fullText: string,
  start: number,
  end: number,
  contextWindow: number = 100
): string {
  const contextStart = Math.max(0, start - contextWindow);
  const contextEnd = Math.min(fullText.length, end + contextWindow);
  
  const beforeContext = fullText.substring(contextStart, start);
  const markedText = fullText.substring(start, end);
  const afterContext = fullText.substring(end, contextEnd);
  
  // Mark the selected text in the context
  return `${beforeContext}[MARKED: ${markedText}]${afterContext}`;
}

/**
 * Extract text selections from email annotation
 */
export function extractTextSelections(annotation: EmailAnnotation): Record<string, string> {
  const extracted: Record<string, string> = {};

  for (const selection of annotation.textSelections) {
    const text = annotation.fullText.substring(selection.start, selection.end).trim();
    if (text) {
      extracted[selection.label] = text;
    }
  }

  logger.debug({
    operation: 'extract_text_selections',
    message: 'Extracted text selections from email annotation',
    context: {
      selectionCount: annotation.textSelections.length,
      extractedFields: Object.keys(extracted),
    },
  });

  return extracted;
}

/**
 * Extract bounding boxes from boarding pass annotation
 * Note: This returns the coordinates, actual OCR extraction would need to be done separately
 */
export function extractBoundingBoxes(annotation: BoardingPassAnnotation): BoundingBox[] {
  logger.debug({
    operation: 'extract_bounding_boxes',
    message: 'Extracted bounding boxes from boarding pass annotation',
    context: {
      boxCount: annotation.boundingBoxes.length,
    },
  });

  return annotation.boundingBoxes;
}

/**
 * Create annotated context list for email annotations
 * Groups annotations by flight and extracts context around each selection
 */
export function createAnnotatedContextList(annotation: EmailAnnotation): AnnotatedContext[] {
  const annotatedContexts: AnnotatedContext[] = [];

  for (const selection of annotation.textSelections) {
    const context = extractContextAroundSelection(
      annotation.fullText,
      selection.start,
      selection.end,
      100
    );

    annotatedContexts.push({
      label: selection.label,
      text: selection.text,
      context,
      flightIndex: selection.flightIndex,
    });
  }

  return annotatedContexts;
}

/**
 * Create boarding pass text representation from bounding boxes and ground truth
 * Uses ground truth data to map bounding boxes to actual text values
 */
export function createBoardingPassTextRepresentation(
  annotation: BoardingPassAnnotation,
  extractedData: ParsedBooking[]
): string {
  if (extractedData.length === 0) {
    return '[Boarding Pass Image - No ground truth data available]';
  }

  const flight = extractedData[0]; // Boarding pass typically has one flight
  const lines: string[] = [];
  
  // Create a mapping of labels to values from ground truth
  const labelToValue: Record<string, string> = {
    flightNumber: flight.flightNumber || '',
    departureCode: flight.departureCode || '',
    arrivalCode: flight.arrivalCode || '',
    departureTime: flight.departureTime || '',
    arrivalTime: flight.arrivalTime || '',
    seat: flight.seat || '',
    gate: flight.gate || '',
    terminal: flight.terminal || '',
    pnr: flight.pnr || flight.bookingReference || '',
  };

  // Create structured text representation
  lines.push('Boarding Pass Information:');
  lines.push('');

  // Add bounding box information
  if (annotation.boundingBoxes.length > 0) {
    lines.push('Markierte Bereiche:');
    for (const box of annotation.boundingBoxes) {
      const value = labelToValue[box.label] || '[Text aus Bild]';
      lines.push(`- ${box.label}: "${value}" (Position: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height})`);
    }
    lines.push('');
  }

  // Add all flight information
  lines.push('Extrahierte Flugdaten:');
  for (const [key, value] of Object.entries(flight)) {
    if (value !== null && value !== undefined && value !== '') {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create training example from annotation and ground truth data
 */
export function createTrainingExample(
  annotation: Annotation,
  extractedData: ParsedBooking[]
): {
  input: string;
  output: string;
  metadata: Record<string, any>;
} {
  let input = '';
  let metadata: Record<string, any> = {
    type: annotation.type,
  };

  if (annotation.type === 'email') {
    // For email, use the full text as input
    input = annotation.fullText;
    
    // Create annotated context list with context around each selection
    const annotatedContexts = createAnnotatedContextList(annotation);
    
    // Group by flight index if available
    const groupedByFlight: Record<number, AnnotatedContext[]> = {};
    const ungrouped: AnnotatedContext[] = [];
    
    for (const ctx of annotatedContexts) {
      if (ctx.flightIndex !== undefined) {
        if (!groupedByFlight[ctx.flightIndex]) {
          groupedByFlight[ctx.flightIndex] = [];
        }
        groupedByFlight[ctx.flightIndex].push(ctx);
      } else {
        ungrouped.push(ctx);
      }
    }
    
    // Store structured highlights with context
    metadata.highlights = annotatedContexts;
    metadata.highlightsGrouped = groupedByFlight;
    metadata.highlightsUngrouped = ungrouped;
  } else {
    // For boarding pass, create text representation
    const textRepresentation = createBoardingPassTextRepresentation(annotation, extractedData);
    input = textRepresentation;
    
    // Store bounding boxes with metadata
    metadata.boundingBoxes = annotation.boundingBoxes;
    metadata.imageBase64 = annotation.imageBase64.substring(0, 200) + '...'; // Truncate for metadata
  }

  // Output is the JSON representation of extracted flights
  const output = JSON.stringify(extractedData, null, 2);

  logger.debug({
    operation: 'create_training_example',
    message: 'Created training example from annotation',
    context: {
      type: annotation.type,
      flightCount: extractedData.length,
      annotationCount: annotation.type === 'email' 
        ? annotation.textSelections.length 
        : annotation.boundingBoxes.length,
    },
  });

  return {
    input,
    output,
    metadata,
  };
}

