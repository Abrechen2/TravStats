import type { InnerRepeatRule, ItemFieldRule } from "../templates/v2/extraction";
import { escapeRegex, type AnnotationSelection } from "./annotations";

/**
 * One marked ROW of a document — a flight line, a hotel line, an itinerary
 * day — generalised into the repeat that reads every row like it
 * (forgejo#124). Shared by the workshop derivers that need a list: the row's
 * own wording stays, what changes per row (digits, words) becomes a bounded
 * class, and each marked value becomes a named capture of its shape.
 *
 * A row on ONE line becomes a `matchAll` repeat; a row whose marks sit on two
 * consecutive lines (blank lines between allowed) becomes a `lines` repeat,
 * each line matched on its own. Every pattern is per line, with bounded
 * classes and no nested quantifiers, and runs inside the per-document budget
 * like any other template regex.
 */

/** Literal gap text between two marks, with what changes per row made a class. */
export function generaliseGap(gap: string): string {
  let out = "";
  for (const token of gap.match(/\d+|[ \t]+|\p{L}+|[^\d \t\p{L}]/gu) ?? []) {
    if (/^\d+$/.test(token)) out += "\\d{1,6}";
    else if (/^[ \t]+$/.test(token)) out += "[ \\t]+";
    else if (/^\p{L}+$/u.test(token)) out += "\\p{L}{1,24}";
    else out += escapeRegex(token);
  }
  return out;
}

/** The marked date's shape: digits and month names become classes, separators stay. */
export function datePattern(value: string): string {
  return generaliseGap(value.trim()).replace(/\[ \\t\]\+/g, "[ \\t]*");
}

/** What a marked value of a row is, which decides its capture. */
export type RowValueShape = "date" | "time" | "iata" | "flightNumber" | "amount" | "count" | "text";

/** A text value up to the next column gap: one space joins words, a tab or two spaces part columns. */
const TEXT_CAPTURE = "\\S(?:(?!\\t| {2})[^\\n]){0,80}?";

function captureOf(shape: RowValueShape, value: string): string {
  switch (shape) {
    case "date":
      return datePattern(value);
    case "time":
      return "\\d{1,2}[:.h]\\d{2}";
    case "iata":
      return "[A-Z]{3}";
    case "flightNumber":
      return "[A-Z0-9]{2}[ ]?\\d{1,5}[A-Z]?";
    case "amount":
      return "\\d{1,3}(?:[.,' ]?\\d{3}){0,3}(?:[.,]\\d{1,2})?";
    case "count":
      return "\\d{1,3}";
    case "text":
      return TEXT_CAPTURE;
  }
}

/** One marked value of a row: where it is, what it becomes, how it is read. */
export interface RowMark {
  /** The repeat item's field name — also the capture group's name. */
  field: string;
  shape: RowValueShape;
  start: number;
  end: number;
}

/** The marks of `labels` among the selections, with leading/trailing space trimmed. */
export function rowMarks(
  selections: readonly AnnotationSelection[],
  labels: Readonly<Record<string, { field: string; shape: RowValueShape }>>
): RowMark[] {
  const marks: RowMark[] = [];
  for (const sel of selections) {
    const spec = labels[sel.label];
    if (!spec || marks.some((m) => m.field === spec.field)) continue;
    const trimmed = sel.text.trim();
    if (trimmed === "") continue;
    const start = sel.start + (sel.text.length - sel.text.trimStart().length);
    marks.push({ field: spec.field, shape: spec.shape, start, end: start + trimmed.length });
  }
  return marks.sort((a, b) => a.start - b.start);
}

function lineBounds(fullText: string, at: number): { start: number; end: number } {
  const start = fullText.lastIndexOf("\n", at - 1) + 1;
  const nl = fullText.indexOf("\n", at);
  return { start, end: nl < 0 ? fullText.length : nl };
}

/**
 * The pattern of one line holding `marks` (in order). Everything after the
 * last mark is optional: one row prints a time there, the next nothing.
 */
function linePattern(fullText: string, marks: readonly RowMark[]): string {
  const line = lineBounds(fullText, marks[0].start);
  let pattern = `^[ \\t]*${generaliseGap(fullText.slice(line.start, marks[0].start).replace(/^[ \t]+/, ""))}`;
  marks.forEach((mark, i) => {
    pattern += `(?<${mark.field}>${captureOf(mark.shape, fullText.slice(mark.start, mark.end))})`;
    const next = marks[i + 1];
    if (next) pattern += generaliseGap(fullText.slice(mark.end, next.start));
  });
  const suffix = fullText.slice(marks[marks.length - 1].end, line.end).replace(/[ \t]+$/, "");
  const tail =
    suffix === ""
      ? ""
      : /^(?:\t| {2})/.test(suffix)
        ? "(?:(?:\\t| {2})[^\\n]{0,200})?"
        : `(?:${generaliseGap(suffix)})?`;
  return `${pattern}${tail}[ \\t]*$`;
}

export type RowRefusal = "rowTooFarApart" | "rowNotUnderstood";

export type RowBuild = { ok: true; repeat: InnerRepeatRule } | { ok: false; refusal: RowRefusal };

/**
 * The repeat that reads every row like the marked one. It must read the
 * marked row's own values back exactly, or the derivation refuses — a row
 * pattern that reads something else is a list of wrong values.
 */
export function buildRowRepeat(
  fullText: string,
  marks: readonly RowMark[],
  fields: Record<string, ItemFieldRule>,
  options: { minimum?: number } = {}
): RowBuild {
  const first = lineBounds(fullText, marks[0].start);
  const last = lineBounds(fullText, marks[marks.length - 1].start);
  const common = { flags: "imu", fields, minimum: options.minimum ?? 0 };
  let repeat: InnerRepeatRule;
  let lines: string[];
  if (first.start === last.start) {
    const pattern = linePattern(fullText, marks);
    repeat = { mode: "matchAll", pattern, ...common, flags: "gimu" };
    lines = [pattern];
  } else {
    const between = fullText.slice(first.end + 1, last.start);
    if (between.split("\n").some((l) => l.trim() !== "")) {
      return { ok: false, refusal: "rowTooFarApart" };
    }
    const top = marks.filter((m) => m.start < first.end + 1);
    const bottom = marks.filter((m) => m.start >= last.start);
    if (top.length + bottom.length !== marks.length) {
      return { ok: false, refusal: "rowTooFarApart" };
    }
    lines = [linePattern(fullText, top), linePattern(fullText, bottom)];
    repeat = {
      mode: "lines",
      rowLines: lines,
      ...(between !== "" ? { skipBlankLines: true } : {}),
      ...common,
    };
  }
  // The marked row, read back by its own patterns, value for value.
  const rowText = [first, last]
    .filter((b, i, all) => i === 0 || b.start !== all[0].start)
    .map((b) => fullText.slice(b.start, b.end));
  const groups: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(lines[i], "imu").exec(rowText[i] ?? "");
    if (!m) return { ok: false, refusal: "rowNotUnderstood" };
    Object.assign(groups, m.groups ?? {});
  }
  for (const mark of marks) {
    if (groups[mark.field]?.trim() !== fullText.slice(mark.start, mark.end)) {
      return { ok: false, refusal: "rowNotUnderstood" };
    }
  }
  return { ok: true, repeat };
}
