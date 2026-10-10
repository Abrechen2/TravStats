import type { TemplateEnvelope } from "../templates/v2/envelope";
import type { FieldRule, InnerRepeatRule } from "../templates/v2/extraction";
import { labelOfDomain } from "../../../shared/annotationLabels";
import { applyV2CruiseTemplate } from "../../cruise/v2Cruise";
import { escapeRegex, type AnnotationSelection } from "./annotations";
import {
  anchorsFor,
  buildWorkshopEnvelope,
  deriveField,
  readsValue,
  wordingLine,
  type WorkshopDerivationInput,
} from "./v2Derivation";

/**
 * Turn a user's annotated cruise confirmation into a v2 cruise template —
 * forgejo#124, the step that was blocked on "a port list is a repeating
 * block". The v2 engine reads repeating blocks now, and the bundled TUI
 * Cruises reader is exactly such a template; a derived one is the same kind of
 * thing with a different author, run by the same consumer
 * (`services/cruise/v2Cruise.ts`).
 *
 * What the user marks, and what becomes of it:
 *  - header values (ship, line, dates, cabin, price, reference …) → one
 *    bounded label pattern each, as the lodging deriver writes them;
 *  - ONE row of the port list — its date (`stopDate`) and its port
 *    (`stopPort`), on the same line → that line, generalised (digits and
 *    letters become classes, the issuer's punctuation stays), is the per-line
 *    pattern of the `stops` repeat. The line above the list is the fence the
 *    repeat starts after, so a payment date in the header is no port call.
 *
 * A voyage without a single stop is no voyage (the consumer drops it), so a
 * derivation that cannot build the stop list abstains — and one that builds a
 * template which then reads nothing from its OWN sample abstains too. "A
 * matching template is not an extracting template."
 */

export type CruiseDerivationRefusal =
  | "cruiseNeedsStopRow"
  | "cruiseStopRowNotOneLine"
  | "cruiseStopRowNotUnderstood"
  | "dateNotUnderstood"
  | "noDistinguishingMarker"
  | "templateReadsNothing";

export type CruiseDerivation =
  { ok: true; template: TemplateEnvelope } | { ok: false; refusal: CruiseDerivationRefusal };

const ITINERARY = new Set(["stopDate", "stopPort", "seaDay"]);

/** Values that name the issuer, not the booking — the only ones read by their own line. */
const ISSUER_FIELDS = new Set(["shipName", "cruiseLine"]);

/**
 * How a confirmation writes a day at sea. A generic vocabulary, not one
 * issuer's: the word the user marked as `seaDay` is added in front of it.
 */
const SEA_DAY_WORDS = ["seetag", "auf see", "erholung auf see", "at sea", "sea day", "day at sea"];

/** Literal gap text between two marks, with what changes per row made a class. */
function generaliseGap(gap: string): string {
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
function datePattern(value: string): string {
  return generaliseGap(value.trim()).replace(/\[ \\t\]\+/g, "[ \\t]*");
}

interface StopRow {
  pattern: string;
  /** The line the row was marked on, and where it sits in the sample. */
  lineStart: number;
  lineEnd: number;
}

type Located = { kind: "date" | "port"; start: number; end: number };

/**
 * The per-line pattern of one marked itinerary row. Everything after the last
 * mark is OPTIONAL: a port call prints its times there, a sea day prints
 * nothing, and both are rows of the same list.
 *
 * A port name may hold single spaces ("Las Palmas de Gran Canaria") but never
 * a column gap — a tab or two spaces is where the next column starts. When
 * the marked row puts such a gap after its last mark, whatever follows the
 * gap is free: one port prints "08:00 - 17:00" there, the next "an 09:00".
 */
function stopRowPattern(fullText: string, date: Located, port: Located): StopRow {
  const lineStart = fullText.lastIndexOf("\n", Math.min(date.start, port.start) - 1) + 1;
  const nl = fullText.indexOf("\n", Math.max(date.end, port.end));
  const lineEnd = nl < 0 ? fullText.length : nl;
  const marks = [date, port].sort((a, b) => a.start - b.start);
  const capture = (m: Located): string =>
    m.kind === "date"
      ? `(?<date>${datePattern(fullText.slice(m.start, m.end))})`
      : "(?<port>\\S(?:(?!\\t| {2})[^\\n]){0,80}?)";
  const prefix = fullText.slice(lineStart, marks[0].start).replace(/^[ \t]+/, "");
  const middle = fullText.slice(marks[0].end, marks[1].start);
  const suffix = fullText.slice(marks[1].end, lineEnd).replace(/[ \t]+$/, "");
  const tail =
    suffix === ""
      ? ""
      : /^(?:\t| {2})/.test(suffix)
        ? "(?:(?:\\t| {2})[^\\n]{0,200})?"
        : `(?:${generaliseGap(suffix)})?`;
  const pattern =
    `^[ \\t]*${generaliseGap(prefix)}${capture(marks[0])}${generaliseGap(middle)}` +
    `${capture(marks[1])}${tail}[ \\t]*$`;
  return { pattern, lineStart, lineEnd };
}

/** A non-empty line above or below the marked row that is not itself a row. */
function fenceLine(
  fullText: string,
  row: RegExp,
  from: number,
  direction: "up" | "down"
): string | null {
  const lines =
    direction === "up"
      ? fullText.slice(0, from).split("\n").reverse()
      : fullText.slice(from).split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    row.lastIndex = 0;
    if (row.test(line)) continue;
    // A fence is the issuer's wording; a line without a letter is a number.
    return /\p{L}/u.test(line) ? line.trim() : null;
  }
  return null;
}

function locate(selections: readonly AnnotationSelection[], label: string): Located | null {
  const sel = selections.find((s) => s.label === label && s.text.trim().length > 0);
  if (!sel) return null;
  const leading = sel.text.length - sel.text.trimStart().length;
  const start = sel.start + leading;
  return {
    kind: label === "stopDate" ? "date" : "port",
    start,
    end: start + sel.text.trim().length,
  };
}

function seaDayMap(selections: readonly AnnotationSelection[]): [string, boolean][] {
  const marked = selections
    .find((s) => s.label === "seaDay")
    ?.text.trim()
    .toLowerCase();
  const words = marked ? [marked, ...SEA_DAY_WORDS.filter((w) => w !== marked)] : SEA_DAY_WORDS;
  return [[`^(?:${words.map(escapeRegex).join("|")})$`, true]];
}

type StopsBuild =
  | { ok: true; stops: InnerRepeatRule; heading: string }
  | { ok: false; refusal: CruiseDerivationRefusal };

function buildStops(input: WorkshopDerivationInput): StopsBuild {
  const { fullText, selections } = input;
  const date = locate(selections, "stopDate");
  const port = locate(selections, "stopPort");
  if (!date || !port) return { ok: false, refusal: "cruiseNeedsStopRow" };
  const span = fullText.slice(Math.min(date.start, port.start), Math.max(date.end, port.end));
  if (span.includes("\n")) return { ok: false, refusal: "cruiseStopRowNotOneLine" };
  if (!readsValue("date", fullText.slice(date.start, date.end))) {
    return { ok: false, refusal: "dateNotUnderstood" };
  }

  const row = stopRowPattern(fullText, date, port);
  const lineRe = new RegExp(row.pattern, "imu");
  const own = lineRe.exec(fullText.slice(row.lineStart, row.lineEnd));
  if (own?.groups?.port?.trim() !== fullText.slice(port.start, port.end)) {
    return { ok: false, refusal: "cruiseStopRowNotUnderstood" };
  }
  const heading = fenceLine(fullText, lineRe, row.lineStart, "up");
  if (!heading) return { ok: false, refusal: "cruiseStopRowNotUnderstood" };
  const footer = fenceLine(fullText, lineRe, row.lineEnd, "down");

  const seaDay = seaDayMap(selections);
  const stops: InnerRepeatRule = {
    mode: "matchAll",
    within: {
      startAfter: `^[ \\t]*${wordingLine(heading)}[ \\t]*$`,
      ...(footer ? { endBefore: `^[ \\t]*${wordingLine(footer)}[ \\t]*$` } : {}),
    },
    pattern: row.pattern,
    flags: "gimu",
    fields: {
      date: { group: "date", transform: "date" },
      portName: { group: "port", transform: "text" },
      isAtSea: { group: "port", transform: "text", map: seaDay },
    },
    skipItemsWithout: ["date"],
    minimum: 1,
  };
  return { ok: true, stops, heading };
}

export function deriveCruiseTemplate(input: WorkshopDerivationInput): CruiseDerivation {
  const { fullText, selections } = input;
  const stopsBuild = buildStops(input);
  if (!stopsBuild.ok) return stopsBuild;

  const fields: Record<string, FieldRule> = {};
  const labelLines: string[] = [];
  const stacked: string[] = [];
  for (const selection of selections) {
    if (ITINERARY.has(selection.label) || fields[selection.label]) continue;
    const label = labelOfDomain("cruise", selection.label);
    if (!label) continue; // The route refuses a foreign label; this is the second lock.
    const derived = deriveField(
      selection,
      label.kind,
      fullText,
      selections,
      ISSUER_FIELDS.has(label.id)
    );
    if (!derived.ok) {
      if (derived.reason === "dateNotUnderstood") return { ok: false, refusal: derived.reason };
      continue;
    }
    fields[label.id] = derived.field.rule;
    const line = derived.field.labelLine;
    if (line && !labelLines.includes(line)) labelLines.push(line);
    if (line && derived.field.rule.stacked !== undefined) stacked.push(line);
  }

  const issuerValues = selections.filter((s) => s.label === "cruiseLine").map((s) => s.text.trim());
  const anchors = anchorsFor({
    subject: input.subject,
    fullText,
    senderDomain: input.senderDomain,
    labelLines,
    issuerValues,
  });
  if (anchors.length === 0) return { ok: false, refusal: "noDistinguishingMarker" };

  const template = buildWorkshopEnvelope({
    domain: "cruise",
    trainingDataId: input.trainingDataId,
    issuerName: issuerValues[0] || input.senderDomain || "Kreuzfahrt",
    senderDomain: input.senderDomain,
    // The heading is the issuer's wording — unless it prints a number, which
    // is this voyage's (a marker is a literal substring).
    markers: /\d/.test(stopsBuild.heading) ? [] : [stopsBuild.heading],
    anchors,
    extraction: {
      preprocess: ["stripCarriageReturns"],
      fields,
      ...(stacked.length > 0 ? { labels: stacked } : {}),
      repeats: {
        // One voyage per heading; one heading (the usual case) reads the
        // whole document as the one voyage.
        cruises: {
          mode: "split",
          splitPattern: `^[ \\t]*${wordingLine(stopsBuild.heading)}[ \\t]*$`,
          flags: "gim",
          wholeTextUnlessSplit: true,
          skipPreamble: true,
          fields: {},
          repeats: { stops: stopsBuild.stops },
        },
      },
      required: ["cruises"],
    },
  });
  if (!template) return { ok: false, refusal: "templateReadsNothing" };
  // The template must read its OWN sample, through the consumer the parser
  // uses — otherwise it is a template that matches and extracts nothing.
  if (applyV2CruiseTemplate(template, `${input.subject}\n${fullText}`).length === 0) {
    return { ok: false, refusal: "templateReadsNothing" };
  }
  return { ok: true, template };
}
