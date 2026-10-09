/**
 * Test-case runners, one per domain.
 *
 * A template is activated only after its own `testCases` pass (design
 * principle 3: community templates must not activate on JSON validity
 * alone). Running a case needs an engine that understands the domain, so the
 * runners are a registry keyed by domain — and a domain with no runner has no
 * way to prove anything, which makes its templates `invalid`, never "loaded,
 * untested".
 *
 * Since P2 every domain runs the generic extraction engine: a case is a
 * match only when the matcher accepts the text AND every `required` name was
 * read, and a match case that carries `expected` must also have extracted
 * those values. `matchOnlyRunner` (the P1 default) remains for tests; it
 * reports no values, so a case with `expected` FAILS under it rather than
 * passing unchecked.
 */
import type {
  TemplateDomain,
  TemplateEnvelope,
  TemplateTestCase,
  TemplateTestInput,
} from "./envelope";
import { TEMPLATE_DOMAINS } from "./envelope";
import { extract } from "./extract";
import { compileSpec, specPart, type MailPart, type MatchRegex } from "./regexSpec";

export type TestDecision = "match" | "decline";

export interface RunnerOutcome {
  decision: TestDecision;
  /** What the engine read; absent when the runner does not extract. */
  values?: Record<string, unknown>;
  /** `required` names that came out empty. */
  missing?: string[];
}

export type TemplateTestRunner = (
  template: TemplateEnvelope,
  input: TemplateTestInput
) => RunnerOutcome;

export type RunnerRegistry = ReadonlyMap<TemplateDomain, TemplateTestRunner>;

/**
 * The text a matcher sees: sender, subject and body, one per line, as the
 * lodging engine joins them. A part the input does not carry adds no line,
 * so `{ subject, text }` reads exactly like `"<subject>\n<text>"` — the
 * subject stays the FIRST line, which a pattern anchored at `^` without the
 * `m` flag relies on.
 */
export function testInputHaystack(input: TemplateTestInput): string {
  if (typeof input === "string") return input;
  return [input.from, input.subject, input.text].filter((p) => p !== undefined).join("\n");
}

/** The parts of a mail a matcher regex may be confined to (`in`). A plain string is all body. */
function mailParts(input: TemplateTestInput): Record<MailPart, string> {
  if (typeof input === "string") return { from: "", subject: "", text: input };
  return { from: input.from ?? "", subject: input.subject ?? "", text: input.text };
}

function regexHits(spec: MatchRegex, input: TemplateTestInput, haystack: string): boolean {
  const part = specPart(spec);
  return compileSpec(spec, "im").test(part ? mailParts(input)[part] : haystack);
}

/**
 * Every marker and `allOf` regex, at least one anchor or `anyOf` regex, and no
 * `noneOf` regex. Markers and anchors are case-insensitive substrings — the
 * lodging engine's rule; the regexes carry their own flags (default `im`).
 */
export function envelopeMatches(template: TemplateEnvelope, input: TemplateTestInput): boolean {
  const haystack = testInputHaystack(input);
  const text = haystack.toLowerCase();
  const has = (needle: string): boolean => text.includes(needle.toLowerCase());
  const hits = (spec: MatchRegex): boolean => regexHits(spec, input, haystack);
  const { markers, anchors, allOf = [], anyOf = [], noneOf = [] } = template.match;
  return (
    markers.every(has) &&
    allOf.every(hits) &&
    (anchors.some(has) || anyOf.some(hits)) &&
    !noneOf.some(hits)
  );
}

export interface TemplateApplication {
  matched: boolean;
  values: Record<string, unknown>;
  missing: string[];
  /** The matcher recognised the issuer AND a `notBookingIf` pattern: a cancellation or the like. */
  nonBooking?: boolean;
}

/** Whether a document the matcher accepted is one of the issuer's non-bookings. */
export function isNonBooking(template: TemplateEnvelope, input: TemplateTestInput): boolean {
  const haystack = testInputHaystack(input);
  return (template.match.notBookingIf ?? []).some((p) => regexHits(p, input, haystack));
}

/**
 * Applies a template to a document: the matcher first, then extraction. When
 * the matcher declines, nothing is extracted (`values` and `missing` are
 * empty) — a template that does not recognise the document has nothing to
 * say about it. A document the issuer's `notBookingIf` names is declined the
 * same way, flagged `nonBooking`. `matched` is true only when nothing
 * `required` is missing.
 */
export function applyTemplate(
  template: TemplateEnvelope,
  text: TemplateTestInput
): TemplateApplication {
  const haystack = testInputHaystack(text);
  if (!envelopeMatches(template, text)) return { matched: false, values: {}, missing: [] };
  if (isNonBooking(template, text)) {
    return { matched: false, values: {}, missing: [], nonBooking: true };
  }
  const { values, missing } = extract(template.extraction, haystack, mailParts(text));
  return { matched: missing.length === 0, values, missing };
}

export const matchOnlyRunner: TemplateTestRunner = (template, input) => ({
  decision: envelopeMatches(template, input) ? "match" : "decline",
});

export const extractionRunner: TemplateTestRunner = (template, input) => {
  const { matched, values, missing } = applyTemplate(template, input);
  return { decision: matched ? "match" : "decline", values, missing };
};

export const defaultRunners: RunnerRegistry = new Map(
  TEMPLATE_DOMAINS.map((domain) => [domain, extractionRunner] as const)
);

// ------------------------------------------------------------------ expected

export interface Difference {
  path: string;
  expected: unknown;
  actual: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The first place `actual` departs from `expected`, or null. Partial: an
 * object compares only the keys `expected` names; an array must have the
 * same length and each element must partially equal its counterpart in
 * order; anything else compares strictly (null and absent are the same).
 */
export function firstDifference(
  expected: unknown,
  actual: unknown,
  path: string
): Difference | null {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return { path, expected, actual };
    if (actual.length !== expected.length) {
      return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    }
    for (const [i, item] of expected.entries()) {
      const diff = firstDifference(item, actual[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return { path, expected, actual };
    for (const [key, value] of Object.entries(expected)) {
      const diff = firstDifference(value, actual[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  const same = expected === actual || (expected === null && actual === undefined);
  return same ? null : { path, expected, actual };
}

// ------------------------------------------------------------------ test cases

export type TestRunResult =
  { kind: "passed" } | { kind: "no_runner" } | { kind: "failed"; failures: string[] };

function show(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

/** Null when the case passes, else the failure message. */
function judge(testCase: TemplateTestCase, outcome: RunnerOutcome): string | null {
  const name = `"${testCase.name}"`;
  if (outcome.decision !== testCase.expect) {
    const missing = outcome.missing?.length ? ` (missing: ${outcome.missing.join(", ")})` : "";
    return `${name}: expected ${testCase.expect}, got ${outcome.decision}${missing}`;
  }
  if (testCase.expect !== "match" || !testCase.expected) return null;
  if (!outcome.values) return `${name}: this runner cannot check expected values`;
  const diff = firstDifference(testCase.expected, outcome.values, "expected");
  if (!diff) return null;
  return `${name}: ${diff.path}: expected ${show(diff.expected)}, got ${show(diff.actual)}`;
}

export function runTestCases(template: TemplateEnvelope, runners: RunnerRegistry): TestRunResult {
  const runner = runners.get(template.domain);
  if (!runner) return { kind: "no_runner" };
  const failures = template.testCases.flatMap((testCase) => {
    try {
      const failure = judge(testCase, runner(template, testCase.input));
      return failure === null ? [] : [failure];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return [`"${testCase.name}": runner threw: ${message}`];
    }
  });
  return failures.length === 0 ? { kind: "passed" } : { kind: "failed", failures };
}
