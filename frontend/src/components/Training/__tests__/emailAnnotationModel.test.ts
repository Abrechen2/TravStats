import { describe, expect, it } from "vitest";
import type { TextMark } from "../marks";
import {
  applyLabelToFlight,
  annotateFailureCode,
  convertStoredFlights,
  flightsForBackend,
  readStoredAnnotation,
  segmentsOf,
  shiftMarksAfter,
} from "../emailAnnotationModel";

/** The pure parts of the annotation view, split out of it (forgejo#386 REF-15). */
const mark = (start: number, end: number, text: string, flightIndex?: number): TextMark => ({
  start,
  end,
  label: "flightNumber",
  text,
  flightIndex,
});

describe("segmentsOf", () => {
  it("cuts the text at the marks and skips a mark that overlaps an earlier one", () => {
    const text = "Flight LH400 today";
    const segs = segmentsOf(text, [mark(7, 12, "LH400"), mark(9, 14, "400 t")]);
    expect(segs.map((s) => [s.text, s.isHighlight])).toEqual([
      ["Flight ", false],
      ["LH400", true],
      [" today", false],
    ]);
  });
});

describe("shiftMarksAfter", () => {
  it("moves marks of later flights up one index and keeps the removed flight's marks", () => {
    const shifted = shiftMarksAfter(
      [mark(0, 1, "a", 0), mark(2, 3, "b", 1), mark(4, 5, "c", 2)],
      1
    );
    expect(shifted.map((m) => m.flightIndex)).toEqual([0, 1, 1]);
  });
});

describe("applyLabelToFlight", () => {
  it("fills a plain field and leaves unknown labels alone", () => {
    const flight = {};
    applyLabelToFlight(flight, "seat", "12A");
    applyLabelToFlight(flight, "nonsense", "x");
    expect(flight).toEqual({ seat: "12A" });
  });

  it("keeps the whole text for a date label the parser cannot split", () => {
    const flight: Record<string, string> = {};
    applyLabelToFlight(flight, "departureDate", "garbled");
    expect(flight.departureDate).toBe("garbled");
  });
});

describe("convertStoredFlights / flightsForBackend", () => {
  it("migrates the legacy aircraft name", () => {
    const [f] = convertStoredFlights([{ aircraftType: "A320" }]);
    expect(f.aircraft).toBe("A320");
  });

  it("drops the separate date again when the flights go to the backend", () => {
    const [f] = flightsForBackend([{ departureDate: "2026-10-01", departureTime: "08:30" }]);
    expect(f.departureDate).toBeUndefined();
  });
});

describe("readStoredAnnotation", () => {
  it("drops marks that no longer fit the stored text and says so", () => {
    const r = readStoredAnnotation({
      fullText: "Flight LH400",
      textSelections: [mark(0, 5, "WRONG")],
      filtered: true,
    });
    expect(r).toMatchObject({ marks: [], marksDropped: true, wasSaved: true });
  });

  it("treats an upload (fullText alone) as not yet saved", () => {
    expect(readStoredAnnotation({ fullText: "abc" })).toEqual({
      fullText: "abc",
      marks: null,
      marksDropped: false,
      wasSaved: false,
    });
  });
});

describe("annotateFailureCode", () => {
  it("reads the server's code and tolerates anything else", () => {
    expect(annotateFailureCode({ response: { data: { code: "ANNOTATION_TEXT_MISMATCH" } } })).toBe(
      "ANNOTATION_TEXT_MISMATCH"
    );
    expect(annotateFailureCode(new Error("x"))).toBeUndefined();
    expect(annotateFailureCode(null)).toBeUndefined();
  });
});
