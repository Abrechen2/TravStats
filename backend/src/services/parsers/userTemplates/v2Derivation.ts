import type { FieldRule } from "../templates/v2/extraction";
import { TRANSFORMS, type TransformName } from "../templates/v2/transforms";
import { workshopEnvelopeSchema, type TemplateEnvelope } from "../templates/v2/envelope";
import type { Extraction } from "../templates/v2/extraction";
import type { LabelKind } from "../../../shared/annotationLabels";
import { isCurrencyCode } from "../../../shared/currencies";
import logger from "../../../utils/logger";
import { escapeRegex, labelContextOf, type AnnotationSelection } from "./annotations";
import { senderAnchorFromSubject } from "./lodgingDeriver";

/**
 * The pieces every workshop deriver that writes a v2 TEMPLATE ENVELOPE shares
 * — cruise and place (forgejo#124). Lodging writes the older declarative spec
 * and keeps its own deriver; the reading rules here are the same ones, moved
 * into the v2 vocabulary the bundled templates use, so a user's template and
 * a repository template are run by the same engine (owner ruling: only
 * generic readers are compiled in, every issuer layout is a template).
 *
 * Every regex written here is bounded by construction (per-line classes, no
 * nested quantifiers) and runs inside the per-document budget like any other
 * template regex.
 */

/** How far back a same-line label may reach. Matches `labelContextOf`. */
const LABEL_REACH = 80;

/** The transform that turns a marked value of this shape into the stored one. */
const TRANSFORM_FOR_KIND: Record<LabelKind, TransformName> = {
  text: "text",
  reference: "text",
  date: "date",
  time: "time",
  money: "amount",
  currency: "currency",
  count: "integer",
};

/** Longest capture per shape. A line, never more — see `captureFor`. */
const CAPTURE_LENGTH: Record<LabelKind, number> = {
  text: 120,
  reference: 40,
  date: 40,
  time: 20,
  money: 40,
  currency: 20,
  count: 10,
};

/**
 * A value up to the next column gap or the end of its line.
 *
 * The lookahead is what keeps "Schiff: AIDAnova    Kabine: 8123" from reading
 * the cabin into the ship: a tab or a run of two spaces is how a confirmation
 * separates two values on one line, a single space is how it writes one.
 */
function captureFor(kind: LabelKind): string {
  return `([^\\t\\r\\n]{1,${CAPTURE_LENGTH[kind]}}?)(?=\\t|[ \\t]{2,}|[ \\t]*$)`;
}

/** Whitespace a sender may reflow, nothing else: the label stays literal. */
export function literalLine(text: string): string {
  return escapeRegex(text.trim()).replace(/[ \t]+/g, "[ \\t]+");
}

/**
 * A line of the issuer's own wording, with the parts that change per booking
 * (digits) generalised — a heading like "Reiseverlauf (7 Nächte)" must still
 * be found in the next confirmation, which sails for 10.
 */
export function wordingLine(text: string): string {
  return literalLine(text).replace(/\d+/g, "\\d{1,6}");
}

/** Whether the transform of `kind` reads the marked value at all. */
export function readsValue(kind: LabelKind, value: string): boolean {
  const read = TRANSFORMS[TRANSFORM_FOR_KIND[kind]](value, {});
  if (read === null) return false;
  return kind === "currency" ? isCurrencyCode(read) : true;
}

/** What a v2 workshop deriver reads from one saved annotation. */
export interface WorkshopDerivationInput {
  trainingDataId: string;
  subject: string;
  fullText: string;
  selections: readonly AnnotationSelection[];
  senderDomain?: string;
}

export interface DerivedField {
  rule: FieldRule;
  /** The label line the rule anchors on — the issuer's own wording. */
  labelLine: string | null;
}

export type FieldDerivation =
  | { ok: true; field: DerivedField }
  | { ok: false; reason: "dateNotUnderstood" | "noAnchor" | "notRead" };

/**
 * The label in front of a value on its own line — cut at the end of any OTHER
 * mark on the same line, so the label of a second value never carries the
 * first value (which belongs to one booking and would match nothing else).
 */
function sameLineLabel(
  fullText: string,
  selection: AnnotationSelection,
  others: readonly AnnotationSelection[]
): string | null {
  const lineStart = fullText.lastIndexOf("\n", selection.start - 1) + 1;
  const cut = others
    .filter((o) => o !== selection && o.end <= selection.start && o.end > lineStart)
    .reduce((max, o) => Math.max(max, o.end), lineStart);
  const from = Math.max(cut, selection.start - LABEL_REACH);
  const label = fullText.slice(from, selection.start).trim();
  return label.length > 0 ? label : null;
}

/**
 * One field rule from one marked value, in the shape the v2 engine reads:
 * a label beside the value → a bounded pattern; a label above it → `stacked`
 * (the engine walks, which copes with a blank line in between); no label at
 * all → the line itself, but only for a value that belongs to the ISSUER
 * (`lineAnchorable`), because a booking-specific value written literally would
 * read nothing from the next document.
 */
export function deriveField(
  selection: AnnotationSelection,
  kind: LabelKind,
  fullText: string,
  others: readonly AnnotationSelection[],
  lineAnchorable: boolean
): FieldDerivation {
  const value = selection.text.trim();
  if (value.length === 0) return { ok: false, reason: "notRead" };
  if (!readsValue(kind, value)) {
    return { ok: false, reason: kind === "date" ? "dateNotUnderstood" : "notRead" };
  }
  const transform = TRANSFORM_FOR_KIND[kind];
  const context = labelContextOf(fullText, selection.start);

  if (context?.stacked) {
    return {
      ok: true,
      field: { rule: { stacked: context.label, transform }, labelLine: context.label },
    };
  }
  const label = context ? sameLineLabel(fullText, selection, others) : null;
  if (label) {
    const pattern = `${literalLine(label)}[ \\t]*${captureFor(kind)}`;
    return {
      ok: true,
      field: { rule: { patterns: [pattern], flags: "im", transform }, labelLine: label },
    };
  }
  if (!lineAnchorable || /[\r\n]/.test(value)) return { ok: false, reason: "noAnchor" };
  const pattern = `^[ \\t]*(${literalLine(value)})[ \\t]*$`;
  if (!new RegExp(pattern, "im").test(fullText)) return { ok: false, reason: "noAnchor" };
  return {
    ok: true,
    field: { rule: { patterns: [pattern], flags: "im", transform }, labelLine: null },
  };
}

export interface AnchorInput {
  subject: string;
  fullText: string;
  senderDomain?: string;
  labelLines: readonly string[];
  /** Values that name the issuer itself — a cruise line, a museum. */
  issuerValues: readonly string[];
}

/**
 * What identifies the SENDER, never the booking: a brand word in the subject,
 * the sender's domain where the document prints it, and a value the user
 * marked that names the issuer. Empty means the derivation must abstain — a
 * template with no anchor would claim every document of its domain.
 */
export function anchorsFor(input: AnchorInput): string[] {
  const haystack = `${input.subject}\n${input.fullText}`.toLowerCase();
  const anchors: string[] = [];
  const subjectAnchor = senderAnchorFromSubject(input.subject, input.labelLines);
  if (subjectAnchor) anchors.push(subjectAnchor);
  if (input.senderDomain && haystack.includes(input.senderDomain.toLowerCase())) {
    anchors.push(input.senderDomain);
  }
  for (const value of input.issuerValues) {
    const trimmed = value.trim();
    if (trimmed.length >= 4 && haystack.includes(trimmed.toLowerCase())) anchors.push(trimmed);
  }
  return [...new Set(anchors)];
}

export interface EnvelopeInput {
  domain: "cruise" | "place";
  trainingDataId: string;
  issuerName: string;
  senderDomain?: string;
  markers: string[];
  anchors: string[];
  extraction: Extraction;
}

/**
 * The envelope a workshop template is stored as, validated by the same schema
 * module the loader uses (`workshopEnvelopeSchema`: the repository envelope
 * without test cases — the preview is this template's proof). Null when it
 * does not validate, which is a defect of the deriver, logged as one.
 */
export function buildWorkshopEnvelope(input: EnvelopeInput): TemplateEnvelope | null {
  const raw = {
    id: `${input.domain}:user-${input.trainingDataId}`,
    domain: input.domain,
    // A workshop template is versioned by its row; re-deriving replaces it.
    version: "1.0.0",
    issuer: {
      name: input.issuerName,
      kind: input.domain === "cruise" ? "cruise-line" : "other",
      ...(input.senderDomain ? { keys: { senderDomains: [input.senderDomain] } } : {}),
    },
    markets: [],
    match: { markers: input.markers, anchors: input.anchors },
    extraction: input.extraction,
    testCases: [],
  };
  const parsed = workshopEnvelopeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  logger.error(
    {
      domain: input.domain,
      trainingDataId: input.trainingDataId,
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    },
    "Workshop deriver wrote an envelope its own schema refuses"
  );
  return null;
}
