import { Flight, combineDateTime, splitDateTime, parseAnnotationText } from "./types";
import { marksAlign, type TextMark } from "./marks";

/** Old-format flights (ISO date-times, legacy field names) in the editor's date/time-split shape. */
export function convertStoredFlights(extractedData: unknown[]): Flight[] {
  return extractedData.map((rawFlight: unknown) => {
    const flight = rawFlight as Flight;
    const converted: Flight = { ...flight };
    if (flight.departureTime && !flight.departureDate) {
      const { date, time } = splitDateTime(flight.departureTime);
      if (date) converted.departureDate = date;
      if (time) converted.departureTime = time;
    }
    if (flight.arrivalTime && !flight.arrivalDate) {
      const { date, time } = splitDateTime(flight.arrivalTime);
      if (date) converted.arrivalDate = date;
      if (time) converted.arrivalTime = time;
    }
    // Migrate legacy field names for backward compatibility
    if (flight.price && !flight.aircraft) {
      converted.aircraft = flight.price;
    }
    if ((flight as Record<string, string | undefined>).aircraftType && !flight.aircraft) {
      converted.aircraft = (flight as Record<string, string | undefined>).aircraftType;
    }
    return converted;
  });
}

const LABEL_TO_FIELD: Record<string, keyof Flight> = {
  flightNumber: "flightNumber",
  airline: "airline",
  departureCode: "departureCode",
  arrivalCode: "arrivalCode",
  pnr: "pnr",
  aircraft: "aircraft",
  seat: "seat",
  seatClass: "seatClass",
  terminal: "terminal",
  gate: "gate",
  ticketNumber: "ticketNumber",
  boardingGroup: "boardingGroup",
};

/**
 * Fill the ground-truth flight from a marked value. Mutates `flight` in place
 * (as the editor always did — the caller copies the array, not the flights).
 * For date/time labels the text is parsed and split where it can be.
 */
export function applyLabelToFlight(flight: Flight, label: string, text: string): void {
  if (label === "departureDate" || label === "departureTime") {
    const { date, time } = parseAnnotationText(text);
    if (label === "departureDate") {
      flight.departureDate = date ?? text;
    }
    if (label === "departureTime") {
      flight.departureTime = time ?? text;
    }
  } else if (label === "arrivalDate" || label === "arrivalTime") {
    const { date, time } = parseAnnotationText(text);
    if (label === "arrivalDate") {
      flight.arrivalDate = date ?? text;
    }
    if (label === "arrivalTime") {
      flight.arrivalTime = time ?? text;
    }
  } else {
    const field = LABEL_TO_FIELD[label];
    if (field) {
      flight[field] = text;
    }
  }
}

/** The flights as the backend takes them: date and time recombined into one instant. */
export function flightsForBackend(flights: Flight[]): Flight[] {
  return flights.map((flight) => {
    const converted = { ...flight };
    if (flight.departureDate || flight.departureTime) {
      const combined = combineDateTime(flight.departureDate, flight.departureTime);
      if (combined) {
        converted.departureTime = combined;
      }
      delete converted.departureDate;
    }
    if (flight.arrivalDate || flight.arrivalTime) {
      const combined = combineDateTime(flight.arrivalDate, flight.arrivalTime);
      if (combined) {
        converted.arrivalTime = combined;
      }
      delete converted.arrivalDate;
    }
    return converted;
  });
}

/** The server's refusal code of a failed save, if it sent one. */
export function annotateFailureCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { response?: { data?: { code?: string } } }).response?.data?.code
    : undefined;
}

/**
 * Marks of the flights behind a removed one move up by one index. The removed
 * flight's own marks are kept — that is what the editor has always done.
 */
export function shiftMarksAfter(annotations: TextMark[], removedIndex: number): TextMark[] {
  return annotations.map((a) => {
    if (a.flightIndex !== undefined && a.flightIndex > removedIndex) {
      return { ...a, flightIndex: a.flightIndex - 1 };
    }
    return a;
  });
}

export interface TextSegment {
  text: string;
  isHighlight: boolean;
  label?: string;
  flightIndex?: number;
}

/** The text cut at the marks, in order; a mark overlapping an earlier one is skipped. */
export function segmentsOf(displayText: string, annotations: TextMark[]): TextSegment[] {
  const sortedAnnotations = [...annotations].sort((a, b) => a.start - b.start);
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  sortedAnnotations.forEach((annotation) => {
    // Skip overlapping annotations (same or overlapping range already rendered)
    if (annotation.start < lastIndex) return;

    if (annotation.start > lastIndex) {
      segments.push({
        text: displayText.substring(lastIndex, annotation.start),
        isHighlight: false,
      });
    }
    segments.push({
      text: displayText.substring(annotation.start, annotation.end),
      isHighlight: true,
      label: annotation.label,
      flightIndex: annotation.flightIndex,
    });
    lastIndex = annotation.end;
  });

  if (lastIndex < displayText.length) {
    segments.push({
      text: displayText.substring(lastIndex),
      isHighlight: false,
    });
  }
  return segments;
}

export interface StoredAnnotation {
  /** The saved or uploaded mail text, when the blob carries one. */
  fullText: string | null;
  /** The marks to show, when the blob carries a list; empty after a drop. */
  marks: TextMark[] | null;
  /** The stored marks were thrown away because they no longer fitted the text. */
  marksDropped: boolean;
  /** The sample was SAVED before, so its text is shown as stored. */
  wasSaved: boolean;
}

/** What a training sample's annotation blob says about its text and marks. */
export function readStoredAnnotation(annotationsData: Record<string, unknown>): StoredAnnotation {
  const fullText = typeof annotationsData.fullText === "string" ? annotationsData.fullText : null;
  let marks: TextMark[] | null = null;
  let marksDropped = false;
  if (Array.isArray(annotationsData.textSelections)) {
    const stored = annotationsData.textSelections as TextMark[];
    // A sample annotated before the offsets and the saved text were
    // made to agree can carry marks that point into a DIFFERENT
    // document — the raw mail, while `fullText` is the filtered one.
    // Rendering those paints highlights over the wrong words, and the
    // annotate route now refuses the save with a 400 the reader has no
    // way to clear: there is no per-mark delete, and Undo is empty on
    // load. So they are dropped here, once, and the reader is told.
    if (stored.length > 0 && !marksAlign(fullText ?? "", stored)) {
      marks = [];
      marksDropped = true;
    } else {
      marks = stored;
    }
  }
  // Has this sample been SAVED before? Then its text is shown as it
  // was stored, marked or not.
  //
  // Running the filter over an already-filtered document is a SECOND
  // pass, and it is not idempotent — the greeting rules are anchored
  // at the start of a line, so one pass can expose a line the next
  // pass then removes. A sample saved deliberately unfiltered loses
  // its headers the same way, which quietly undoes the reader's own
  // choice. And where there are marks, the text they were measured
  // against is the only text they fit.
  //
  // The question is answered by which KEYS the annotation blob holds,
  // not by how many marks it has: an upload writes `{fullText}` alone,
  // every save writes `textSelections` (empty array included) and,
  // since this branch, `filtered`. A legacy save with nothing marked
  // has the first and not the second, and was being filtered again.
  //
  // `TrainingData.status` cannot answer it: the annotate route never
  // writes that column (`routes/training.ts` — it is set to "pending"
  // at upload and next changed by the training job), so a saved sample
  // is still "pending".
  const wasSaved = "textSelections" in annotationsData || "filtered" in annotationsData;
  return { fullText, marks, marksDropped, wasSaved };
}
